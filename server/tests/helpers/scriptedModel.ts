import { MockLanguageModelV3 } from "ai/test";

// A fake AI for tests: each call returns the next scripted step (tool calls or text).
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } };

export type ScriptedStep = { tools: { name: string; input: unknown }[] } | { text: string } | { throws: string };

export function scriptedModel(steps: ScriptedStep[]) {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async () => {
      const step = steps[Math.min(call, steps.length - 1)];
      call += 1;
      if ("throws" in step) throw new Error(step.throws);
      if ("text" in step) return { content: [{ type: "text", text: step.text }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] } as any;
      return {
        content: step.tools.map((t, i) => ({ type: "tool-call", toolCallId: `call-${call}-${i}`, toolName: t.name, input: JSON.stringify(t.input) })),
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage,
        warnings: [],
      } as any;
    },
  });
}

/** Reads a Server-Sent Events body into the list of events. */
export function parseEvents(body: string): any[] {
  return body
    .split("\n\n")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}
