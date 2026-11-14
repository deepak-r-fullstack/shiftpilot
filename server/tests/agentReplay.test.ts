import request from "supertest";

// The AgentReplay SDK is replaced by a spy, so we can see exactly what would be recorded.
const run = { step: jest.fn(), end: jest.fn() };
const sdk = { init: jest.fn(), startRun: jest.fn(() => run) };
jest.mock("@sritarak/agentreplay", () => sdk);

import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { setModelOverride } from "../src/services/agent/model";
import { newSession, priyaVisitsTomorrow, TOMORROW } from "./helpers/fixtures";
import { parseEvents, scriptedModel } from "./helpers/scriptedModel";
import { startTestDb, stopTestDb } from "./helpers/testDb";

const app = createApp();

describe("AgentReplay recording", () => {
  let auth: Record<string, string>;
  let sandboxId: string;
  beforeAll(async () => {
    await startTestDb();
    ({ sandboxId, auth } = await newSession());
  });
  afterAll(async () => {
    setModelOverride(undefined);
    await stopTestDb();
  });
  beforeEach(() => jest.clearAllMocks());

  const script = () =>
    scriptedModel([{ tools: [{ name: "find_visits", input: { caregiver: "Priya", fromDate: TOMORROW, toDate: TOMORROW } }] }, { text: "Here are her visits." }]);

  it("records nothing, and never loads the SDK, without a key", async () => {
    env.AGENTREPLAY_API_KEY = "";
    setModelOverride(script());
    await request(app).post("/api/requests").set(auth).send({ text: "Show Priya's visits tomorrow" }).expect(200);
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.startRun).not.toHaveBeenCalled();
  });

  it("records one run with AI and tool steps when a key is set", async () => {
    env.AGENTREPLAY_API_KEY = "ar_test";
    setModelOverride(script());
    await request(app).post("/api/requests").set(auth).send({ text: "Show Priya's visits tomorrow" }).expect(200);
    expect(sdk.startRun).toHaveBeenCalledWith(expect.objectContaining({ name: "Show Priya's visits tomorrow" }));
    const types = run.step.mock.calls.map(([step]) => step.type);
    expect(types).toContain("llm");
    expect(run.step.mock.calls.some(([step]) => step.type === "tool" && step.name === "find_visits")).toBe(true);
    expect(run.end).toHaveBeenCalledTimes(1);
  });

  it("links an applied plan to its AgentGuard action", async () => {
    env.AGENTREPLAY_API_KEY = "ar_test";
    env.AGENTGUARD_URL = "https://guard.test";
    env.AGENTGUARD_PUBLIC_URL = "https://agentguard.example.com";
    env.SHIFTPILOT_AGENT_KEY = "agk_test";
    const visits = await priyaVisitsTomorrow(sandboxId);
    const { submitProposal, approveAll } = await import("../src/services/proposals/proposal.service");
    const result = await submitProposal(sandboxId, null, "Cover Priya", [{ kind: "assign", visitCode: visits[0].code, caregiverCode: "CG-02" }]);
    if (!result.ok) throw new Error("expected ok");
    await approveAll(sandboxId, String(result.proposal._id));
    jest.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true, data: { actionId: "act9", status: "pending_approval", message: "Waiting" } }), { status: 202 }));
    await request(app).post(`/api/proposals/${result.proposal._id}/apply`).set(auth).expect(200);
    expect(run.step).toHaveBeenCalledWith(expect.objectContaining({ externalRef: { system: "agentguard", id: "act9", url: "https://agentguard.example.com/activity?action=act9" } }));
    env.AGENTGUARD_URL = "";
    env.SHIFTPILOT_AGENT_KEY = "";
  });

  it("never breaks a request when recording fails", async () => {
    env.AGENTREPLAY_API_KEY = "ar_test";
    run.step.mockImplementation(() => {
      throw new Error("AgentReplay is down");
    });
    setModelOverride(script());
    const res = await request(app).post("/api/requests").set(auth).send({ text: "Show Priya's visits tomorrow" }).expect(200);
    expect(parseEvents(res.text).some((e) => e.type === "tool" && e.name === "find_visits")).toBe(true);
    env.AGENTREPLAY_API_KEY = "";
  });
});
