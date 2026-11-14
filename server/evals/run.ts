// npm run evals: runs the 30 scenarios against the configured AI model and writes a score table.
// Uses its own in-memory database and a pinned "today", so every run meets the same agency.
// Needs LLM_PROVIDER + LLM_API_KEY (or FAKE_AI=stories to try the harness without a key).
process.env.SHIFTPILOT_TODAY = process.env.SHIFTPILOT_TODAY || "2026-11-14";

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { runAgent } from "../src/services/agent/agentLoop";
import { AgentEvent } from "../src/services/agent/events";
import { getModel, modelName } from "../src/services/agent/model";
import { createSandbox } from "../src/services/demo/sandbox.service";
import { loadOutcome, runCheck } from "./checks";
import { SCENARIOS } from "./scenarios";

const PASS_MARK = 0.9;

async function main() {
  const model = getModel();
  if (!model) throw new Error("Set LLM_PROVIDER and LLM_API_KEY (or FAKE_AI=stories) first.");
  const only = process.argv[2];
  const scenarios = only ? SCENARIOS.filter((s) => s.id.startsWith(only)) : SCENARIOS;

  const db = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  await mongoose.connect(db.getUri(), { dbName: "shiftpilot_evals" });

  const rows: string[] = [];
  let passed = 0;
  let totalUsd = 0;
  for (const scenario of scenarios) {
    const sandbox = await createSandbox(process.env.SHIFTPILOT_TODAY);
    const events: AgentEvent[] = [];
    const result = await runAgent({ sandboxId: String(sandbox._id), requestId: null, text: scenario.text, model, emit: (e) => events.push(e) });
    const outcome = await loadOutcome(String(sandbox._id), process.env.SHIFTPILOT_TODAY!, events);
    const failures = (await Promise.all(scenario.expect.map((check) => runCheck(check, outcome)))).filter(Boolean) as string[];
    const ok = failures.length === 0;
    if (ok) passed += 1;
    totalUsd += result.usd;
    rows.push(`| ${scenario.id} | ${ok ? "pass" : "FAIL"} | ${result.steps} | $${result.usd.toFixed(4)} | ${ok ? "" : failures.join("; ").replace(/\|/g, "/")} |`);
    console.log(`${ok ? "pass" : "FAIL"} ${scenario.id}${ok ? "" : `: ${failures.join("; ")}`}`);
  }

  const score = passed / scenarios.length;
  const date = new Date().toISOString().slice(0, 10);
  const report = [
    `# ShiftPilot agent evals, ${date}`,
    "",
    `Model: ${process.env.FAKE_AI === "stories" ? "scripted story model (harness check)" : modelName()} · Agency day: ${process.env.SHIFTPILOT_TODAY}`,
    "",
    `**Score: ${passed} / ${scenarios.length} (${Math.round(score * 100)}%)** · AI cost: $${totalUsd.toFixed(3)}`,
    "",
    "| Scenario | Result | Steps | Cost | Why it failed |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
  const file = path.join(__dirname, "results", `${date}.md`);
  fs.writeFileSync(file, report);
  console.log(`\n${passed}/${scenarios.length} passed. Report: ${file}`);

  await mongoose.disconnect();
  await db.stop();
  process.exit(score >= PASS_MARK || only ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
