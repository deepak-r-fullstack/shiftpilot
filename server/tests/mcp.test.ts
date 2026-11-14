import request from "supertest";
import { createApp } from "../src/app";
import { Proposal } from "../src/models/proposal.model";
import { newSession, priyaVisitsTomorrow, TOMORROW } from "./helpers/fixtures";
import { startTestDb, stopTestDb } from "./helpers/testDb";

// MCP through the real HTTP API (JSON-RPC over POST /api/mcp), authenticated with a demo session token.
const app = createApp();

describe("MCP tools", () => {
  let sandboxId: string;
  let auth: Record<string, string>;
  beforeAll(async () => {
    await startTestDb();
    ({ sandboxId, auth } = await newSession());
  });
  afterAll(stopTestDb);

  const rpc = (method: string, params: unknown, headers: Record<string, string> = auth) =>
    request(app).post("/api/mcp").set("accept", "application/json, text/event-stream").set(headers).send({ jsonrpc: "2.0", id: 1, method, params });

  async function callTool(name: string, args: Record<string, unknown>) {
    const res = await rpc("tools/call", { name, arguments: args });
    expect(res.status).toBe(200);
    return { isError: Boolean(res.body.result.isError), json: JSON.parse(res.body.result.content[0].text) };
  }

  it("needs a session token", async () => {
    await rpc("tools/list", {}, {}).expect(401);
  });

  it("initializes and lists only read and propose tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.body.result.serverInfo.name).toBe("shiftpilot");
    const list = await rpc("tools/list", {});
    const names = list.body.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual(["build_schedule", "check_change", "find_candidates", "find_visits", "get_authorization", "submit_proposal"]);
    expect(list.body.result.tools.find((t: any) => t.name === "find_visits").annotations.readOnlyHint).toBe(true);
  });

  it("finds visits and saves a draft proposal, never applying it", async () => {
    const found = await callTool("find_visits", { caregiver: "Priya Nair", fromDate: TOMORROW, toDate: TOMORROW });
    expect(found.json.visits.length).toBeGreaterThanOrEqual(3);
    const visits = await priyaVisitsTomorrow(sandboxId);
    const saved = await callTool("submit_proposal", {
      summary: "Cover Priya via MCP",
      changes: visits.map((v, i) => ({ kind: "assign", visitCode: v.code, caregiverCode: ["CG-02", "CG-03", "CG-04"][i % 3], reason: "Float caregiver" })),
    });
    expect(saved.json.saved).toBe(true);
    expect((await Proposal.findById(saved.json.proposalId).lean())?.status).toBe("draft");
  });

  it("builds a schedule in one call and submits it in the next", async () => {
    const built = await callTool("build_schedule", { authorizationCode: "AU-01", days: ["mon", "wed", "fri"], windowStart: "09:00", windowEnd: "11:00" });
    expect(built.json.visits).toBeGreaterThan(50);
    const saved = await callTool("submit_proposal", { summary: "Asha's schedule", buildPlanId: built.json.buildPlanId });
    expect(saved.json.saved).toBe(true);
  }, 60000);

  it("reports problems as tool errors", async () => {
    const res = await callTool("find_candidates", { visitCode: "V-0000" });
    expect(res.isError).toBe(true);
    expect(res.json.error).toContain("not found");
  });

  it("refuses GET and DELETE", async () => {
    await request(app).get("/api/mcp").expect(405);
    await request(app).delete("/api/mcp").expect(405);
  });
});
