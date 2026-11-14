import { BadRequestError, ServiceUnavailableError } from "../../helpers/errors";
import { Proposal, ProposalDoc } from "../../models/proposal.model";
import { actionUrl, getActionStatus, isAgentGuardConfigured, submitPlan } from "../integrations/agentGuard.client";
import { RecordingHandle } from "../integrations/agentReplay";
import { appliedChanges, runPlan } from "./applyPlan.service";
import { getProposal } from "./proposal.service";

// The coordinator presses Apply. The plan goes to AgentGuard (or is applied
// directly when AgentGuard is not set up). A double click, or a second tab,
// sends it only once: the draft -> applying switch happens in one atomic update.

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

export function describeGuard(proposal: ProposalDoc) {
  return {
    status: proposal.status,
    guardStatus: proposal.guardStatus,
    guardMessage: proposal.guardMessage,
    guardUrl: proposal.guardActionId ? actionUrl(proposal.guardActionId) : null,
    agentGuardConnected: isAgentGuardConfigured(),
  };
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
      return (await Proposal.findByIdAndUpdate(proposalId, { guardStatus: "local", guardMessage: "AgentGuard not connected: applied directly." }, { new: true }).lean<ProposalDoc>())!;
    } catch (err) {
      await Proposal.updateOne({ _id: proposalId, status: "applying" }, { status: "draft" });
      throw err;
    }
  }

  try {
    const action = await submitPlan({ proposalId, coordinatorEmail, summary: claimed.summary, attempt: claimed.applyAttempt });
    recorder?.link("apply_plan", action.actionId, actionUrl(action.actionId));
    const status = STATUS_MAP[action.status] ?? "applying";
    return (await Proposal.findByIdAndUpdate(
      proposalId,
      { status: status === "applied" ? "applied" : status, guardActionId: action.actionId, guardStatus: action.status, guardMessage: action.reasons?.[0] ?? action.message },
      { new: true }
    ).lean<ProposalDoc>())!;
  } catch (err) {
    // Nothing reached AgentGuard (or it failed): let the coordinator try again.
    await Proposal.updateOne({ _id: proposalId, status: "applying", guardActionId: null }, { status: "draft" });
    if (err instanceof ServiceUnavailableError) throw err;
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
    return (await Proposal.findByIdAndUpdate(proposalId, { guardStatus: "missing", guardMessage: "This record was reset in AgentGuard." }, { new: true }).lean<ProposalDoc>())!;
  }
  const status = STATUS_MAP[action.status] ?? proposal.status;
  return (await Proposal.findByIdAndUpdate(proposalId, { status, guardStatus: action.status, guardMessage: action.reasons?.[0] ?? action.message }, { new: true }).lean<ProposalDoc>())!;
}
