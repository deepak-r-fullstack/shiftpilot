import request from "supertest";
import { createApp } from "../src/app";

describe("health", () => {
  it("answers ok", async () => {
    const res = await request(createApp()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "ShiftPilot is running.", data: { status: "ok" } });
  });

  it("returns JSON 404 for unknown api routes", async () => {
    const res = await request(createApp()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
