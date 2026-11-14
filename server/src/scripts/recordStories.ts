// npm run record-stories: runs each story button once with live AI on a fresh
// sandbox and saves the steps, so the demo can play them back when live AI is
// off or today's budget is used up. Needs LLM_PROVIDER and LLM_API_KEY.
import { connectToDatabase, disconnectFromDatabase } from "../loaders/database";
import { runAgent } from "../services/agent/agentLoop";
import { AgentEvent } from "../services/agent/events";
import { getModel } from "../services/agent/model";
import { createSandbox } from "../services/demo/sandbox.service";
import { saveRun } from "../services/demo/savedRuns";
import { STORIES } from "../services/demo/stories";

async function main() {
  const model = getModel();
  if (!model) throw new Error("Set LLM_PROVIDER and LLM_API_KEY first.");
  await connectToDatabase();
  for (const story of STORIES) {
    const sandbox = await createSandbox();
    const events: AgentEvent[] = [];
    const result = await runAgent({ sandboxId: String(sandbox._id), requestId: null, text: story.text, model, emit: (e) => events.push(e) });
    events.push({ type: "done" });
    await saveRun(story.key, events);
    console.log(`${story.key}: ${result.proposalId ? "proposal saved" : "no proposal"}, ${result.steps} steps, $${result.usd.toFixed(4)}`);
  }
  await disconnectFromDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
