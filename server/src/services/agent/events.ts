// What the agent tells the screen while it works. Sent as Server-Sent Events,
// one JSON object per line, so the coordinator watches each step happen.
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "question"; text: string; choices?: string[] }
  | { type: "proposal"; proposalId: string; summary: string; changes: number }
  | { type: "error"; message: string }
  | { type: "done" };

export type Emit = (event: AgentEvent) => void;
