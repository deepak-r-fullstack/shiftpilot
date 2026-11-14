import { VisitFacts } from "./types";

// A change is "low risk" only when it barely touches the visit: same caregiver,
// same units, start moved by 15 minutes or less. Decided by code, never by the AI.
export const LOW_RISK_SHIFT_MINUTES = 15;

type VisitShape = Pick<VisitFacts, "caregiverId" | "units" | "start" | "status">;

export function isLowRisk(before: VisitShape | null, after: VisitShape | null): boolean {
  if (!before || !after) return false;
  if (before.status !== "scheduled" || after.status !== "scheduled") return false;
  if (before.caregiverId === null || before.caregiverId !== after.caregiverId) return false;
  if (before.units !== after.units) return false;
  const shift = Math.abs(after.start.getTime() - before.start.getTime()) / 60000;
  return shift > 0 && shift <= LOW_RISK_SHIFT_MINUTES;
}
