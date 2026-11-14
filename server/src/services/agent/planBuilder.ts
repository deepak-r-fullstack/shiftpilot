import { Authorization } from "../../models/authorization.model";
import { Caregiver } from "../../models/caregiver.model";
import { Client } from "../../models/client.model";
import { Service } from "../../models/service.model";
import { Visit } from "../../models/visit.model";
import { NotFoundError } from "../../helpers/errors";
import { agencyToday } from "../../utils/clock";
import { MemoryAgency } from "../scheduling/memoryAgency";
import { VisitRecord } from "../scheduling/mappers";
import { buildSchedule, BuildScheduleResult } from "../scheduling/scheduleBuilder";
import { Weekday } from "../scheduling/types";

// ---------------------------------------------------------------------------
// "Set up Asha's visits Mon/Wed/Fri mornings": the schedule builder spreads the
// units, then each visit gets a caregiver, keeping the same person where the
// rules allow (clients prefer a familiar face). Held in memory: placing ~75
// visits with full rule checks against the database would be far too slow.
// The plan is checked again, against the database, when it is saved.
// ---------------------------------------------------------------------------

export interface BuildPlanInput {
  authorizationCode: string;
  days: Weekday[];
  windowStart: string;
  windowEnd: string;
  visitMinutes?: number;
}

export interface PlannedAssignment {
  start: Date;
  end: Date;
  units: number;
  caregiverCode: string | null;
  caregiverName: string | null;
  reason: string;
}

export interface BuiltPlan {
  authorizationCode: string;
  clientCode: string;
  clientName: string;
  result: Omit<BuildScheduleResult, "visits">;
  visits: PlannedAssignment[];
}

export async function loadMemoryAgency(sandboxId: string): Promise<MemoryAgency> {
  const [services, caregivers, clients, authorizations, visits] = await Promise.all([
    Service.find({ sandboxId }).lean(),
    Caregiver.find({ sandboxId }).lean(),
    Client.find({ sandboxId }).lean(),
    Authorization.find({ sandboxId }).lean(),
    Visit.find({ sandboxId, status: { $ne: "cancelled" } }).lean<VisitRecord[]>(),
  ]);
  return new MemoryAgency({ services, caregivers, clients, authorizations, visits } as any);
}

export async function buildPlan(sandboxId: string, input: BuildPlanInput): Promise<BuiltPlan> {
  const authorization = await Authorization.findOne({ sandboxId, code: input.authorizationCode.toUpperCase() }).lean();
  if (!authorization) throw new NotFoundError(`Authorization ${input.authorizationCode} was not found.`);
  const [service, client, existing] = await Promise.all([
    Service.findOne({ sandboxId, code: authorization.serviceCode }).lean(),
    Client.findOne({ sandboxId, code: authorization.clientCode }).lean(),
    Visit.find({ sandboxId, authorizationCode: authorization.code, status: { $ne: "cancelled" } }).lean<VisitRecord[]>(),
  ]);
  if (!service || !client) throw new NotFoundError("The authorization's service or client was not found.");

  const built = buildSchedule({
    authorization: {
      id: authorization.code,
      clientId: authorization.clientCode,
      serviceCode: authorization.serviceCode,
      startDate: authorization.startDate,
      endDate: authorization.endDate,
      totalUnits: authorization.totalUnits,
      maxUnitsPerVisit: authorization.maxUnitsPerVisit,
      maxUnitsPerWeek: authorization.maxUnitsPerWeek,
    },
    service: { code: service.code, name: service.name, unitMinutes: service.unitMinutes, requiredSkill: service.requiredSkill },
    days: input.days,
    window: { start: input.windowStart, end: input.windowEnd },
    visitMinutes: input.visitMinutes,
    today: agencyToday(),
    existingVisits: existing.map((v) => ({
      id: v.code,
      clientId: v.clientCode,
      caregiverId: v.caregiverCode,
      authorizationId: v.authorizationCode,
      serviceCode: v.serviceCode,
      start: v.start,
      end: v.end,
      units: v.units,
      status: v.status,
    })),
  });

  const agency = await loadMemoryAgency(sandboxId);
  const names = new Map((await Caregiver.find({ sandboxId }, { code: 1, name: 1 }).lean()).map((c) => [c.code, c.name]));
  const drafts = built.visits.map((planned, index) => ({
    id: `planned-${index + 1}`,
    clientId: client.code,
    caregiverId: null,
    authorizationId: authorization.code,
    serviceCode: authorization.serviceCode,
    start: planned.start,
    end: planned.end,
    units: planned.units,
    status: "scheduled" as const,
  }));

  // Continuity first: clients prefer the same face. Pick the caregiver who can take the most of
  // these visits (their usual caregiver wins a tie), give them every visit they still can, then
  // repeat for what is left. Each assignment is held, so later checks see it (hours, clashes, units).
  const assigned = new Map<number, { code: string; reason: string }>();
  const usual = client.preferredCaregiverCodes[0] ?? null;
  for (let round = 0; round < 6 && assigned.size < drafts.length; round += 1) {
    const counts = new Map<string, number>();
    drafts.forEach((draft, index) => {
      if (assigned.has(index)) return;
      agency.candidates(draft, { limit: 50 }).forEach((c) => counts.set(c.caregiverId, (counts.get(c.caregiverId) ?? 0) + 1));
    });
    if (counts.size === 0) break;
    const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] === usual ? -1 : b[0] === usual ? 1 : 0));
    const code = best[0];
    drafts.forEach((draft, index) => {
      if (assigned.has(index) || !agency.passes(draft, code)) return;
      const reason =
        round === 0
          ? `${names.get(code)} takes ${best[1]} of the ${drafts.length} visits, so ${client.name} sees the same caregiver; every rule passes.`
          : `${names.get(code)} covers the visits the main caregiver cannot; every rule passes.`;
      assigned.set(index, { code, reason });
      agency.hold({ code: draft.id, clientCode: client.code, caregiverCode: code, authorizationCode: authorization.code, serviceCode: authorization.serviceCode, start: draft.start, end: draft.end, units: draft.units, status: "scheduled" });
    });
  }

  const visits: PlannedAssignment[] = built.visits.map((planned, index) => {
    const pick = assigned.get(index);
    return {
      ...planned,
      caregiverCode: pick?.code ?? null,
      caregiverName: pick ? names.get(pick.code) ?? null : null,
      reason: pick?.reason ?? "Nobody is free then; left open for the coordinator.",
    };
  });

  const { visits: _ignored, ...result } = built;
  void _ignored;
  return { authorizationCode: authorization.code, clientCode: client.code, clientName: client.name, result, visits };
}
