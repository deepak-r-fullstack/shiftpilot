import { API_BASE, apiClient } from "./apiClient";
import { useSessionStore } from "utils/store/sessionStore";
import {
  AgentEvent,
  ApiEnvelope,
  Candidate,
  Caregiver,
  Client,
  Coordinator,
  GuardInfo,
  Proposal,
  RequestOptions,
  SandboxInfo,
  Visit,
} from "utils/types";

// Thin wrappers around each endpoint. They return the envelope; screens use `.data`.

async function unwrap<T>(request: Promise<{ data: ApiEnvelope<T> }>) {
  const response = await request;
  return response.data;
}

export const sessionService = {
  start: () => unwrap<{ token: string; coordinator: Coordinator; sandbox: SandboxInfo }>(apiClient.post("/session")),
  reset: () => unwrap<{ reset: boolean }>(apiClient.post("/session/reset")),
  wakeSafetyLayer: () => unwrap<{ ok: boolean }>(apiClient.post("/integrations/wake")),
};

export const agencyService = {
  schedule: (from: string, to: string) => unwrap<Visit[]>(apiClient.get("/schedule", { params: { from, to } })),
  caregivers: () => unwrap<Caregiver[]>(apiClient.get("/caregivers")),
  clients: () => unwrap<Client[]>(apiClient.get("/clients")),
};

export const proposalService = {
  get: (id: string) => unwrap<Proposal>(apiClient.get(`/proposals/${id}`)),
  decide: (id: string, changeId: string, decision: "approve" | "reject") =>
    unwrap<Proposal>(apiClient.post(`/proposals/${id}/changes/${changeId}/decision`, { decision })),
  approveAll: (id: string, changeIds?: string[]) => unwrap<Proposal>(apiClient.post(`/proposals/${id}/approve-all`, changeIds ? { changeIds } : {})),
  edit: (id: string, changeId: string, input: { caregiverCode?: string | null; start?: string; end?: string }) =>
    unwrap<Proposal>(apiClient.put(`/proposals/${id}/changes/${changeId}`, input)),
  candidates: (id: string, changeId: string) => unwrap<Candidate[]>(apiClient.get(`/proposals/${id}/changes/${changeId}/candidates`)),
  apply: (id: string) => unwrap<{ proposal: Proposal; guard: GuardInfo }>(apiClient.post(`/proposals/${id}/apply`)),
  guardStatus: (id: string) => unwrap<{ proposal: Proposal; guard: GuardInfo }>(apiClient.get(`/proposals/${id}/guard-status`)),
};

export const requestService = {
  options: () => unwrap<RequestOptions>(apiClient.get("/requests/options")),
};

/**
 * Sends a request to the agent and calls onEvent for every step as it arrives.
 * The server streams Server-Sent Events; fetch reads them as they come.
 */
export async function streamRequest(body: { text?: string; storyKey?: string }, onEvent: (event: AgentEvent) => void): Promise<void> {
  const token = useSessionStore.getState().token;
  const response = await fetch(`${API_BASE}/requests`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (response.status === 401) {
    useSessionStore.getState().endSession();
    throw new Error("Your demo session has ended. Start a new one.");
  }
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || "The assistant could not start. Please try again.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (chunk.startsWith("data: ")) {
        try {
          onEvent(JSON.parse(chunk.slice(6)) as AgentEvent);
        } catch {
          // A broken line is skipped; the next ones still arrive.
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}
