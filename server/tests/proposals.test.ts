import request from "supertest";
import { createApp } from "../src/app";
import { Proposal } from "../src/models/proposal.model";
import { submitProposal } from "../src/services/proposals/proposal.service";
import { newSession, priyaVisitsTomorrow } from "./helpers/fixtures";
import { startTestDb, stopTestDb } from "./helpers/testDb";

const app = createApp();

describe("session and proposals API", () => {
  let sandboxId: string;
  let auth: Record<string, string>;
  beforeAll(async () => {
    await startTestDb();
    ({ sandboxId, auth } = await newSession());
  });
  afterAll(stopTestDb);

  it("needs a session", async () => {
    const res = await request(app).get("/api/caregivers");
    expect(res.status).toBe(401);
  });

  it("starts a new demo session with its own sandbox", async () => {
    const res = await request(app).post("/api/session");
    expect(res.status).toBe(201);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.coordinator.name).toBe("Dana Lopez");
    const me = await request(app).get("/api/session").set("Authorization", `Bearer ${res.body.data.token}`);
    expect(me.body.data.sandbox.label).toMatch(/^Visitor /);
  });

  it("reads the schedule with names", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const res = await request(app)
      .get("/api/schedule")
      .query({ from: visit.start.toISOString(), to: visit.end.toISOString(), caregiverCode: "CG-01" })
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ code: visit.code, caregiverName: "Priya Nair" });
  });

  it("saves nothing when a change breaks a rule", async () => {
    const [first, second] = await priyaVisitsTomorrow(sandboxId);
    const before = await Proposal.countDocuments();
    const result = await submitProposal(sandboxId, null, "Clashing plan", [
      { kind: "assign", visitCode: first.code, caregiverCode: "CG-02" },
      { kind: "move", visitCode: second.code, caregiverCode: "CG-02", start: first.start.toISOString(), end: first.end.toISOString() },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((f) => f.index)).toContain(1);
    expect(await Proposal.countDocuments()).toBe(before);
  });

  it("reviews a valid plan: edit, reject, approve all", async () => {
    const visits = await priyaVisitsTomorrow(sandboxId);
    const result = await submitProposal(
      sandboxId,
      null,
      "Cover Priya tomorrow",
      visits.map((v, i) => ({ kind: "assign" as const, visitCode: v.code, caregiverCode: ["CG-02", "CG-03", "CG-04"][i % 3], reasons: ["Float caregiver, free"] }))
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const id = String(result.proposal._id);
    const [c1, c2, c3] = result.proposal.changes.map((c) => String(c._id));

    const clash = await request(app)
      .put(`/api/proposals/${id}/changes/${c2}`)
      .set(auth)
      .send({ caregiverCode: "CG-02", start: visits[0].start.toISOString(), end: visits[0].end.toISOString() });
    expect(clash.status).toBe(422);
    expect(clash.body.details.ruleResults.some((r: any) => r.rule === "no_clash" && !r.passed)).toBe(true);
    const unchanged = await request(app).get(`/api/proposals/${id}`).set(auth);
    expect(unchanged.body.data.changes[1].decision).toBe("pending");

    const candidates = await request(app).get(`/api/proposals/${id}/changes/${c1}/candidates`).set(auth);
    expect(candidates.status).toBe(200);
    expect(candidates.body.data.length).toBeGreaterThan(0);
    expect(candidates.body.data.map((c: any) => c.caregiverId)).not.toContain("CG-01");

    const pick = candidates.body.data.find((c: any) => c.caregiverId !== "CG-02").caregiverId;
    const edited = await request(app).put(`/api/proposals/${id}/changes/${c1}`).set(auth).send({ caregiverCode: pick });
    expect(edited.status).toBe(200);
    expect(edited.body.data.changes[0]).toMatchObject({ decision: "edited", after: { caregiverCode: pick } });

    await request(app).post(`/api/proposals/${id}/changes/${c3}/decision`).set(auth).send({ decision: "reject" }).expect(200);
    const all = await request(app).post(`/api/proposals/${id}/approve-all`).set(auth);
    expect(all.body.data.changes.map((c: any) => c.decision)).toEqual(["edited", "approved", "rejected"]);
  });

  it("keeps sandboxes apart", async () => {
    const other = await newSession();
    const visits = await priyaVisitsTomorrow(sandboxId);
    const result = await submitProposal(sandboxId, null, "Mine", [{ kind: "assign", visitCode: visits[0].code, caregiverCode: "CG-02" }]);
    if (!result.ok) throw new Error("expected ok");
    const res = await request(app).get(`/api/proposals/${result.proposal._id}`).set(other.auth);
    expect(res.status).toBe(404);
  });
});
