// Shapes the ShiftPilot API returns. Dates arrive as ISO strings.

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface Coordinator {
  name: string;
  email: string;
  role: string;
}

export interface SandboxInfo {
  id: string;
  label: string;
  expiresAt: string;
}

export interface Caregiver {
  code: string;
  name: string;
  skills: string[];
  maxHoursPerWeek: number;
}

export interface Client {
  code: string;
  name: string;
  town?: string;
}

export type VisitStatus = "scheduled" | "cancelled" | "completed";

export interface Visit {
  code: string;
  clientCode: string;
  clientName: string;
  caregiverCode: string | null;
  caregiverName: string | null;
  authorizationCode: string;
  serviceCode: string;
  start: string;
  end: string;
  units: number;
  status: VisitStatus;
}

export interface Story {
  key: string;
  title: string;
  text: string;
}

export interface RequestOptions {
  stories: Story[];
  freeRequestsLeft: number;
  liveAi: boolean;
}

export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; name: string; summary: string }
  | { type: "question"; text: string; choices?: string[] }
  | { type: "proposal"; proposalId: string; summary: string; changes: number }
  | { type: "error"; message: string }
  | { type: "done" };

export interface RuleResult {
  rule: string;
  passed: boolean;
  message: string;
}

export interface VisitSnapshot {
  visitCode: string | null;
  clientCode: string;
  caregiverCode: string | null;
  authorizationCode: string;
  serviceCode: string;
  start: string;
  end: string;
  units: number;
  status: VisitStatus;
}

export type ChangeKind = "assign" | "move" | "cancel" | "create";
export type ChangeDecision = "pending" | "approved" | "edited" | "rejected" | "auto_approved";

export interface ProposedChange {
  _id: string;
  kind: ChangeKind;
  before: VisitSnapshot | null;
  after: VisitSnapshot | null;
  reasons: string[];
  ruleResults: RuleResult[];
  unitsLeftBefore: number | null;
  unitsLeftAfter: number | null;
  lowRisk: boolean;
  decision: ChangeDecision;
}

export type ProposalStatus = "draft" | "applying" | "applied" | "pending_approval" | "denied" | "undone" | "failed";

export interface Proposal {
  _id: string;
  summary: string;
  status: ProposalStatus;
  changes: ProposedChange[];
  guardActionId: string | null;
  guardStatus: string | null;
  guardMessage: string | null;
  createdAt: string;
}

export interface GuardInfo {
  status: ProposalStatus;
  guardStatus: string | null;
  guardMessage: string | null;
  guardUrl: string | null;
  agentGuardConnected: boolean;
  canUndoHere: boolean;
}

export interface Candidate {
  caregiverId: string;
  name: string;
  distanceKm: number;
  visitsWithClient: number;
  hoursLeftThisWeek: number;
  facts: string;
}
