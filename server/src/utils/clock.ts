import { todayInDenver } from "./time";

// "Today" for the agency. Tests and evals pin it with SHIFTPILOT_TODAY (YYYY-MM-DD)
// so the generated agency and the agent's dates are always the same.
export function agencyToday(): string {
  const pinned = process.env.SHIFTPILOT_TODAY;
  return pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : todayInDenver();
}
