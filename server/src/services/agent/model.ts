import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "../../config/env";

// ---------------------------------------------------------------------------
// The AI model that plans schedule changes. One env setting switches provider.
// A small, cheap tool-calling model is enough: the code does the rule checks,
// the model only plans and explains.
// ---------------------------------------------------------------------------

const DEFAULT_MODELS = { anthropic: "claude-haiku-4-5", openai: "gpt-4.1-mini" } as const;

// US dollars per million tokens (input, output). Rough list prices, used only for the daily spend cap.
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};
const FALLBACK_PRICE = { input: 3, output: 15 }; // unknown model: assume an expensive one

export function modelName(): string {
  if (env.LLM_PROVIDER === "none") return "none";
  return env.LLM_MODEL || DEFAULT_MODELS[env.LLM_PROVIDER];
}

export function isAiConfigured(): boolean {
  return env.LLM_PROVIDER !== "none" && Boolean(env.LLM_API_KEY);
}

let modelOverride: LanguageModel | null | undefined;

/** Tests and evals can supply their own model (a scripted mock, or a specific real one). */
export function setModelOverride(model: LanguageModel | null | undefined) {
  modelOverride = model;
}

/** The configured model, or null when live AI is off. */
export function getModel(): LanguageModel | null {
  if (modelOverride !== undefined) return modelOverride;
  if (!isAiConfigured()) return null;
  if (env.LLM_PROVIDER === "anthropic") return createAnthropic({ apiKey: env.LLM_API_KEY })(modelName());
  return createOpenAI({ apiKey: env.LLM_API_KEY })(modelName());
}

export function estimateUsd(usage: { inputTokens?: number; outputTokens?: number }, model = modelName()): number {
  const price = PRICES[model] ?? FALLBACK_PRICE;
  return ((usage.inputTokens ?? 0) * price.input + (usage.outputTokens ?? 0) * price.output) / 1_000_000;
}
