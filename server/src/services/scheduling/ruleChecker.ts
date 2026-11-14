import { describeTime, denverDate, isInsideWindow, overlaps, wallMinutes, weekKey } from "../../utils/time";
import { AuthorizationFacts, CaregiverFacts, LatLng, RuleId, RuleResult, ServiceFacts, VisitFacts } from "./types";

// ---------------------------------------------------------------------------
// The rule checker has the FINAL SAY on every schedule change.
// Pure functions, no database: the agent's tools, saving a proposal and applying
// a plan all call this same code, so the AI can never "forget" a rule.
// ---------------------------------------------------------------------------

export const TRAVEL_BUFFER_MINUTES = 15;

export interface RuleContext {
  visit: VisitFacts; // the visit as it would be after the change
  service: ServiceFacts;
  authorization: AuthorizationFacts | null; // null = no active authorization for this client and service
  caregiver: CaregiverFacts | null; // null = uncovered (caregiver rules are skipped)
  clientLocation: LatLng;
  // Every non-cancelled visit that may matter (same caregiver that week, same client that day, same
  // authorization), WITHOUT the visit itself. Includes the proposal's other changes.
  otherVisits: (VisitFacts & { clientLocation: LatLng })[];
}

const pass = (rule: RuleId, message: string): RuleResult => ({ rule, passed: true, message });
const fail = (rule: RuleId, message: string): RuleResult => ({ rule, passed: false, message });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function active<T extends { status: string }>(visits: T[]): T[] {
  return visits.filter((visit) => visit.status !== "cancelled");
}

function checkWholeUnits(ctx: RuleContext): RuleResult {
  const minutes = wallMinutes(ctx.visit.start, ctx.visit.end);
  const unit = ctx.service.unitMinutes;
  if (minutes <= 0) return fail("whole_units", "The visit must end after it starts.");
  if (minutes % unit !== 0) return fail("whole_units", `A visit must be whole ${unit}-minute units; ${minutes} minutes is not.`);
  if (ctx.visit.units !== minutes / unit) {
    return fail("whole_units", `${minutes} minutes is ${minutes / unit} units, not ${ctx.visit.units}.`);
  }
  return pass("whole_units", `${plural(ctx.visit.units, "unit")} (${minutes} minutes).`);
}

function checkAuthorizedService(ctx: RuleContext): RuleResult {
  const auth = ctx.authorization;
  if (!auth) return fail("authorized_service", `No active authorization for service ${ctx.visit.serviceCode}.`);
  if (auth.serviceCode !== ctx.visit.serviceCode || auth.id !== ctx.visit.authorizationId || auth.clientId !== ctx.visit.clientId) {
    return fail("authorized_service", `Service ${ctx.visit.serviceCode} is not on this client's authorization.`);
  }
  return pass("authorized_service", `${ctx.service.name} is authorized.`);
}

function checkInsideDates(ctx: RuleContext): RuleResult {
  const auth = ctx.authorization;
  if (!auth) return fail("inside_dates", "No authorization dates to check against.");
  const first = denverDate(ctx.visit.start);
  const last = denverDate(new Date(ctx.visit.end.getTime() - 1));
  if (first < auth.startDate || last > auth.endDate) {
    return fail("inside_dates", `The authorization only covers ${auth.startDate} to ${auth.endDate}.`);
  }
  return pass("inside_dates", `Inside the authorization dates (${auth.startDate} to ${auth.endDate}).`);
}

function sameAuthorization(ctx: RuleContext) {
  return active(ctx.otherVisits).filter((visit) => visit.authorizationId === ctx.visit.authorizationId);
}

function checkUnitsLeft(ctx: RuleContext): RuleResult {
  const auth = ctx.authorization;
  if (!auth) return fail("units_left", "No authorization units to check against.");
  const used = sameAuthorization(ctx).reduce((sum, visit) => sum + visit.units, 0);
  const left = auth.totalUnits - used;
  if (ctx.visit.units > left) {
    return fail("units_left", `Only ${plural(left, "unit")} left on this authorization; this visit needs ${ctx.visit.units}.`);
  }
  return pass("units_left", `${plural(left, "unit")} left before this visit, ${left - ctx.visit.units} after.`);
}

function checkPerVisitLimit(ctx: RuleContext): RuleResult {
  const max = ctx.authorization?.maxUnitsPerVisit;
  if (!max) return pass("per_visit_limit", "No per-visit limit.");
  if (ctx.visit.units > max) return fail("per_visit_limit", `At most ${plural(max, "unit")} per visit; this visit has ${ctx.visit.units}.`);
  return pass("per_visit_limit", `Within the ${max}-unit per-visit limit.`);
}

function checkPerWeekLimit(ctx: RuleContext): RuleResult {
  const max = ctx.authorization?.maxUnitsPerWeek;
  if (!max) return pass("per_week_limit", "No weekly limit.");
  const week = weekKey(ctx.visit.start);
  const used = sameAuthorization(ctx)
    .filter((visit) => weekKey(visit.start) === week)
    .reduce((sum, visit) => sum + visit.units, 0);
  if (used + ctx.visit.units > max) {
    return fail("per_week_limit", `At most ${max} units a week; this week already has ${used}, and this visit needs ${ctx.visit.units}.`);
  }
  return pass("per_week_limit", `${used + ctx.visit.units} of ${max} weekly units.`);
}

function checkCaregiverAvailable(ctx: RuleContext, caregiver: CaregiverFacts): RuleResult {
  const offWork = caregiver.timeOff.find((off) => overlaps(off.start, off.end, ctx.visit.start, ctx.visit.end));
  if (offWork) return fail("caregiver_available", `${caregiver.name} is off at that time.`);
  const fits = caregiver.weeklyAvailability.some((window) => isInsideWindow(ctx.visit.start, ctx.visit.end, window));
  if (!fits) return fail("caregiver_available", `${caregiver.name} does not work at ${describeTime(ctx.visit.start)}.`);
  return pass("caregiver_available", `${caregiver.name} is working then.`);
}

function checkCaregiverQualified(ctx: RuleContext, caregiver: CaregiverFacts): RuleResult {
  if (!caregiver.skills.includes(ctx.service.requiredSkill)) {
    return fail("caregiver_qualified", `${caregiver.name} does not have the ${ctx.service.requiredSkill} skill.`);
  }
  return pass("caregiver_qualified", `${caregiver.name} has the ${ctx.service.requiredSkill} skill.`);
}

function checkNoClash(ctx: RuleContext, caregiver: CaregiverFacts | null): RuleResult {
  const others = active(ctx.otherVisits);
  const clientClash = others.find(
    (visit) => visit.clientId === ctx.visit.clientId && overlaps(visit.start, visit.end, ctx.visit.start, ctx.visit.end)
  );
  if (clientClash) return fail("no_clash", `The client already has a visit at ${describeTime(clientClash.start)}.`);
  if (caregiver) {
    const caregiverClash = others.find(
      (visit) => visit.caregiverId === caregiver.id && overlaps(visit.start, visit.end, ctx.visit.start, ctx.visit.end)
    );
    if (caregiverClash) return fail("no_clash", `${caregiver.name} already has a visit at ${describeTime(caregiverClash.start)}.`);
  }
  return pass("no_clash", "No double-booking.");
}

function checkHoursLimit(ctx: RuleContext, caregiver: CaregiverFacts): RuleResult {
  const week = weekKey(ctx.visit.start);
  const usedMinutes = active(ctx.otherVisits)
    .filter((visit) => visit.caregiverId === caregiver.id && weekKey(visit.start) === week)
    .reduce((sum, visit) => sum + wallMinutes(visit.start, visit.end), 0);
  const total = usedMinutes + wallMinutes(ctx.visit.start, ctx.visit.end);
  const max = caregiver.maxHoursPerWeek * 60;
  if (total > max) {
    return fail("hours_limit", `${caregiver.name} would work ${total / 60} hours this week; the limit is ${caregiver.maxHoursPerWeek}.`);
  }
  return pass("hours_limit", `${caregiver.name}: ${total / 60} of ${caregiver.maxHoursPerWeek} hours this week.`);
}

function checkTravelBuffer(ctx: RuleContext, caregiver: CaregiverFacts): RuleResult {
  const day = denverDate(ctx.visit.start);
  const sameDayElsewhere = active(ctx.otherVisits).filter(
    (visit) => visit.caregiverId === caregiver.id && visit.clientId !== ctx.visit.clientId && denverDate(visit.start) === day
  );
  const tooClose = sameDayElsewhere.find((visit) => {
    const gapAfter = (ctx.visit.start.getTime() - visit.end.getTime()) / 60000;
    const gapBefore = (visit.start.getTime() - ctx.visit.end.getTime()) / 60000;
    return (gapAfter >= 0 && gapAfter < TRAVEL_BUFFER_MINUTES) || (gapBefore >= 0 && gapBefore < TRAVEL_BUFFER_MINUTES);
  });
  if (tooClose) {
    return fail("travel_buffer", `${caregiver.name} needs ${TRAVEL_BUFFER_MINUTES} minutes to travel from the visit at ${describeTime(tooClose.start)}.`);
  }
  return pass("travel_buffer", "Enough travel time between visits.");
}

/** One result per rule, in a fixed order. Caregiver rules are left out for an uncovered visit. */
export function checkVisit(ctx: RuleContext): RuleResult[] {
  const results: RuleResult[] = [
    checkWholeUnits(ctx),
    checkAuthorizedService(ctx),
    checkInsideDates(ctx),
    checkUnitsLeft(ctx),
    checkPerVisitLimit(ctx),
    checkPerWeekLimit(ctx),
  ];
  const caregiver = ctx.caregiver;
  if (caregiver) {
    results.push(checkCaregiverAvailable(ctx, caregiver), checkCaregiverQualified(ctx, caregiver));
  }
  results.push(checkNoClash(ctx, caregiver));
  if (caregiver) {
    results.push(checkHoursLimit(ctx, caregiver), checkTravelBuffer(ctx, caregiver));
  }
  return results;
}

export function allPassed(results: RuleResult[]): boolean {
  return results.every((result) => result.passed);
}

export function failedMessages(results: RuleResult[]): string[] {
  return results.filter((result) => !result.passed).map((result) => result.message);
}
