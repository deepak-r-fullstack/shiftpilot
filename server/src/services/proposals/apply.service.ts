import { BadRequestError, ConflictError } from "../../helpers/errors";
import { Proposal, ProposalDoc } from "../../models/proposal.model";
import { actionUrl, getActionStatus, isAgentGuardConfigured, submitPlan } from "../integrations/agentGuard.client";
import { RecordingHandle } from "../integrations/agentReplay";
import { appliedChanges, appliedState, runPlan, undoPlan } from "./applyPlan.service";
import { getProposal } from "./proposal.service";

// The coordinator presses Apply. The plan goes to AgentGuard (or is applied
// directly when AgentGuard is not set up). A double click, or a second tab,
// sends it only once: the draft -> applying switch happens in one atomic update.
//
// ShiftPilot's own record is the truth about the visits: if the plan was applied
// here, it shows as applied even when AgentGuard timed out and called it failed.
// In that case (or with no AgentGuard at all) Undo is offered here instead.

// AgentGuard's action status -> this plan's status.
const STATUS_MAP: Record<string, ProposalDoc["status"]> = {
  done: "applied",
  pending_approval: "pending_approval",
  denied: "denied",
  rejected: "denied",
  expired: "denied",
  failed: "failed",
  executing: "applying",
  undoing: "applied",
  undone: "undone",
};

const UNDO_HERE_WHEN = new Set(["local", "failed", "missing"]);

export function canUndoHere(proposal: ProposalDoc): boolean {
  return proposal.status === "applied" && (!proposal.guardActionId || UNDO_HERE_WHEN.has(proposal.guardStatus ?? ""));
}

export function describeGuard(proposal: ProposalDoc) {
  return {
    status: proposal.status,
    guardStatus: proposal.guardStatus,
    guardMessage: proposal.guardMessage,
    guardUrl: proposal.guardActionId ? actionUrl(proposal.guardActionId) : null,
    agentGuardConnected: isAgentGuardConfigured(),
    canUndoHere: canUndoHere(proposal),
  };
}

/** Our status from AgentGuard's, corrected by what really happened to the visits here. */
async function reconcile(proposalId: string, guardStatus: string): Promise<{ status: ProposalDoc["status"]; note: string | null }> {
  const local = await appliedState(proposalId);
  const mapped = STATUS_MAP[guardStatus] ?? "applying";
  if (local === "applied" && mapped !== "applied") {
    return { status: "applied", note: "Applied. AgentGuard lost track of it (it took too long), so Undo is offered here." };
  }
  if (local === "undone") return { status: "undone", note: null };
  return { status: mapped, note: null };
}

export async function applyProposal(sandboxId: string, proposalId: string, coordinatorEmail: string, recorder?: RecordingHandle | null) {
  const current = await getProposal(sandboxId, proposalId);
  if (current.status === "draft" && appliedChanges(current).length === 0) throw new BadRequestError("Approve at least one change first.");

  const claimed = await Proposal.findOneAndUpdate(
    { _id: proposalId, sandboxId, status: "draft" },
    { status: "applying", $inc: { applyAttempt: 1 } },
    { new: true }
  ).lean<ProposalDoc>();
  // Already sent (double click, second tab): show where it stands, never send again.
  if (!claimed) return getProposal(sandboxId, proposalId);

  if (!isAgentGuardConfigured()) {
    try {
      await runPlan(proposalId);
      return (await Proposal.findByIdAndUpdate(proposalId, { guardStatus: "local", guardMessage: "AgentGuard is not connected, so the plan was applied directly." }, { new: true }).lean<ProposalDoc>())!;
    } catch (err) {
      await Proposal.updateOne({ _id: proposalId, status: "applying" }, { status: "draft" });
      throw err;
    } finally {
      recorder?.end();
    }
  }

  try {
    const action = await submitPlan({ proposalId, coordinatorEmail, summary: claimed.summary, attempt: claimed.applyAttempt });
    recorder?.link("apply_plan", action.actionId, actionUrl(action.actionId));
    const { status, note } = await reconcile(proposalId, action.status);
    const guardStatus = note ? "failed" : action.status;
    return (await Proposal.findByIdAndUpdate(
      proposalId,
      { status, guardActionId: action.actionId, guardStatus, guardMessage: note ?? action.reasons?.[0] ?? action.message },
      { new: true }
    ).lean<ProposalDoc>())!;
  } catch (err) {
    // Nothing reached AgentGuard (or it failed before deciding): let the coordinator try again,
    // unless the plan was applied here after all.
    if ((await appliedState(proposalId)) === "applied") {
      return (await Proposal.findByIdAndUpdate(proposalId, { status: "applied", guardStatus: "failed", guardMessage: "Applied. AgentGuard did not confirm it, so Undo is offered here." }, { new: true }).lean<ProposalDoc>())!;
    }
    await Proposal.updateOne({ _id: proposalId, status: "applying", guardActionId: null }, { status: "draft" });
    throw err;
  } finally {
    recorder?.end();
  }
}

/** Refreshes a sent plan's status from AgentGuard (approved, undone, ...). */
export async function refreshGuardStatus(sandboxId: string, proposalId: string) {
  const proposal = await getProposal(sandboxId, proposalId);
  if (!proposal.guardActionId || !isAgentGuardConfigured()) return proposal;
  const action = await getActionStatus(proposal.guardActionId);
  if (!action) {
    const local = await appliedState(proposalId);
    return (await Proposal.findByIdAndUpdate(
      proposalId,
      { ...(local ? { status: local } : {}), guardStatus: "missing", guardMessage: "This record was reset in AgentGuard." + (local === "applied" ? " Undo is offered here." : "") },
      { new: true }
    ).lean<ProposalDoc>())!;
  }
  const { status, note } = await reconcile(proposalId, action.status);
  return (await Proposal.findByIdAndUpdate(
    proposalId,
    { status, guardStatus: note ? "failed" : action.status, guardMessage: note ?? action.reasons?.[0] ?? action.message },
    { new: true }
  ).lean<ProposalDoc>())!;
}

/** Undo in ShiftPilot itself: only when AgentGuard is not connected, or lost track of this plan. */
export async function undoHere(sandboxId: string, proposalId: string) {
  const proposal = await getProposal(sandboxId, proposalId);
  if (!canUndoHere(proposal)) throw new ConflictError("Undo this plan in AgentGuard, where it was approved.");
  await undoPlan(proposalId);
  return getProposal(sandboxId, proposalId);
}
