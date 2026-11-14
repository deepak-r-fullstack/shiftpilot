import { Proposal, ProposalDoc } from "../src/models/proposal.model";
import { Visit } from "../src/models/visit.model";
import { Authorization } from "../src/models/authorization.model";
import { AgentEvent } from "../src/services/agent/events";
import { addDays, dayRangeOfDate } from "../src/utils/time";

// ---------------------------------------------------------------------------
// What a good answer looks like, checked by code against the saved proposal.
// Each check returns null when it passes, or a short reason when it fails.
// ---------------------------------------------------------------------------

export type Check =
  | { kind: "proposal" }
  | { kind: "noProposal" }
  | { kind: "asked"; mentions?: string[] }
  | { kind: "coversVisitsOf"; caregiverCode: string; day: "tomorrow" }
  | { kind: "allRulesPass" }
  | { kind: "unitsWithinAuthorization"; authorizationCode: string }
  | { kind: "noCaregiver"; caregiverCode: string }
  | { kind: "maxChanges"; n: number };

export interface RunOutcome {
  sandboxId: string;
  today: string;
  events: AgentEvent[];
  proposal: ProposalDoc | null;
}

export async function loadOutcome(sandboxId: string, today: string, events: AgentEvent[]): Promise<RunOutcome> {
  const saved = events.find((e): e is Extract<AgentEvent, { type: "proposal" }> => e.type === "proposal");
  const proposal = saved ? await Proposal.findById(saved.proposalId).lean<ProposalDoc>() : null;
  return { sandboxId, today, events, proposal };
}

export async function runCheck(check: Check, outcome: RunOutcome): Promise<string | null> {
  const { proposal } = outcome;
  switch (check.kind) {
    case "proposal":
      return proposal ? null : "no proposal was saved";
    case "noProposal":
      return proposal ? "a proposal was saved but should not have been" : null;
    case "asked": {
      const question = outcome.events.find((e): e is Extract<AgentEvent, { type: "question" }> => e.type === "question");
      if (!question) return "the agent did not ask the coordinator";
      const text = `${question.text} ${(question.choices ?? []).join(" ")}`.toLowerCase();
      const missing = (check.mentions ?? []).filter((m) => !text.includes(m.toLowerCase()));
      return missing.length ? `the question did not mention ${missing.join(", ")}` : null;
    }
    case "coversVisitsOf": {
      if (!proposal) return "no proposal to check";
      const day = dayRangeOfDate(addDays(outcome.today, 1));
      const visits = await Visit.find({ sandboxId: outcome.sandboxId, caregiverCode: check.caregiverCode, status: "scheduled", start: { $gte: day.from, $lt: day.to } }).lean();
      const handled = new Set<string>(proposal.changes.filter((c) => c.after?.caregiverCode !== check.caregiverCode).map((c) => c.before?.visitCode ?? ""));
      const missed = visits.filter((v) => !handled.has(v.code)).map((v) => v.code);
      return missed.length ? `not covered: ${missed.join(", ")}` : null;
    }
    case "allRulesPass": {
      if (!proposal) return null; // nothing saved, nothing broken
      const broken = proposal.changes.flatMap((c) => c.ruleResults.filter((r) => !r.passed).map((r) => r.message ?? "A rule failed."));
      return broken.length ? broken[0] : null;
    }
    case "unitsWithinAuthorization": {
      if (!proposal) return "no proposal to check";
      const auth = await Authorization.findOne({ sandboxId: outcome.sandboxId, code: check.authorizationCode }).lean();
      if (!auth) return "authorization not found";
      const used = (await Visit.find({ sandboxId: outcome.sandboxId, authorizationCode: auth.code, status: { $ne: "cancelled" } }).lean()).reduce((s, v) => s + v.units, 0);
      const added = proposal.changes.filter((c) => c.kind === "create" && c.after?.authorizationCode === auth.code).reduce((s, c) => s + (c.after?.units ?? 0), 0);
      return used + added <= auth.totalUnits ? null : `uses ${used + added} of ${auth.totalUnits} units`;
    }
    case "noCaregiver": {
      if (!proposal) return null;
      const still = proposal.changes.filter((c) => c.after?.caregiverCode === check.caregiverCode && c.after.status !== "cancelled");
      return still.length ? `${check.caregiverCode} still has ${still.length} visit(s) in the plan` : null;
    }
    case "maxChanges":
      return proposal && proposal.changes.length > check.n ? `${proposal.changes.length} changes, expected at most ${check.n}` : null;
  }
}
