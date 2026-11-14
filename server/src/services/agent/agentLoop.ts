import { generateText, LanguageModel, stepCountIs } from "ai";
import { agencyToday } from "../../utils/clock";
import { logger, serializeError } from "../../utils/logger";
import { RecordingHandle } from "../integrations/agentReplay";
import { Emit } from "./events";
import { estimateUsd, modelName } from "./model";
import { systemPrompt } from "./prompts";
import { AgentToolContext, createTools } from "./tools";

// ---------------------------------------------------------------------------
// The agent loop: the model picks a tool, our code runs it, the result goes back
// to the model, and so on until it saves one proposal, asks a question, or stops.
// At most 15 steps and 60 seconds. If it fails before saving a proposal, nothing is saved.
// ---------------------------------------------------------------------------

export const MAX_STEPS = 15;
export const TIMEOUT_MS = 60_000;
export const FAILURE_MESSAGE = "I couldn't finish this. Here is what I found so far.";

export interface RunAgentInput {
  sandboxId: string;
  requestId: string | null;
  text: string;
  model: LanguageModel;
  emit: Emit;
  recorder?: RecordingHandle | null;
}

export interface RunAgentResult {
  proposalId: string | null;
  asked: boolean;
  failed: boolean;
  usd: number;
  steps: number;
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const { emit, recorder } = input;
  const state: AgentToolContext["state"] = { proposalId: null, proposalSummary: "", changeCount: 0, asked: false, plans: new Map() };
  const tools = createTools({ sandboxId: input.sandboxId, requestId: input.requestId, emit, state });
  const stopWhenDone = () => Boolean(state.proposalId) || state.asked;

  let usd = 0;
  let steps = 0;
  try {
    const result = await generateText({
      model: input.model,
      system: systemPrompt(agencyToday()),
      prompt: input.text,
      tools,
      stopWhen: [stepCountIs(MAX_STEPS), stopWhenDone],
      timeout: TIMEOUT_MS,
      maxRetries: 1,
      onStepFinish: (step: any) => {
        steps += 1;
        const text = String(step.text ?? "").trim();
        if (text) emit({ type: "status", text: text.slice(0, 500) });
        recorder?.llm({ name: `step ${steps}`, output: text || undefined, model: modelName(), tokens: (step.usage?.inputTokens ?? 0) + (step.usage?.outputTokens ?? 0) });
        for (const call of step.toolResults ?? []) recorder?.tool(call.toolName, call.input, call.output);
      },
    } as any);
    usd = estimateUsd(result.totalUsage ?? {});
    if (state.proposalId) {
      emit({ type: "proposal", proposalId: state.proposalId, summary: state.proposalSummary, changes: state.changeCount });
    } else if (!state.asked && !String(result.text ?? "").trim()) {
      emit({ type: "error", message: FAILURE_MESSAGE });
      return { proposalId: null, asked: false, failed: true, usd, steps };
    }
    return { proposalId: state.proposalId, asked: state.asked, failed: false, usd, steps };
  } catch (err) {
    logger.warn("agent run failed", serializeError(err));
    emit({ type: "error", message: FAILURE_MESSAGE });
    // A proposal saved just before a later failure is still a complete, checked plan.
    if (state.proposalId) emit({ type: "proposal", proposalId: state.proposalId, summary: state.proposalSummary, changes: state.changeCount });
    return { proposalId: state.proposalId, asked: state.asked, failed: !state.proposalId, usd, steps };
  } finally {
    recorder?.end();
  }
}
