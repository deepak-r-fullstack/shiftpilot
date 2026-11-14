import mongoose, { ClientSession, Types } from "mongoose";
import { BadRequestError, ConflictError, NotFoundError } from "../../helpers/errors";
import { AppliedPlan, AppliedPlanDoc } from "../../models/appliedPlan.model";
import { Proposal, ProposalDoc, ProposedChangeDoc, VisitSnapshot } from "../../models/proposal.model";
import { Sandbox } from "../../models/sandbox.model";
import { Visit } from "../../models/visit.model";
import { ChangeInput } from "../scheduling/changeChecker";
import { failedMessages } from "../scheduling/ruleChecker";
import { checkAll } from "./proposal.service";

// ---------------------------------------------------------------------------
// Applying and undoing a plan. Called by AgentGuard (after its own rules and,
// for big plans, a manager's approval), or directly when AgentGuard is not set up.
// Both run in one database transaction: every visit changes, or none does.
// Both refuse when a visit changed since the plan was made, so they never
// overwrite someone else's newer work.
// ---------------------------------------------------------------------------

export const STALE_MESSAGE = "Some visits changed since this plan was made. Ask the agent again.";
const APPLIED_DECISIONS = new Set(["approved", "edited", "auto_approved"]);

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

async function inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
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
  if (["undone", "denied"].includes(proposal.status)) throw new ConflictError("This plan can no longer be applied.");

  const changes = appliedChanges(proposal);
  if (changes.length === 0) throw new BadRequestError("Approve at least one change first.");
  const sandboxId = proposal.sandboxId;

  // Every rule again, all changes together, on today's data.
  const checked = await checkAll(sandboxId, changes.map(toInput));
  const broken = checked.find((c) => !c.ok);
  if (broken) throw new ConflictError(`${STALE_MESSAGE} (${failedMessages(broken.ruleResults)[0]})`);

  try {
    return await inTransaction(async (session) => {
      const beforeVisits: { visitCode: string; existed: boolean; caregiverCode: string | null; start: Date | null; end: Date | null; units: number | null; status: string | null }[] = [];
      const afterVersions: { visitCode: string; version: number }[] = [];

      for (const change of changes) {
        const after = change.after as VisitSnapshot;
        if (change.kind === "create") {
          const sandbox = await Sandbox.findByIdAndUpdate(sandboxId, { $inc: { nextVisitNumber: 1 } }, { session }).lean();
          if (!sandbox) throw new ConflictError("This demo session has ended.");
          const code = `V-${sandbox.nextVisitNumber}`;
          await Visit.create(
            [{ sandboxId, code, clientCode: after.clientCode, caregiverCode: after.caregiverCode, authorizationCode: after.authorizationCode, serviceCode: after.serviceCode, start: after.start, end: after.end, units: after.units, status: "scheduled", version: 0 }],
            { session }
          );
          beforeVisits.push({ visitCode: code, existed: false, caregiverCode: null, start: null, end: null, units: null, status: null });
          afterVersions.push({ visitCode: code, version: 0 });
          continue;
        }

        const before = change.before as VisitSnapshot;
        const updated = await Visit.findOneAndUpdate(
          { sandboxId, code: before.visitCode, version: before.version ?? 0 },
          {
            $set: { caregiverCode: after.caregiverCode, start: after.start, end: after.end, units: after.units, status: after.status },
            $inc: { version: 1 },
          },
          { new: true, session }
        ).lean();
        if (!updated) throw new ConflictError(STALE_MESSAGE);
        beforeVisits.push({ visitCode: before.visitCode!, existed: true, caregiverCode: before.caregiverCode ?? null, start: before.start, end: before.end, units: before.units, status: before.status });
        afterVersions.push({ visitCode: updated.code, version: updated.version });
      }

      await AppliedPlan.create([{ proposalId: proposal._id, sandboxId, beforeVisits, afterVersions, applied: changes.length }], { session });
      await Proposal.updateOne({ _id: proposal._id }, { status: "applied" }, { session });
      return { applied: changes.length };
    });
  } catch (err) {
    // Two runs at the same moment: only one can commit. The other sees the visits'
    // new versions (or the unique index) and fails; it then reports the winner's result.
    const winner = await AppliedPlan.findOne({ proposalId: proposal._id }).lean<AppliedPlanDoc>();
    if (winner) return { applied: winner.applied };
    throw err;
  }
}

/** Puts every visit of an applied plan back, once, and only if nothing changed since. */
export async function undoPlan(proposalId: string): Promise<{ undone: number }> {
  const proposal = await loadProposal(proposalId);
  const plan = await AppliedPlan.findOne({ proposalId: proposal._id }).lean<AppliedPlanDoc>();
  if (!plan) throw new ConflictError("This plan was never applied, so there is nothing to undo.");
  if (plan.undoneAt) return { undone: plan.beforeVisits.length };

  return inTransaction(async (session) => {
    const claimed = await AppliedPlan.findOneAndUpdate({ _id: plan._id, undoneAt: null }, { undoneAt: new Date() }, { session, new: true });
    if (!claimed) return { undone: plan.beforeVisits.length };

    for (const before of plan.beforeVisits) {
      const version = plan.afterVersions.find((v) => v.visitCode === before.visitCode)?.version ?? 0;
      const filter = { sandboxId: plan.sandboxId, code: before.visitCode, version };
      const result = before.existed
        ? await Visit.updateOne(filter, { $set: { caregiverCode: before.caregiverCode, start: before.start, end: before.end, units: before.units, status: before.status }, $inc: { version: 1 } }, { session })
        : await Visit.deleteOne(filter, { session });
      const touched = "modifiedCount" in result ? result.modifiedCount : (result as { deletedCount: number }).deletedCount;
      if (touched !== 1) throw new ConflictError("Some visits changed after this plan was applied, so undo would overwrite newer work.");
    }
    await Proposal.updateOne({ _id: proposal._id }, { status: "undone" }, { session });
    return { undone: plan.beforeVisits.length };
  });
}
