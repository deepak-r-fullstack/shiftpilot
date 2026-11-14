import { env } from "../../config/env";
import { logger, serializeError } from "../../utils/logger";

// ---------------------------------------------------------------------------
// Optional recording of every agent run in AgentReplay (Deepak's own npm package).
// Off without AGENTREPLAY_API_KEY: then the package is never even loaded.
// Recording can never break a request: every call is wrapped and silent.
// ---------------------------------------------------------------------------

export interface RecordingHandle {
  llm(step: { name: string; input?: unknown; output?: unknown; model?: string; tokens?: number }): void;
  tool(name: string, input: unknown, output: unknown): void;
  link(name: string, actionId: string, url: string): void;
  end(): void;
}

type Sdk = typeof import("@sritarak/agentreplay");
let sdk: Sdk | null = null;

function loadSdk(): Sdk | null {
  if (!env.AGENTREPLAY_API_KEY) return null;
  if (!sdk) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sdk = require("@sritarak/agentreplay") as Sdk;
    sdk.init({ apiKey: env.AGENTREPLAY_API_KEY, ...(env.AGENTREPLAY_URL ? { baseUrl: env.AGENTREPLAY_URL } : {}) });
  }
  return sdk;
}

function quietly(work: () => void) {
  try {
    work();
  } catch (err) {
    logger.warn("agentreplay recording failed", serializeError(err));
  }
}

export function startRecording(name: string, userRef: string): RecordingHandle | null {
  let run: ReturnType<Sdk["startRun"]> | null = null;
  try {
    const loaded = loadSdk();
    if (!loaded) return null;
    run = loaded.startRun({ name: name.slice(0, 120), userRef });
  } catch (err) {
    logger.warn("agentreplay start failed", serializeError(err));
    return null;
  }
  const current = run;
  return {
    llm: (step) => quietly(() => current.step({ type: "llm", ...step } as any)),
    tool: (name, input, output) => quietly(() => current.step({ type: "tool", name, input, output } as any)),
    link: (name, actionId, url) => quietly(() => current.step({ type: "tool", name, output: { actionId }, externalRef: { system: "agentguard", id: actionId, url } } as any)),
    end: () => quietly(() => current.end()),
  };
}
