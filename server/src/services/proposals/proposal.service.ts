import { Types } from "mongoose";
import { BadRequestError, ConflictError, NotFoundError, RuleBreakError } from "../../helpers/errors";
import { Proposal, ProposalDoc } from "../../models/proposal.model";
import { findCandidatesForVisit } from "../scheduling/candidates.service";
import { ChangeInput, CheckedChange, checkChange, factsOf, resolveChange, VisitShape } from "../scheduling/changeChecker";
import { SiblingVisit } from "../scheduling/factsLoader";
import { failedMessages } from "../scheduling/ruleChecker";
import { RuleResult } from "../scheduling/types";

// ---------------------------------------------------------------------------
// Proposals: the agent's suggested changes, waiting for the coordinator.
// A proposal is saved only when EVERY change passes every rule, checked
// together, so two changes in one plan can never clash with each other.
// ---------------------------------------------------------------------------

export type ProposedChangeInput = ChangeInput & { reasons?: string[] };

export interface ProposalFailure {
  index: number;
  messages: string[];
  results: RuleResult[];
}

export type SubmitResult = { ok: true; proposal: ProposalDoc } | { ok: false; failures: ProposalFailure[] };

const temporaryId = (index: number) => `new-${index + 1}`;

/** Each change's "after" visit as rule facts, so the others can be checked against it. */
function siblingsFrom(afters: (VisitShape | null)[], skip: number): SiblingVisit[] {
  return afters.flatMap((after, index) => (after && index !== skip ? [factsOf(after, temporaryId(index))] : []));
}

export async function checkAll(sandboxId: string, changes: ChangeInput[]): Promise<CheckedChange[]> {
  const codes = changes.map((c) => c.visitCode?.toUpperCase()).filter(Boolean);
  if (new Set(codes).size !== codes.length) throw new BadRequestError("Each visit can only be changed once in a plan.");
  const afters = await Promise.all(changes.map(async (change) => (await resolveChange(sandboxId, change)).after));
  return Promise.all(changes.map((change, index) => checkChange(sandboxId, change, siblingsFrom(afters, index))));
}

function toStoredChange(checked: CheckedChange, reasons: string[]) {
  return {
    kind: checked.input.kind,
    before: checked.before,
    after: checked.after,
    reasons,
    ruleResults: checked.ruleResults,
    unitsLeftBefore: checked.unitsLeftBefore,
    unitsLeftAfter: checked.unitsLeftAfter,
    lowRisk: checked.lowRisk,
    decision: checked.lowRisk ? "auto_approved" : "pending",
  };
}

export async function submitProposal(
  sandboxId: string,
  requestId: string | null,
  summary: string,
  changes: ProposedChangeInput[]
): Promise<SubmitResult> {
  if (changes.length === 0) throw new BadRequestError("A plan needs at least one change.");
  if (changes.length > 200) throw new BadRequestError("A plan can have at most 200 changes.");
  const checked = await checkAll(sandboxId, changes);
  const failures = checked.flatMap((c, index) => (c.ok ? [] : [{ index, messages: failedMessages(c.ruleResults), results: c.ruleResults }]));
  if (failures.length > 0) return { ok: false, failures };

  const proposal = await Proposal.create({
    sandboxId,
    requestId: requestId ? new Types.ObjectId(requestId) : null,
    summary: summary.trim().slice(0, 500) || "Schedule changes",
    changes: checked.map((c, index) => toStoredChange(c, (changes[index].reasons ?? []).map((r) => r.slice(0, 300)).slice(0, 5))),
  });
  return { ok: true, proposal: proposal.toObject() as ProposalDoc };
}

export async function getProposal(sandboxId: string, proposalId: string): Promise<ProposalDoc> {
  if (!Types.ObjectId.isValid(proposalId)) throw new NotFoundError("We could not find that plan.");
  const proposal = await Proposal.findOne({ _id: proposalId, sandboxId }).lean<ProposalDoc>();
  if (!proposal) throw new NotFoundError("We could not find that plan.");
  return proposal;
}

function findChange(proposal: ProposalDoc, changeId: string) {
  const change = proposal.changes.find((c) => String(c._id) === changeId);
  if (!change) throw new NotFoundError("We could not find that change.");
  return change;
}

function assertDraft(proposal: ProposalDoc) {
  if (proposal.status !== "draft") throw new ConflictError("This plan was already sent to be applied, so it can no longer be changed.");
}

/** Approve or reject one change. */
export async function decideChange(sandboxId: string, proposalId: string, changeId: string, decision: "approve" | "reject") {
  const proposal = await getProposal(sandboxId, proposalId);
  assertDraft(proposal);
  findChange(proposal, changeId);
  const updated = await Proposal.findOneAndUpdate(
    { _id: proposalId, sandboxId, status: "draft", "changes._id": changeId },
    { $set: { "changes.$.decision": decision === "approve" ? "approved" : "rejected" } },
    { new: true }
  ).lean<ProposalDoc>();
  if (!updated) throw new ConflictError("This plan changed while you were deciding. Please look again.");
  return updated;
}

export async function approveAll(sandboxId: string, proposalId: string) {
  const proposal = await getProposal(sandboxId, proposalId);
  assertDraft(proposal);
  const changes = proposal.changes.map((c) => (c.decision === "pending" ? { ...c, decision: "approved" as const } : c));
  const updated = await Proposal.findOneAndUpdate({ _id: proposalId, sandboxId, status: "draft" }, { $set: { changes } }, { new: true }).lean<ProposalDoc>();
  if (!updated) throw new ConflictError("This plan changed while you were deciding. Please look again.");
  return updated;
}

/** The other non-rejected changes of a proposal, as rule facts. */
function siblingsOf(proposal: ProposalDoc, exceptChangeId: string): SiblingVisit[] {
  return proposal.changes.flatMap((c, index) =>
    String(c._id) !== exceptChangeId && c.decision !== "rejected" && c.after ? [factsOf(c.after as VisitShape, temporaryId(index))] : []
  );
}

export interface EditInput {
  caregiverCode?: string | null;
  start?: string;
  end?: string;
}

/** The coordinator picks another caregiver or time. Checked again at once; refused if a rule breaks. */
export async function editChange(sandboxId: string, proposalId: string, changeId: string, edit: EditInput) {
  const proposal = await getProposal(sandboxId, proposalId);
  assertDraft(proposal);
  const change = findChange(proposal, changeId);
  if (change.kind === "cancel") throw new BadRequestError("A cancellation has nothing to edit. Reject it instead.");
  const after = change.after as VisitShape;

  const caregiverCode = edit.caregiverCode !== undefined ? edit.caregiverCode : after.caregiverCode;
  const timeChanged = Boolean(edit.start || edit.end);
  let input: ChangeInput;
  if (change.kind === "create") {
    input = {
      kind: "create",
      clientCode: after.clientCode,
      authorizationCode: after.authorizationCode,
      caregiverCode,
      start: edit.start ?? after.start.toISOString(),
      end: edit.end ?? after.end.toISOString(),
    };
  } else if (change.kind === "move" || timeChanged) {
    input = {
      kind: "move",
      visitCode: change.before!.visitCode!,
      caregiverCode,
      start: edit.start ?? after.start.toISOString(),
      end: edit.end ?? after.end.toISOString(),
    };
  } else {
    input = { kind: "assign", visitCode: change.before!.visitCode!, caregiverCode };
  }

  const checked = await checkChange(sandboxId, input, siblingsOf(proposal, changeId));
  if (!checked.ok) {
    throw new RuleBreakError(failedMessages(checked.ruleResults)[0] ?? "This change breaks a rule.", { ruleResults: checked.ruleResults });
  }
  const updated = await Proposal.findOneAndUpdate(
    { _id: proposalId, sandboxId, status: "draft", "changes._id": changeId },
    {
      $set: {
        "changes.$.kind": input.kind,
        "changes.$.after": checked.after,
        "changes.$.ruleResults": checked.ruleResults,
        "changes.$.unitsLeftBefore": checked.unitsLeftBefore,
        "changes.$.unitsLeftAfter": checked.unitsLeftAfter,
        "changes.$.lowRisk": false,
        "changes.$.decision": "edited",
      },
    },
    { new: true }
  ).lean<ProposalDoc>();
  if (!updated) throw new ConflictError("This plan changed while you were editing. Please look again.");
  return updated;
}

/** Caregivers who could take this change's visit instead, given the rest of the plan. */
export async function candidatesForChange(sandboxId: string, proposalId: string, changeId: string) {
  const proposal = await getProposal(sandboxId, proposalId);
  const change = findChange(proposal, changeId);
  if (!change.after || change.kind === "cancel") return [];
  const visit = { ...factsOf(change.after as VisitShape, "editing"), caregiverId: null };
  // Covering someone (assign): offer anyone but the person being replaced. Moving a visit: they may keep it.
  const exclude = change.kind === "assign" && change.before?.caregiverCode ? [change.before.caregiverCode] : [];
  return findCandidatesForVisit(sandboxId, visit, { siblings: siblingsOf(proposal, changeId), exclude, limit: 8 });
}
