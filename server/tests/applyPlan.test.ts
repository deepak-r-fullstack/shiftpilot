import request from "supertest";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { Proposal } from "../src/models/proposal.model";
import { Visit } from "../src/models/visit.model";
import { FIXTURES } from "../src/services/demo/seedData";
import { runPlan, undoPlan } from "../src/services/proposals/applyPlan.service";
import { approveAll, submitProposal } from "../src/services/proposals/proposal.service";
import { atDenver } from "../src/utils/time";
import { newSession, priyaVisitsTomorrow, TOMORROW } from "./helpers/fixtures";
import { startTestDb, stopTestDb } from "./helpers/testDb";

const app = createApp();
const SECRET = { "x-shiftpilot-secret": "test-internal-secret" };

describe("applying and undoing plans", () => {
  let sandboxId: string;
  let auth: Record<string, string>;
  beforeAll(async () => {
    await startTestDb();
    ({ sandboxId, auth } = await newSession());
  });
  afterAll(stopTestDb);
  afterEach(() => {
    jest.restoreAllMocks();
    env.AGENTGUARD_URL = "";
    env.SHIFTPILOT_AGENT_KEY = "";
  });

  /** Cover Priya's visits tomorrow (3 assigns) plus one new visit for Asha; all approved. */
  async function approvedPlan(approve = true) {
    const visits = await priyaVisitsTomorrow(sandboxId);
    const result = await submitProposal(sandboxId, null, "Cover Priya and add one visit", [
      ...visits.map((v, i) => ({ kind: "assign" as const, visitCode: v.code, caregiverCode: ["CG-02", "CG-03", "CG-04"][i % 3] })),
      {
        kind: "create" as const,
        clientCode: FIXTURES.asha,
        authorizationCode: FIXTURES.ashaAuthorization,
        caregiverCode: "CG-02",
        start: atDenver(TOMORROW, "16:00").toISOString(),
        end: atDenver(TOMORROW, "18:00").toISOString(),
      },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.failures));
    const id = String(result.proposal._id);
    if (approve) await approveAll(sandboxId, id);
    return { id, visits };
  }

  /** What Apply does before AgentGuard calls us: the plan is "applying". */
  async function sent(id: string) {
    await Proposal.updateOne({ _id: id }, { status: "applying" });
    return id;
  }

  it("keeps the internal endpoints behind the shared secret", async () => {
    const { id } = await approvedPlan();
    await request(app).get(`/api/internal/plans/${id}/facts`).expect(401);
    await request(app).get(`/api/internal/plans/${id}/facts`).set({ "x-shiftpilot-secret": "wrong-secret-xxxxxxx" }).expect(401);
    const res = await request(app).get(`/api/internal/plans/${id}/facts`).set(SECRET).expect(200);
    expect(res.body.data).toMatchObject({ existingVisitsChanged: 3, newVisits: 1, caregiversRemoved: 3 });
  });

  it("counts only approved changes in the facts", async () => {
    const { id } = await approvedPlan(false);
    const res = await request(app).get(`/api/internal/plans/${id}/facts`).set(SECRET);
    expect(res.body.data).toMatchObject({ existingVisitsChanged: 0, newVisits: 0 });
  });

  it("applies once, then undoes exactly, deleting created visits", async () => {
    const { id, visits } = await approvedPlan();
    await sent(id);
    const [first, second] = await Promise.all([runPlan(id), runPlan(id)]);
    expect(first).toEqual({ applied: 4 });
    expect(second).toEqual({ applied: 4 });
    const after = await Visit.find({ sandboxId, code: { $in: visits.map((v) => v.code) } }).lean();
    expect(after.every((v) => v.caregiverCode !== FIXTURES.priya && v.version === 1)).toBe(true);
    expect(await Visit.countDocuments({ sandboxId, authorizationCode: FIXTURES.ashaAuthorization })).toBe(1);
    expect((await Proposal.findById(id).lean())?.status).toBe("applied");

    await undoPlan(id);
    expect(await undoPlan(id)).toEqual({ undone: 4 }); // a second undo changes nothing
    const restored = await Visit.find({ sandboxId, code: { $in: visits.map((v) => v.code) } }).lean();
    expect(restored.every((v) => v.caregiverCode === FIXTURES.priya)).toBe(true);
    expect(await Visit.countDocuments({ sandboxId, authorizationCode: FIXTURES.ashaAuthorization })).toBe(0);
    expect((await Proposal.findById(id).lean())?.status).toBe("undone");
  });

  it("refuses to apply when a visit changed since the plan was made, and writes nothing", async () => {
    const { id, visits } = await approvedPlan();
    await sent(id);
    await Visit.updateOne({ sandboxId, code: visits[0].code }, { $inc: { version: 1 } });
    const res = await request(app).post(`/api/internal/plans/${id}/run`).set(SECRET);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain("changed since this plan was made");
    const untouched = await Visit.find({ sandboxId, code: { $in: visits.slice(1).map((v) => v.code) } }).lean();
    expect(untouched.every((v) => v.caregiverCode === FIXTURES.priya)).toBe(true);
    expect(await Visit.countDocuments({ sandboxId, authorizationCode: FIXTURES.ashaAuthorization })).toBe(0);
    await Visit.updateOne({ sandboxId, code: visits[0].code }, { $inc: { version: -1 } });
  });

  it("refuses to undo over newer work", async () => {
    const { id, visits } = await approvedPlan();
    await sent(id);
    await runPlan(id);
    await Visit.updateOne({ sandboxId, code: visits[1].code }, { $inc: { version: 1 }, caregiverCode: "CG-05" });
    await expect(undoPlan(id)).rejects.toThrow("undo would overwrite newer work");
    // Nothing was undone: the first visit still has its new caregiver.
    expect((await Visit.findOne({ sandboxId, code: visits[0].code }).lean())?.caregiverCode).toBe("CG-02");
    // Put the other edit back so the plan can be undone, and later tests start clean.
    await Visit.updateOne({ sandboxId, code: visits[1].code }, { $inc: { version: -1 }, caregiverCode: "CG-03" });
    await undoPlan(id);
  });

  describe("through AgentGuard", () => {
    it("sends the plan once, even on two clicks at the same moment", async () => {
      const { id } = await approvedPlan();
      env.AGENTGUARD_URL = "https://guard.test";
      env.SHIFTPILOT_AGENT_KEY = "agk_test";
      const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (url: any, init: any) => {
        expect(String(url)).toBe("https://guard.test/api/agent/actions");
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ action: "schedule.applyPlan", params: { proposalId: id }, onBehalfOf: "coordinator@sunrise.test", idempotencyKey: `shiftpilot-${id}-1` });
        await runPlan(id); // what AgentGuard does when its rules allow it
        return new Response(JSON.stringify({ success: true, data: { actionId: "act1", status: "done", message: "Done." } }), { status: 200 });
      });
      const [a, b] = await Promise.all([
        request(app).post(`/api/proposals/${id}/apply`).set(auth),
        request(app).post(`/api/proposals/${id}/apply`).set(auth),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const latest = await request(app).get(`/api/proposals/${id}`).set(auth);
      expect(latest.body.data).toMatchObject({ status: "applied", guardActionId: "act1", guardStatus: "done" });
      await undoPlan(id);
    });

    it("shows a manager approval as waiting, with a link to AgentGuard", async () => {
      const { id } = await approvedPlan();
      env.AGENTGUARD_URL = "https://guard.test";
      env.AGENTGUARD_PUBLIC_URL = "https://agentguard.example.com";
      env.SHIFTPILOT_AGENT_KEY = "agk_test";
      jest.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: { actionId: "act2", status: "pending_approval", message: "Waiting", reasons: ["Big schedule changes need a manager"] } }), { status: 202 })
      );
      const res = await request(app).post(`/api/proposals/${id}/apply`).set(auth);
      expect(res.body.data.guard).toMatchObject({ status: "pending_approval", guardUrl: "https://agentguard.example.com/activity?action=act2", guardMessage: "Big schedule changes need a manager" });
    });

    it("lets the coordinator retry when AgentGuard cannot be reached", async () => {
      const { id } = await approvedPlan();
      env.AGENTGUARD_URL = "https://guard.test";
      env.SHIFTPILOT_AGENT_KEY = "agk_test";
      jest.spyOn(global, "fetch").mockRejectedValue(new TypeError("fetch failed"));
      const res = await request(app).post(`/api/proposals/${id}/apply`).set(auth);
      expect(res.status).toBe(503);
      expect(res.body.message).toBe("Safety layer is waking up, try again in a minute.");
      expect((await Proposal.findById(id).lean())?.status).toBe("draft");
    });
  });

  it("applies directly when AgentGuard is not connected", async () => {
    const { id } = await approvedPlan();
    const res = await request(app).post(`/api/proposals/${id}/apply`).set(auth);
    expect(res.body.data.proposal).toMatchObject({ status: "applied", guardStatus: "local" });
    expect(res.body.data.guard.agentGuardConnected).toBe(false);
    await undoPlan(id);
  });
});

describe("apply and undo, edge cases from review", () => {
  let sandboxId: string;
  let auth: Record<string, string>;
  beforeAll(async () => {
    await startTestDb();
    ({ sandboxId, auth } = await newSession());
  });
  afterAll(stopTestDb);
  afterEach(() => {
    jest.restoreAllMocks();
    env.AGENTGUARD_URL = "";
    env.SHIFTPILOT_AGENT_KEY = "";
  });

  async function plan(changes: Parameters<typeof submitProposal>[3]) {
    const result = await submitProposal(sandboxId, null, "Plan", changes);
    if (!result.ok) throw new Error(JSON.stringify(result.failures));
    const id = String(result.proposal._id);
    await approveAll(sandboxId, id);
    return id;
  }

  it("never runs a draft the coordinator has not sent", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const id = await plan([{ kind: "assign", visitCode: visit.code, caregiverCode: "CG-02" }]);
    const res = await request(app).post(`/api/internal/plans/${id}/run`).set(SECRET);
    expect(res.status).toBe(409);
    expect((await Visit.findOne({ sandboxId, code: visit.code }).lean())?.caregiverCode).toBe(FIXTURES.priya);
  });

  it("refuses an undo that would double-book", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    // Plan A cancels the visit; plan B then books the same client at the same time.
    const a = await plan([{ kind: "cancel", visitCode: visit.code }]);
    await request(app).post(`/api/proposals/${a}/apply`).set(auth).expect(200);
    const b = await plan([
      { kind: "create", clientCode: visit.clientCode, authorizationCode: visit.authorizationCode, caregiverCode: "CG-03", start: visit.start.toISOString(), end: visit.end.toISOString() },
    ]);
    await request(app).post(`/api/proposals/${b}/apply`).set(auth).expect(200);

    const undo = await request(app).post(`/api/proposals/${a}/undo`).set(auth);
    expect(undo.status).toBe(409);
    expect(undo.body.message).toContain("Undo would break a scheduling rule");
    expect((await Visit.findOne({ sandboxId, code: visit.code }).lean())?.status).toBe("cancelled");

    // Undo B first, then A works again.
    await request(app).post(`/api/proposals/${b}/undo`).set(auth).expect(200);
    await request(app).post(`/api/proposals/${a}/undo`).set(auth).expect(200);
    expect((await Visit.findOne({ sandboxId, code: visit.code }).lean())?.status).toBe("scheduled");
  });

  it("lets only one of two clashing plans apply at the same moment", async () => {
    const [first, second] = await priyaVisitsTomorrow(sandboxId);
    // Both plans give CG-04 a visit at the first visit's time: each is fine alone, not together.
    const p1 = await plan([{ kind: "assign", visitCode: first.code, caregiverCode: "CG-04" }]);
    const p2 = await plan([{ kind: "move", visitCode: second.code, caregiverCode: "CG-04", start: first.start.toISOString(), end: first.end.toISOString() }]);
    const results = await Promise.all([
      request(app).post(`/api/proposals/${p1}/apply`).set(auth),
      request(app).post(`/api/proposals/${p2}/apply`).set(auth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const cg04 = await Visit.countDocuments({ sandboxId, caregiverCode: "CG-04", start: first.start });
    expect(cg04).toBe(1);
    const winner = results.find((r) => r.status === 200)!;
    await request(app).post(`/api/proposals/${winner.body.data.proposal._id}/undo`).set(auth).expect(200);
  });

  it("shows a plan as applied, with Undo here, when AgentGuard timed out after it ran", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const id = await plan([{ kind: "assign", visitCode: visit.code, caregiverCode: "CG-02" }]);
    env.AGENTGUARD_URL = "https://guard.test";
    env.SHIFTPILOT_AGENT_KEY = "agk_test";
    jest.spyOn(global, "fetch").mockImplementation(async () => {
      await runPlan(id); // AgentGuard called us and we applied it...
      return new Response(JSON.stringify({ success: true, data: { actionId: "act-slow", status: "failed", message: "ShiftPilot did not answer." } }), { status: 200 }); // ...but it gave up waiting
    });
    const res = await request(app).post(`/api/proposals/${id}/apply`).set(auth);
    expect(res.body.data.guard).toMatchObject({ status: "applied", canUndoHere: true });
    env.AGENTGUARD_URL = "";
    await request(app).post(`/api/proposals/${id}/undo`).set(auth).expect(200);
    expect((await Visit.findOne({ sandboxId, code: visit.code }).lean())?.caregiverCode).toBe(FIXTURES.priya);
  });

  it("keeps Undo in AgentGuard when AgentGuard applied it", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const id = await plan([{ kind: "assign", visitCode: visit.code, caregiverCode: "CG-02" }]);
    env.AGENTGUARD_URL = "https://guard.test";
    env.SHIFTPILOT_AGENT_KEY = "agk_test";
    jest.spyOn(global, "fetch").mockImplementation(async () => {
      await runPlan(id);
      return new Response(JSON.stringify({ success: true, data: { actionId: "act-ok", status: "done", message: "Done." } }), { status: 200 });
    });
    await request(app).post(`/api/proposals/${id}/apply`).set(auth).expect(200);
    const undo = await request(app).post(`/api/proposals/${id}/undo`).set(auth);
    expect(undo.status).toBe(409);
    expect(undo.body.message).toContain("AgentGuard");
    await undoPlan(id);
  });
});
