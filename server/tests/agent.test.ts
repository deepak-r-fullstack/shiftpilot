import request from "supertest";
import { createApp } from "../src/app";
import { CostLedger } from "../src/models/costLedger.model";
import { Proposal } from "../src/models/proposal.model";
import { Sandbox } from "../src/models/sandbox.model";
import { Visit } from "../src/models/visit.model";
import { setModelOverride } from "../src/services/agent/model";
import { saveRun } from "../src/services/demo/savedRuns";
import { todayInDenver } from "../src/utils/time";
import { newSession, priyaVisitsTomorrow, TOMORROW } from "./helpers/fixtures";
import { parseEvents, scriptedModel } from "./helpers/scriptedModel";
import { startTestDb, stopTestDb } from "./helpers/testDb";

const app = createApp();

describe("the scheduling agent", () => {
  let sandboxId: string;
  let auth: Record<string, string>;
  beforeAll(async () => {
    await startTestDb();
    ({ sandboxId, auth } = await newSession());
  });
  afterAll(async () => {
    setModelOverride(undefined);
    await stopTestDb();
  });
  beforeEach(() => Sandbox.updateOne({ _id: sandboxId }, { requestsUsed: 0 }));

  it("covers Priya's visits and streams each step", async () => {
    const visits = await priyaVisitsTomorrow(sandboxId);
    const before = await Visit.countDocuments({ sandboxId });
    setModelOverride(
      scriptedModel([
        { tools: [{ name: "find_visits", input: { caregiver: "Priya", fromDate: TOMORROW, toDate: TOMORROW } }] },
        { tools: visits.map((v) => ({ name: "find_candidates", input: { visitCode: v.code } })) },
        {
          tools: [
            {
              name: "submit_proposal",
              input: {
                summary: "Cover Priya's visits tomorrow",
                changes: visits.map((v, i) => ({ kind: "assign", visitCode: v.code, caregiverCode: ["CG-02", "CG-03", "CG-04"][i % 3], reason: "Float caregiver, free then" })),
              },
            },
          ],
        },
        { text: "Done." },
      ])
    );
    const res = await request(app).post("/api/requests").set(auth).send({ text: "Priya is sick tomorrow, cover her visits" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseEvents(res.text);
    expect(events.filter((e) => e.type === "tool").map((e) => e.name)).toEqual(expect.arrayContaining(["find_visits", "find_candidates", "submit_proposal"]));
    expect(events.find((e) => e.name === "find_visits").summary).toContain("Priya Nair");
    const proposalEvent = events.find((e) => e.type === "proposal");
    expect(proposalEvent).toBeTruthy();
    expect(events[events.length - 1]).toEqual({ type: "done" });

    const proposal = await Proposal.findById(proposalEvent.proposalId).lean();
    expect(proposal?.changes.map((c) => c.before?.visitCode).sort()).toEqual(visits.map((v) => v.code).sort());
    // The agent only proposes; no visit changed.
    expect(await Visit.countDocuments({ sandboxId })).toBe(before);
    expect(await Visit.countDocuments({ sandboxId, code: { $in: visits.map((v) => v.code) }, caregiverCode: "CG-01" })).toBe(visits.length);
  });

  it("asks which Maria instead of guessing", async () => {
    const before = await Proposal.countDocuments();
    setModelOverride(
      scriptedModel([
        { tools: [{ name: "find_visits", input: { caregiver: "Maria", fromDate: TOMORROW, toDate: TOMORROW } }] },
        { tools: [{ name: "ask_coordinator", input: { question: "Which Maria do you mean?", choices: ["Maria Lopez", "Maria Chen"] } }] },
      ])
    );
    const res = await request(app).post("/api/requests").set(auth).send({ text: "Maria is sick tomorrow" });
    const events = parseEvents(res.text);
    expect(events.find((e) => e.type === "question")).toMatchObject({ choices: ["Maria Lopez", "Maria Chen"] });
    expect(events.some((e) => e.type === "proposal")).toBe(false);
    expect(await Proposal.countDocuments()).toBe(before);
  });

  it("reports a failure and saves nothing when the AI breaks", async () => {
    const before = await Proposal.countDocuments();
    setModelOverride(scriptedModel([{ throws: "provider down" }]));
    const res = await request(app).post("/api/requests").set(auth).send({ text: "Priya is sick tomorrow" });
    const events = parseEvents(res.text);
    expect(events.find((e) => e.type === "error").message).toBe("I couldn't finish this. Here is what I found so far.");
    expect(await Proposal.countDocuments()).toBe(before);
  });

  it("returns refused changes to the AI so it can fix the plan", async () => {
    const [first, second] = await priyaVisitsTomorrow(sandboxId);
    const before = await Proposal.countDocuments();
    setModelOverride(
      scriptedModel([
        {
          tools: [
            {
              name: "submit_proposal",
              input: {
                summary: "Bad plan",
                changes: [
                  { kind: "assign", visitCode: first.code, caregiverCode: "CG-02", reason: "x" },
                  { kind: "assign", visitCode: second.code, caregiverCode: "CG-99", reason: "x" },
                ],
              },
            },
          ],
        },
        { text: "I could not find a valid plan." },
      ])
    );
    const res = await request(app).post("/api/requests").set(auth).send({ text: "Priya is sick tomorrow" });
    const events = parseEvents(res.text);
    expect(events.some((e) => e.type === "proposal")).toBe(false);
    expect(events.some((e) => e.type === "status" && e.text.includes("could not"))).toBe(true);
    expect(await Proposal.countDocuments()).toBe(before);
  });

  describe("demo limits", () => {
    it("allows 10 free requests a day, then refuses with a friendly message", async () => {
      await Sandbox.updateOne({ _id: sandboxId }, { requestsDay: todayInDenver(), requestsUsed: 10 });
      setModelOverride(scriptedModel([{ text: "ok" }]));
      const res = await request(app).post("/api/requests").set(auth).send({ text: "Priya is sick tomorrow" });
      expect(res.status).toBe(429);
      expect(res.body.message).toContain("10 free requests");
      const story = await request(app).post("/api/requests").set(auth).send({ storyKey: "priya-sick" });
      expect(story.status).toBe(200);
    });

    it("plays a recorded story when the daily budget is used up", async () => {
      await saveRun("priya-sick", [
        { type: "tool", name: "find_visits", summary: "Found 3 visits for Priya Nair" },
        { type: "proposal", proposalId: "x", summary: "Cover Priya", changes: 3 },
        { type: "done" },
      ]);
      await CostLedger.updateOne({ day: todayInDenver() }, { usdSpent: 99 }, { upsert: true });
      setModelOverride(scriptedModel([{ text: "should not run" }]));
      const res = await request(app).post("/api/requests").set(auth).send({ storyKey: "priya-sick" });
      const events = parseEvents(res.text);
      expect(events[0]).toEqual({ type: "status", text: "Recorded run, live AI resumes tomorrow" });
      expect(events.some((e) => e.type === "proposal")).toBe(false);
      expect(events.some((e) => e.type === "tool" && e.name === "find_visits")).toBe(true);

      const free = await request(app).post("/api/requests").set(auth).send({ text: "Priya is sick tomorrow" });
      expect(free.status).toBe(503);
      await CostLedger.deleteMany({});
    });

    it("plays recorded stories when live AI is off", async () => {
      setModelOverride(null);
      const res = await request(app).post("/api/requests").set(auth).send({ storyKey: "priya-sick" });
      expect(parseEvents(res.text)[0].text).toContain("Recorded run");
      const options = await request(app).get("/api/requests/options").set(auth);
      expect(options.body.data.liveAi).toBe(false);
      expect(options.body.data.stories).toHaveLength(4);
    });
  });
});
