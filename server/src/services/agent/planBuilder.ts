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
  let usual: string | null = client.preferredCaregiverCodes[0] ?? null;
  const visits: PlannedAssignment[] = built.visits.map((planned, index) => {
    const draft = {
      id: `planned-${index + 1}`,
      clientId: client.code,
      caregiverId: null,
      authorizationId: authorization.code,
      serviceCode: authorization.serviceCode,
      start: planned.start,
      end: planned.end,
      units: planned.units,
      status: "scheduled" as const,
    };
    let caregiverCode: string | null = null;
    let reason: string;
    if (usual && agency.passes(draft, usual)) {
      caregiverCode = usual;
      reason = `Same caregiver as the other visits (${names.get(usual)}), every rule passes.`;
    } else {
      const [best] = agency.candidates(draft, { limit: 1 });
      caregiverCode = best?.caregiverId ?? null;
      reason = best ? `${best.name}: ${best.facts}.` : "Nobody is free then; left open for the coordinator.";
      if (best) usual = best.caregiverId;
    }
    // Later visits are checked against this one (hours, clashes, units).
    agency.hold({ code: draft.id, clientCode: client.code, caregiverCode, authorizationCode: authorization.code, serviceCode: authorization.serviceCode, start: planned.start, end: planned.end, units: planned.units, status: "scheduled" });
    return { ...planned, caregiverCode, caregiverName: caregiverCode ? names.get(caregiverCode) ?? null : null, reason };
  });

  const { visits: _ignored, ...result } = built;
  void _ignored;
  return { authorizationCode: authorization.code, clientCode: client.code, clientName: client.name, result, visits };
}
