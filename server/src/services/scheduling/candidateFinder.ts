import { haversineKm } from "../../utils/geo";
import { denverTime, wallMinutes, weekKey } from "../../utils/time";
import { allPassed, checkVisit, RuleContext } from "./ruleChecker";
import { CaregiverFacts, VisitFacts } from "./types";

// ---------------------------------------------------------------------------
// Who could take this visit? Only caregivers who pass EVERY rule are returned,
// ranked so the coordinator's usual choice comes first: someone the client
// already knows, then someone close by, then someone with hours to spare.
// The AI chooses from this list; it can never add a name that is not on it.
// ---------------------------------------------------------------------------

export interface Candidate {
  caregiverId: string;
  name: string;
  distanceKm: number;
  visitsWithClient: number;
  hoursLeftThisWeek: number;
  score: number;
  facts: string;
}

export interface FindCandidatesInput {
  visit: VisitFacts;
  caregivers: CaregiverFacts[];
  contextFor: (caregiver: CaregiverFacts) => RuleContext;
  visitsWithClient: (caregiverId: string) => number;
  limit?: number;
}

// Weights: knowing the client beats ~20 km of distance; distance beats a few spare hours.
const KNOWS_CLIENT = 20;
const PER_KM = -1;
const PER_SPARE_HOUR = 0.1;

export function findCandidates(input: FindCandidatesInput): Candidate[] {
  const candidates: Candidate[] = [];
  for (const caregiver of input.caregivers) {
    const visit = { ...input.visit, caregiverId: caregiver.id };
    const ctx = input.contextFor(caregiver);
    if (!allPassed(checkVisit({ ...ctx, visit, caregiver }))) continue;

    const distanceKm = haversineKm(caregiver.homeLocation, ctx.clientLocation);
    const week = weekKey(visit.start);
    const bookedMinutes = ctx.otherVisits
      .filter((other) => other.status !== "cancelled" && other.caregiverId === caregiver.id && weekKey(other.start) === week)
      .reduce((sum, other) => sum + wallMinutes(other.start, other.end), 0);
    const hoursLeftThisWeek = Math.max(0, caregiver.maxHoursPerWeek - (bookedMinutes + wallMinutes(visit.start, visit.end)) / 60);
    const visitsWithClient = input.visitsWithClient(caregiver.id);
    const score = (visitsWithClient > 0 ? KNOWS_CLIENT : 0) + distanceKm * PER_KM + hoursLeftThisWeek * PER_SPARE_HOUR;

    const knows = visitsWithClient > 0 ? `${visitsWithClient} past visit${visitsWithClient === 1 ? "" : "s"} with this client` : "new to this client";
    candidates.push({
      caregiverId: caregiver.id,
      name: caregiver.name,
      distanceKm,
      visitsWithClient,
      hoursLeftThisWeek: Math.round(hoursLeftThisWeek * 10) / 10,
      score: Math.round(score * 100) / 100,
      facts: `free ${denverTime(visit.start)}–${denverTime(visit.end)}, has the skill, ${distanceKm} km away, ${knows}`,
    });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, input.limit ?? 5);
}
