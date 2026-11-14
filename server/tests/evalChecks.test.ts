import { Proposal } from "../src/models/proposal.model";
import { submitProposal } from "../src/services/proposals/proposal.service";
import { loadOutcome, runCheck } from "../evals/checks";
import { newSandbox, priyaVisitsTomorrow, TODAY } from "./helpers/fixtures";
import { startTestDb, stopTestDb } from "./helpers/testDb";

describe("eval checks", () => {
  let sandboxId: string;
  beforeAll(async () => {
    await startTestDb();
    sandboxId = await newSandbox();
  });
  afterAll(stopTestDb);

  it("passes a plan that covers every visit, and fails one that misses a visit", async () => {
    const visits = await priyaVisitsTomorrow(sandboxId);
    const full = await submitProposal(sandboxId, null, "all", visits.map((v, i) => ({ kind: "assign" as const, visitCode: v.code, caregiverCode: ["CG-02", "CG-03", "CG-04"][i % 3] })));
    const partial = await submitProposal(sandboxId, null, "one", [{ kind: "assign", visitCode: visits[0].code, caregiverCode: "CG-02" }]);
    if (!full.ok || !partial.ok) throw new Error("expected valid plans");

    const event = (id: unknown) => [{ type: "proposal" as const, proposalId: String(id), summary: "", changes: 1 }];
    const good = await loadOutcome(sandboxId, TODAY, event(full.proposal._id));
    const bad = await loadOutcome(sandboxId, TODAY, event(partial.proposal._id));
    const covers = { kind: "coversVisitsOf" as const, caregiverCode: "CG-01", day: "tomorrow" as const };
    expect(await runCheck(covers, good)).toBeNull();
    expect(await runCheck(covers, bad)).toContain("not covered");
    expect(await runCheck({ kind: "noCaregiver", caregiverCode: "CG-01" }, good)).toBeNull();
    expect(await runCheck({ kind: "allRulesPass" }, good)).toBeNull();
    expect(await runCheck({ kind: "maxChanges", n: 1 }, good)).toContain("expected at most 1");
    expect(await runCheck({ kind: "noProposal" }, good)).toContain("should not");
    expect(await Proposal.countDocuments()).toBe(2);
  });

  it("checks questions and missing proposals", async () => {
    const asked = await loadOutcome(sandboxId, TODAY, [{ type: "question", text: "Which Maria?", choices: ["Maria Lopez", "Maria Chen"] }]);
    expect(await runCheck({ kind: "asked", mentions: ["Lopez", "Chen"] }, asked)).toBeNull();
    expect(await runCheck({ kind: "noProposal" }, asked)).toBeNull();
    expect(await runCheck({ kind: "proposal" }, asked)).toBe("no proposal was saved");
    const silent = await loadOutcome(sandboxId, TODAY, [{ type: "status", text: "I only help with scheduling." }]);
    expect(await runCheck({ kind: "asked" }, silent)).toContain("did not ask");
  });
});
