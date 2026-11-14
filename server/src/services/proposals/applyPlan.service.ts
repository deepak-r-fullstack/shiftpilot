import mongoose, { ClientSession, Types } from "mongoose";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/errors";
import { AppliedPlan, AppliedPlanDoc } from "../../models/appliedPlan.model";
import { Proposal, ProposalDoc, ProposedChangeDoc, VisitSnapshot } from "../../models/proposal.model";
import { Sandbox } from "../../models/sandbox.model";
import { Visit } from "../../models/visit.model";
import { ChangeInput } from "../scheduling/changeChecker";
import { loadRuleContext, SiblingVisit } from "../scheduling/factsLoader";
import { checkVisit, failedMessages } from "../scheduling/ruleChecker";
import { VisitFacts } from "../scheduling/types";
import { checkAll } from "./proposal.service";

// ---------------------------------------------------------------------------
// Applying and undoing a plan. Called by AgentGuard (after its own rules and,
// for big plans, a manager's approval), or directly when AgentGuard is not set up.
//
// Both run in one database transaction: every visit changes, or none does.
// Both first "lock" the visitor's agency (bump Sandbox.scheduleVersion), so two
// plans applied at the same moment cannot both pass the rules and double-book:
// one transaction conflicts, retries, and checks again against the other's result.
// Both re-check every scheduling rule inside the transaction, and refuse when a
// visit changed since, so they never overwrite someone else's newer work.
// ---------------------------------------------------------------------------

export const STALE_MESSAGE = "Some visits changed since this plan was made. Ask the agent again.";
const APPLIED_DECISIONS = new Set(["approved", "edited", "auto_approved"]);
// Only a plan the coordinator sent (or one a manager is deciding on) can run.
const RUNNABLE = new Set(["applying", "pending_approval"]);

export function appliedChanges(proposal: ProposalDoc): ProposedChangeDoc[] {
  return proposal.changes.filter((change) => APPLIED_DECISIONS.has(change.decision));
}

async function loadProposal(proposalId: string): Promise<ProposalDoc> {
  if (!Types.ObjectId.isValid(proposalId)) throw new NotFoundError("We could not find that plan.");
  const proposal = await Proposal.findById(proposalId).lean<ProposalDoc>();
  if (!proposal) throw new NotFoundError("We could not find that plan.");
  return proposal;
}

/** The facts AgentGuard's rules look at. Counted from approved changes only. */
export async function planFacts(proposalId: string) {
  const proposal = await loadProposal(proposalId);
  const sandbox = await Sandbox.findById(proposal.sandboxId).lean();
  const changes = appliedChanges(proposal);
  const existingVisitsChanged = changes.filter((c) => c.kind !== "create").length;
  const newVisits = changes.filter((c) => c.kind === "create").length;
  const caregiversRemoved = changes.filter((c) => c.before?.caregiverCode && c.after?.caregiverCode !== c.before.caregiverCode).length;
  return {
    proposalId: String(proposal._id),
    status: proposal.status,
    summary: proposal.summary,
    sandboxLabel: sandbox?.label ?? "Expired demo",
    existingVisitsChanged,
    newVisits,
    caregiversRemoved,
  };
}

function toInput(change: ProposedChangeDoc): ChangeInput {
  const after = change.after as VisitSnapshot;
  if (change.kind === "create") {
    return { kind: "create", clientCode: after.clientCode, authorizationCode: after.authorizationCode, caregiverCode: after.caregiverCode, start: after.start.toISOString(), end: after.end.toISOString() };
  }
  const visitCode = change.before!.visitCode!;
  if (change.kind === "cancel") return { kind: "cancel", visitCode };
  if (change.kind === "assign") return { kind: "assign", visitCode, caregiverCode: after.caregiverCode };
  return { kind: "move", visitCode, caregiverCode: after.caregiverCode, start: after.start.toISOString(), end: after.end.toISOString() };
}

async function inTransaction<T>(sandboxId: string, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      // The lock: two transactions writing this one document cannot both commit.
      const locked = await Sandbox.updateOne({ _id: sandboxId }, { $inc: { scheduleVersion: 1 } }, { session });
      if (locked.matchedCount !== 1) throw new ConflictError("This demo session has ended.");
      result = await work(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

/** Applies the approved changes of a plan, once. A second call returns the first result. */
export async function runPlan(proposalId: string): Promise<{ applied: number }> {
  const proposal = await loadProposal(proposalId);
  const done = await AppliedPlan.findOne({ proposalId: proposal._id }).lean<AppliedPlanDoc>();
  if (done) return { applied: done.applied };
  if (!RUNNABLE.has(proposal.status)) throw new ConflictError("This plan has not been sent to be applied, or was already handled.");

  const changes = appliedChanges(proposal);
  if (changes.length === 0) throw new BadRequestError("Approve at least one change first.");
  const sandboxId = proposal.sandboxId;

  try {
    return await inTransaction(sandboxId, async (session) => {
      // Every rule again, all changes together, on the data as it is now (after the lock).
      const checked = await checkAll(sandboxId, changes.map(toInput));
      const broken = checked.find((c) => !c.ok);
      if (broken) throw new ConflictError(`${STALE_MESSAGE} (${failedMessages(broken.ruleResults)[0]})`);

      const beforeVisits: { visitCode: string; existed: boolean; caregiverCode: string | null; start: Date | null; end: Date | null; units: number | null; status: string | null }[] = [];
      const afterVersions: { visitCode: string; version: number }[] = [];

      for (const change of changes.filter((c) => c.kind !== "create")) {
        const before = change.before as VisitSnapshot;
        const after = change.after as VisitSnapshot;
        const updated = await Visit.findOneAndUpdate(
          { sandboxId, code: before.visitCode, version: before.version ?? 0 },
          { $set: { caregiverCode: after.caregiverCode, start: after.start, end: after.end, units: after.units, status: after.status }, $inc: { version: 1 } },
          { new: true, session }
        ).lean();
        if (!updated) throw new ConflictError(STALE_MESSAGE);
        beforeVisits.push({ visitCode: before.visitCode!, existed: true, caregiverCode: before.caregiverCode ?? null, start: before.start, end: before.end, units: before.units, status: before.status });
        afterVersions.push({ visitCode: updated.code, version: updated.version });
      }

      // New visits: one block of codes, one insert (a whole schedule can be ~75 visits).
      const creates = changes.filter((c) => c.kind === "create");
      if (creates.length > 0) {
        const sandbox = await Sandbox.findByIdAndUpdate(sandboxId, { $inc: { nextVisitNumber: creates.length } }, { session }).lean();
        if (!sandbox) throw new ConflictError("This demo session has ended.");
        const docs = creates.map((change, index) => {
          const after = change.after as VisitSnapshot;
          const code = `V-${sandbox.nextVisitNumber + index}`;
          beforeVisits.push({ visitCode: code, existed: false, caregiverCode: null, start: null, end: null, units: null, status: null });
          afterVersions.push({ visitCode: code, version: 0 });
          return { sandboxId, code, clientCode: after.clientCode, caregiverCode: after.caregiverCode, authorizationCode: after.authorizationCode, serviceCode: after.serviceCode, start: after.start, end: after.end, units: after.units, status: "scheduled", version: 0 };
        });
        await Visit.insertMany(docs, { session });
      }

      await AppliedPlan.create([{ proposalId: proposal._id, sandboxId, beforeVisits, afterVersions, applied: changes.length }], { session });
      await Proposal.updateOne({ _id: proposal._id }, { status: "applied" }, { session });
      return { applied: changes.length };
    });
  } catch (err) {
    // Two runs at the same moment: only one can commit; the other reports the winner's result.
    const winner = await AppliedPlan.findOne({ proposalId: proposal._id }).lean<AppliedPlanDoc>();
    if (winner) return { applied: winner.applied };
    throw err;
  }
}

/**
 * Undo would bring cancelled or moved visits back. Check those against every rule too:
 * another plan may have used the slot or the units since.
 */
async function checkRestore(sandboxId: string, plan: AppliedPlanDoc): Promise<string | null> {
  const stored = await Visit.find({ sandboxId, code: { $in: plan.beforeVisits.map((b) => b.visitCode) } }).lean();
  const byCode = new Map(stored.map((v) => [v.code, v]));
  const restored: VisitFacts[] = plan.beforeVisits
    .filter((b) => b.existed && b.status === "scheduled" && byCode.has(b.visitCode))
    .map((b) => {
      const v = byCode.get(b.visitCode)!;
      return { id: b.visitCode, clientId: v.clientCode, caregiverId: b.caregiverCode ?? null, authorizationId: v.authorizationCode, serviceCode: v.serviceCode, start: b.start!, end: b.end!, units: b.units!, status: "scheduled" };
    });
  const removed: SiblingVisit[] = plan.beforeVisits
    .filter((b) => !b.existed && byCode.has(b.visitCode))
    .map((b) => {
      const v = byCode.get(b.visitCode)!;
      return { id: v.code, clientId: v.clientCode, caregiverId: v.caregiverCode ?? null, authorizationId: v.authorizationCode, serviceCode: v.serviceCode, start: v.start, end: v.end, units: v.units, status: "cancelled" };
    });
  for (const visit of restored) {
    const siblings = [...restored.filter((other) => other.id !== visit.id), ...removed];
    const problems = failedMessages(checkVisit(await loadRuleContext(sandboxId, visit, siblings)));
    if (problems.length) return problems[0];
  }
  return null;
}

/** Puts every visit of an applied plan back, once, only if nothing changed since and every rule still passes. */
export async function undoPlan(proposalId: string): Promise<{ undone: number }> {
  const proposal = await loadProposal(proposalId);
  const plan = await AppliedPlan.findOne({ proposalId: proposal._id }).lean<AppliedPlanDoc>();
  if (!plan) throw new ConflictError("This plan was never applied, so there is nothing to undo.");
  if (plan.undoneAt) return { undone: plan.beforeVisits.length };

  return inTransaction(plan.sandboxId, async (session) => {
    const claimed = await AppliedPlan.findOneAndUpdate({ _id: plan._id, undoneAt: null }, { undoneAt: new Date() }, { session, new: true });
    if (!claimed) return { undone: plan.beforeVisits.length };

    for (const before of plan.beforeVisits) {
      const version = plan.afterVersions.find((v) => v.visitCode === before.visitCode)?.version ?? 0;
      const current = await Visit.findOne({ sandboxId: plan.sandboxId, code: before.visitCode }, { version: 1 }).session(session).lean();
      if (!current || current.version !== version) throw new ConflictError("Some visits changed after this plan was applied, so undo would overwrite newer work.");
    }
    const problem = await checkRestore(plan.sandboxId, plan);
    if (problem) throw new ConflictError(`Undo would break a scheduling rule: ${problem}`);

    for (const before of plan.beforeVisits) {
      const version = plan.afterVersions.find((v) => v.visitCode === before.visitCode)?.version ?? 0;
      const filter = { sandboxId: plan.sandboxId, code: before.visitCode, version };
      if (before.existed) {
        await Visit.updateOne(filter, { $set: { caregiverCode: before.caregiverCode, start: before.start, end: before.end, units: before.units, status: before.status }, $inc: { version: 1 } }, { session });
      } else {
        await Visit.deleteOne(filter, { session });
      }
    }
    await Proposal.updateOne({ _id: proposal._id }, { status: "undone" }, { session });
    return { undone: plan.beforeVisits.length };
  });
}

/** Whether this plan's visits really changed in ShiftPilot (the truth, whatever AgentGuard reports). */
export async function appliedState(proposalId: Types.ObjectId | string): Promise<"applied" | "undone" | null> {
  const plan = await AppliedPlan.findOne({ proposalId }).lean<AppliedPlanDoc>();
  if (!plan) return null;
  return plan.undoneAt ? "undone" : "applied";
}
