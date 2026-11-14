// npm run check:browser: the whole demo journey in a real browser, desktop and phone.
// Starts the built app on a throwaway database with the scripted story model (no API key)
// and a tiny stand-in for AgentGuard that applies plans the way AgentGuard does.
// Screenshots go to checks/screenshots/. Set CHROME_PATH to use an installed Chrome.
import { spawn } from "child_process";
import fs from "fs";
import http from "http";
import path from "path";
import { createRequire } from "module";
import { chromium } from "playwright";

const require = createRequire(path.resolve("server/package.json"));
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const APP_PORT = 5071;
const GUARD_PORT = 5072;
const SECRET = "journey-check-secret-123";
const shots = path.resolve("checks/screenshots");
fs.mkdirSync(shots, { recursive: true });

// ---- a stand-in for AgentGuard: allow every plan, run it by calling ShiftPilot back ----
const actions = new Map();
const guard = http.createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/api/health") return send(200, { success: true });
  if (req.method === "POST" && req.url === "/api/agent/actions") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const { params } = JSON.parse(raw);
    const run = await fetch(`http://localhost:${APP_PORT}/api/internal/plans/${params.proposalId}/run`, { method: "POST", headers: { "x-shiftpilot-secret": SECRET } });
    const id = `act${actions.size + 1}`;
    actions.set(id, run.ok ? "done" : "failed");
    return send(200, { success: true, data: { actionId: id, status: actions.get(id), message: "Done." } });
  }
  const match = req.url.match(/^\/api\/agent\/actions\/(\w+)$/);
  if (req.method === "GET" && match) return send(200, { success: true, data: { actionId: match[1], status: actions.get(match[1]) ?? "done", message: "Done." } });
  return send(404, { success: false });
});
await new Promise((resolve) => guard.listen(GUARD_PORT, resolve));

const db = process.env.TEST_MONGO_URI ? null : await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
const mongoUri = process.env.TEST_MONGO_URI || db.getUri("shiftpilot_journey");

const app = spawn("node", ["server/dist/server.js"], {
  env: {
    ...process.env,
    NODE_ENV: "local",
    PORT: String(APP_PORT),
    MONGO_URI: mongoUri,
    SEED_ON_START: "true",
    FAKE_AI: "stories",
    AGENTGUARD_URL: `http://localhost:${GUARD_PORT}`,
    AGENTGUARD_PUBLIC_URL: "https://agentguard.example.com",
    SHIFTPILOT_AGENT_KEY: "agk_journey",
    SHIFTPILOT_INTERNAL_SECRET: SECRET,
  },
  stdio: ["ignore", "ignore", "inherit"],
});

async function waitForApp() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://localhost:${APP_PORT}/api/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The app did not start.");
}

let failed = false;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
try {
  await waitForApp();
  for (const [label, viewport] of [["desktop", { width: 1366, height: 860 }], ["phone", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    const shot = (name) => page.screenshot({ path: path.join(shots, `${label}-${name}.png`), fullPage: false });

    await page.goto(`http://localhost:${APP_PORT}/`);
    await shot("1-welcome");
    await page.getByRole("button", { name: "Start the demo" }).click();
    await page.waitForURL("**/schedule");
    await page.getByRole("cell", { name: /Priya Nair/ }).or(page.getByText("Priya Nair")).first().waitFor();
    await shot("2-schedule");

    // Story 2: Priya is sick -> review -> approve all -> apply through "AgentGuard" -> link to undo there.
    await page.getByRole("button", { name: /Priya is sick/ }).click();
    await page.waitForURL("**/proposals/**", { timeout: 30000 });
    await page.getByRole("heading", { name: "Review the plan" }).waitFor();
    await shot("3-review");
    await page.getByRole("button", { name: /Approve all/ }).click();
    await page.getByRole("button", { name: /Apply 3 approved changes/ }).click();
    await page.getByText("Applied", { exact: true }).waitFor();
    const href = await page.getByRole("link").filter({ hasText: "Undo in AgentGuard" }).getAttribute("href");
    if (!href?.startsWith("https://agentguard.example.com/activity?action=")) throw new Error(`Wrong AgentGuard link: ${href}`);
    await shot("4-applied");

    // Story 1: a whole schedule from an authorization, grouped by week.
    await page.getByRole("link", { name: /Back to the schedule/ }).click();
    await page.getByRole("button", { name: /Build Asha/ }).click();
    await page.waitForURL("**/proposals/**", { timeout: 60000 });
    await page.getByRole("button", { name: /Approve this week/ }).first().waitFor();
    await shot("5-build-review");

    if (errors.length) throw new Error(`Browser errors on ${label}: ${errors.join("; ")}`);
    console.log(`${label}: journey passed`);
    await page.close();
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
  app.kill();
  guard.close();
  if (db) await db.stop();
}
process.exit(failed ? 1 : 0);
