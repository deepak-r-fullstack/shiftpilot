import type { Tool, ToolSet } from "ai";
import { z } from "zod";
import { AppError } from "../../helpers/errors";
import { Authorization } from "../../models/authorization.model";
import { Caregiver } from "../../models/caregiver.model";
import { Client } from "../../models/client.model";
import { Service } from "../../models/service.model";
import { Visit } from "../../models/visit.model";
import { atDenver, dayRangeOfDate, denverDate, denverTime, describeTime, wallMinutes } from "../../utils/time";
import { submitProposal, ProposedChangeInput } from "../proposals/proposal.service";
import { findCandidatesForVisit } from "../scheduling/candidates.service";
import { ChangeInput, checkChange } from "../scheduling/changeChecker";
import { unitsLeft } from "../scheduling/factsLoader";
import { failedMessages } from "../scheduling/ruleChecker";
import { VisitRecord } from "../scheduling/mappers";
import { WEEKDAYS } from "../scheduling/types";
import { Emit } from "./events";
import { buildPlan, BuiltPlan } from "./planBuilder";
import { resolveByName } from "./resolve";

// ---------------------------------------------------------------------------
// The ONLY things the agent can do. All of them read or propose; none of them
// changes a visit. Applying a plan happens later, after the coordinator approves.
// Every tool returns small JSON, and reports a short line to the screen.
// ---------------------------------------------------------------------------

export interface AgentToolContext {
  sandboxId: string;
  requestId: string | null;
  emit: Emit;
  // Filled in by the tools; read by the agent loop.
  state: { proposalId: string | null; proposalSummary: string; changeCount: number; asked: boolean; plans: Map<string, BuiltPlan> };
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:mm");
const CODE = z.string().trim().min(2).max(20);

const agentChange = z.object({
  kind: z.enum(["assign", "move", "cancel", "create"]),
  visitCode: CODE.optional().describe("Existing visit (assign, move, cancel)"),
  caregiverCode: CODE.nullable().optional().describe("New caregiver; null leaves the visit open"),
  date: DATE.optional().describe("New date (move, create)"),
  startTime: TIME.optional(),
  endTime: TIME.optional(),
  clientCode: CODE.optional().describe("create only"),
  authorizationCode: CODE.optional().describe("create only"),
});
type AgentChange = z.infer<typeof agentChange>;

/**
 * A typed tool definition. The AI SDK's own tool() helper makes TypeScript infer very deep
 * generic types with zod 3, which slows type checking to minutes; this keeps the same
 * shape with simple types.
 */
function tool<S extends z.ZodTypeAny>(definition: { description: string; inputSchema: S; execute: (input: z.infer<S>) => Promise<unknown> }): Tool {
  return definition as unknown as Tool;
}

function toChangeInput(change: AgentChange): ChangeInput {
  const input: ChangeInput = { kind: change.kind, visitCode: change.visitCode?.toUpperCase() };
  if (change.caregiverCode !== undefined) input.caregiverCode = change.caregiverCode ? change.caregiverCode.toUpperCase() : null;
  if (change.date && change.startTime && change.endTime) {
    input.start = atDenver(change.date, change.startTime).toISOString();
    input.end = atDenver(change.date, change.endTime).toISOString();
  }
  if (change.clientCode) input.clientCode = change.clientCode.toUpperCase();
  if (change.authorizationCode) input.authorizationCode = change.authorizationCode.toUpperCase();
  return input;
}

function describeVisit(visit: VisitRecord, names: Map<string, string>) {
  return {
    visitCode: visit.code,
    date: denverDate(visit.start),
    start: denverTime(visit.start),
    end: denverTime(visit.end),
    client: `${names.get(visit.clientCode) ?? visit.clientCode} (${visit.clientCode})`,
    caregiver: visit.caregiverCode ? `${names.get(visit.caregiverCode) ?? visit.caregiverCode} (${visit.caregiverCode})` : "open (nobody)",
    service: visit.serviceCode,
    units: visit.units,
    status: visit.status,
  };
}

/** Tool errors go back to the model as text it can act on, never as a crash. */
async function safely<T>(work: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export function createTools(ctx: AgentToolContext): ToolSet {
  const { sandboxId, emit } = ctx;

  const people = async () => {
    const [caregivers, clients] = await Promise.all([
      Caregiver.find({ sandboxId }, { code: 1, name: 1 }).lean(),
      Client.find({ sandboxId }, { code: 1, name: 1 }).lean(),
    ]);
    const names = new Map<string, string>([...caregivers, ...clients].map((p) => [p.code, p.name]));
    return { caregivers, clients, names };
  };

  return {
    find_visits: tool({
      description: "List visits between two dates (inclusive) for a caregiver and/or a client, by name or code.",
      inputSchema: z.object({ caregiver: z.string().max(60).optional(), client: z.string().max(60).optional(), fromDate: DATE, toDate: DATE }),
      execute: async ({ caregiver, client, fromDate, toDate }) =>
        safely(async () => {
          const { caregivers, clients, names } = await people();
          const query: Record<string, unknown> = {
            sandboxId,
            start: { $gte: dayRangeOfDate(fromDate).from, $lt: dayRangeOfDate(toDate).to },
            status: { $ne: "cancelled" },
          };
          const who: string[] = [];
          if (caregiver) {
            const found = resolveByName(caregivers, caregiver);
            if (found.kind !== "found") return found;
            query.caregiverCode = found.item.code;
            who.push(found.item.name);
          }
          if (client) {
            const found = resolveByName(clients, client);
            if (found.kind !== "found") return found;
            query.clientCode = found.item.code;
            who.push(found.item.name);
          }
          const visits = await Visit.find(query).sort({ start: 1 }).limit(60).lean<VisitRecord[]>();
          emit({ type: "tool", name: "find_visits", summary: `Found ${visits.length} visit${visits.length === 1 ? "" : "s"}${who.length ? ` for ${who.join(" and ")}` : ""} (${fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`})` });
          return { visits: visits.map((v) => describeVisit(v, names)) };
        }),
    }),

    get_authorization: tool({
      description: "A client's authorizations: service, dates, units left and limits.",
      inputSchema: z.object({ client: z.string().max(60), service: z.string().max(40).optional() }),
      execute: async ({ client, service }) =>
        safely(async () => {
          const { clients } = await people();
          const found = resolveByName(clients, client);
          if (found.kind !== "found") return found;
          const services = await Service.find({ sandboxId }).lean();
          const authorizations = await Authorization.find({ sandboxId, clientCode: found.item.code }).lean();
          const wanted = service?.toLowerCase();
          const list = await Promise.all(
            authorizations
              .filter((a) => {
                if (!wanted) return true;
                const s = services.find((x) => x.code === a.serviceCode);
                return a.serviceCode.toLowerCase() === wanted || Boolean(s?.name.toLowerCase().includes(wanted));
              })
              .map(async (a) => {
                const s = services.find((x) => x.code === a.serviceCode)!;
                return {
                  authorizationCode: a.code,
                  service: `${s.name} (${s.code}, ${s.unitMinutes}-minute units)`,
                  startDate: a.startDate,
                  endDate: a.endDate,
                  totalUnits: a.totalUnits,
                  unitsLeft: await unitsLeft(sandboxId, a.code),
                  maxUnitsPerVisit: a.maxUnitsPerVisit ?? null,
                  maxUnitsPerWeek: a.maxUnitsPerWeek ?? null,
                };
              })
          );
          emit({ type: "tool", name: "get_authorization", summary: `Read ${found.item.name}'s authorization${list.length === 1 ? "" : "s"}` });
          return { client: { code: found.item.code, name: found.item.name }, authorizations: list };
        }),
    }),

    find_candidates: tool({
      description:
        "Caregivers who pass EVERY rule for a visit, best first. Give visitCode to cover an existing visit (optionally with a new date and time for a move), or clientCode + authorizationCode + date + times for a new visit.",
      inputSchema: z.object({
        visitCode: CODE.optional(),
        clientCode: CODE.optional(),
        authorizationCode: CODE.optional(),
        date: DATE.optional(),
        startTime: TIME.optional(),
        endTime: TIME.optional(),
      }),
      execute: async (input) =>
        safely(async () => {
          let visit;
          let exclude: string[] = [];
          let label: string;
          const newTime = input.date && input.startTime && input.endTime ? { start: atDenver(input.date, input.startTime), end: atDenver(input.date, input.endTime) } : null;
          if (input.visitCode) {
            const record = await Visit.findOne({ sandboxId, code: input.visitCode.toUpperCase() }).lean<VisitRecord>();
            if (!record) return { error: `Visit ${input.visitCode} was not found.` };
            const service = await Service.findOne({ sandboxId, code: record.serviceCode }).lean();
            const start = newTime?.start ?? record.start;
            const end = newTime?.end ?? record.end;
            visit = { id: record.code, clientId: record.clientCode, caregiverId: null, authorizationId: record.authorizationCode, serviceCode: record.serviceCode, start, end, units: wallMinutes(start, end) / (service?.unitMinutes ?? 15), status: "scheduled" as const };
            // Covering a visit: offer anyone but the person who has it. Moving it: they may keep it.
            if (!newTime && record.caregiverCode) exclude = [record.caregiverCode];
            label = `${record.code}${newTime ? ` at ${describeTime(start)}` : ""}`;
          } else {
            if (!input.clientCode || !input.authorizationCode || !newTime) return { error: "Give a visitCode, or clientCode + authorizationCode + date + startTime + endTime." };
            const authorization = await Authorization.findOne({ sandboxId, code: input.authorizationCode.toUpperCase() }).lean();
            if (!authorization) return { error: `Authorization ${input.authorizationCode} was not found.` };
            const service = await Service.findOne({ sandboxId, code: authorization.serviceCode }).lean();
            visit = { id: "new", clientId: input.clientCode.toUpperCase(), caregiverId: null, authorizationId: authorization.code, serviceCode: authorization.serviceCode, start: newTime.start, end: newTime.end, units: wallMinutes(newTime.start, newTime.end) / (service?.unitMinutes ?? 15), status: "scheduled" as const };
            label = `a new visit at ${describeTime(newTime.start)}`;
          }
          const candidates = await findCandidatesForVisit(sandboxId, visit, { exclude, limit: 5 });
          emit({ type: "tool", name: "find_candidates", summary: candidates.length ? `${candidates.length} caregiver${candidates.length === 1 ? "" : "s"} can take ${label}; best: ${candidates[0].name}` : `Nobody can take ${label}` });
          return { candidates: candidates.map((c) => ({ caregiverCode: c.caregiverId, name: c.name, facts: c.facts })) };
        }),
    }),

    check_change: tool({
      description: "Check one change against every rule without saving anything.",
      inputSchema: z.object({ change: agentChange }),
      execute: async ({ change }) =>
        safely(async () => {
          const checked = await checkChange(sandboxId, toChangeInput(change));
          emit({ type: "tool", name: "check_change", summary: checked.ok ? `Checked ${change.kind}: every rule passes` : `Checked ${change.kind}: ${failedMessages(checked.ruleResults)[0]}` });
          return { ok: checked.ok, problems: failedMessages(checked.ruleResults), unitsLeftBefore: checked.unitsLeftBefore, unitsLeftAfter: checked.unitsLeftAfter };
        }),
    }),

    build_schedule: tool({
      description:
        "Build all visits for an authorization: spreads the units left evenly over the chosen weekdays within the time window, never above its limits, and gives each visit a caregiver. Returns a buildPlanId to pass to submit_proposal.",
      inputSchema: z.object({
        authorizationCode: CODE,
        days: z.array(z.enum(WEEKDAYS as [string, ...string[]])).min(1).max(7),
        windowStart: TIME,
        windowEnd: TIME,
        visitMinutes: z.number().int().min(15).max(720).optional().describe("Only if the coordinator asked for a fixed visit length"),
      }),
      execute: async (input) =>
        safely(async () => {
          const plan = await buildPlan(sandboxId, { ...input, days: input.days as any });
          const planId = `plan-${ctx.state.plans.size + 1}`;
          ctx.state.plans.set(planId, plan);
          const open = plan.visits.filter((v) => !v.caregiverCode).length;
          const caregivers = [...new Set(plan.visits.map((v) => v.caregiverName).filter(Boolean))];
          emit({ type: "tool", name: "build_schedule", summary: `Planned ${plan.visits.length} visits for ${plan.clientName} using ${plan.result.unitsScheduled} of ${plan.result.unitsAvailable} units` });
          return {
            buildPlanId: planId,
            visits: plan.visits.length,
            unitsAvailable: plan.result.unitsAvailable,
            unitsScheduled: plan.result.unitsScheduled,
            unitsNotScheduled: plan.result.unscheduledUnits,
            whyNotScheduled: plan.result.unscheduledReason,
            caregivers,
            openVisits: open,
            firstVisits: plan.visits.slice(0, 3).map((v) => ({ date: denverDate(v.start), start: denverTime(v.start), end: denverTime(v.end), units: v.units, caregiver: v.caregiverName ?? "open" })),
          };
        }),
    }),

    submit_proposal: tool({
      description:
        "Save the plan for the coordinator to review. Every change is checked against every rule together; if any fails, nothing is saved and you get the reasons. Call once, at the end.",
      inputSchema: z.object({
        summary: z.string().min(3).max(300).describe("One sentence the coordinator reads first"),
        changes: z.array(agentChange.extend({ reason: z.string().max(300) })).max(60).default([]),
        buildPlanId: z.string().max(20).optional(),
      }),
      execute: async ({ summary, changes, buildPlanId }) =>
        safely(async () => {
          if (ctx.state.proposalId) return { error: "A proposal was already saved for this request." };
          const all: ProposedChangeInput[] = changes.map((change) => ({ ...toChangeInput(change), reasons: [change.reason] }));
          if (buildPlanId) {
            const plan = ctx.state.plans.get(buildPlanId);
            if (!plan) return { error: `Unknown buildPlanId ${buildPlanId}.` };
            plan.visits.forEach((v) =>
              all.push({ kind: "create", clientCode: plan.clientCode, authorizationCode: plan.authorizationCode, caregiverCode: v.caregiverCode, start: v.start.toISOString(), end: v.end.toISOString(), reasons: [v.reason] })
            );
          }
          if (all.length === 0) return { error: "There is nothing to propose." };
          const result = await submitProposal(sandboxId, ctx.requestId, summary, all);
          if (!result.ok) {
            emit({ type: "tool", name: "submit_proposal", summary: `The rules refused ${result.failures.length} change${result.failures.length === 1 ? "" : "s"}; fixing the plan` });
            return { saved: false, refused: result.failures.map((f) => ({ changeNumber: f.index + 1, problems: f.messages })) };
          }
          ctx.state.proposalId = String(result.proposal._id);
          ctx.state.proposalSummary = result.proposal.summary;
          ctx.state.changeCount = result.proposal.changes.length;
          emit({ type: "tool", name: "submit_proposal", summary: `Saved a plan with ${all.length} change${all.length === 1 ? "" : "s"} for your review` });
          return { saved: true, proposalId: ctx.state.proposalId };
        }),
    }),

    ask_coordinator: tool({
      description: "Ask the coordinator one short question (e.g. which of two people they mean) and stop.",
      inputSchema: z.object({ question: z.string().min(3).max(300), choices: z.array(z.string().max(80)).max(6).optional() }),
      execute: async ({ question, choices }) => {
        ctx.state.asked = true;
        emit({ type: "question", text: question, choices });
        return { asked: true };
      },
    }),
  };
}
