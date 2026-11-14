import { env } from "../../config/env";
import { ServiceUnavailableError } from "../../helpers/errors";
import { logger, serializeError } from "../../utils/logger";

// ---------------------------------------------------------------------------
// AgentGuard is the safety layer: an approved plan is sent there as ONE action,
// "schedule.applyPlan". Its rules decide (big plans wait for a manager), it keeps
// the audit trail, runs the plan by calling us back, and offers Undo.
// Optional: without AGENTGUARD_URL, plans are applied directly.
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;

export interface GuardAction {
  actionId: string;
  status: string;
  message: string;
  reasons?: string[];
}

export function isAgentGuardConfigured(): boolean {
  return Boolean(env.AGENTGUARD_URL && env.SHIFTPILOT_AGENT_KEY);
}

function baseUrl() {
  return env.AGENTGUARD_URL.replace(/\/+$/, "");
}

/** Where a person opens this action in AgentGuard (to approve, or to undo). */
export function actionUrl(actionId: string): string {
  const base = (env.AGENTGUARD_PUBLIC_URL || env.AGENTGUARD_URL).replace(/\/+$/, "");
  return `${base}/activity?action=${encodeURIComponent(actionId)}`;
}

async function call(path: string, init: RequestInit): Promise<{ status: number; body: any }> {
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-agent-key": env.SHIFTPILOT_AGENT_KEY, ...(init.headers ?? {}) },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
  } catch (err) {
    logger.warn("agentguard unreachable", serializeError(err));
    throw new ServiceUnavailableError("Safety layer is waking up, try again in a minute.");
  }
}

export async function submitPlan(input: { proposalId: string; coordinatorEmail: string; summary: string; attempt: number }): Promise<GuardAction> {
  const { status, body } = await call("/api/agent/actions", {
    method: "POST",
    body: JSON.stringify({
      action: "schedule.applyPlan",
      params: { proposalId: input.proposalId },
      reason: input.summary.slice(0, 480),
      onBehalfOf: input.coordinatorEmail,
      idempotencyKey: `shiftpilot-${input.proposalId}-${input.attempt}`,
    }),
  });
  if (status >= 500 || !body?.data?.actionId) {
    logger.warn("agentguard refused the plan", { status });
    throw new ServiceUnavailableError(body?.message || "Safety layer is waking up, try again in a minute.");
  }
  return body.data as GuardAction;
}

/** Null when AgentGuard no longer has the action (for example after its demo was reset). */
export async function getActionStatus(actionId: string): Promise<GuardAction | null> {
  const { status, body } = await call(`/api/agent/actions/${encodeURIComponent(actionId)}`, { method: "GET" });
  if (status === 404) return null;
  if (!body?.data?.status) throw new ServiceUnavailableError("Could not read the status from AgentGuard.");
  return body.data as GuardAction;
}

/** The free host sleeps when idle; a visit to the welcome screen wakes it up. */
export async function wake(): Promise<void> {
  if (!env.AGENTGUARD_URL) return;
  try {
    await fetch(`${baseUrl()}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    // Waking is best effort.
  }
}
