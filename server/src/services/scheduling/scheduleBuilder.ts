import { BadRequestError } from "../../helpers/errors";
import { addDays, atDenver, denverDate, wallMinutes, weekdayOfDate, weekKey } from "../../utils/time";
import { AuthorizationFacts, ServiceFacts, VisitFacts, Weekday } from "./types";

// ---------------------------------------------------------------------------
// Builds a whole schedule from one authorization: spread the units left evenly
// over the chosen weekdays, never above the per-visit or per-week limits.
// Plain code (no AI): the agent only picks the days and the caregivers.
// ---------------------------------------------------------------------------

export interface BuildScheduleInput {
  authorization: AuthorizationFacts;
  service: ServiceFacts;
  days: Weekday[];
  window: { start: string; end: string }; // "HH:mm" Denver
  visitMinutes?: number;
  today: string; // Denver "YYYY-MM-DD"; planning starts the day after
  existingVisits: VisitFacts[]; // visits already on this authorization
}

export interface PlannedVisit {
  start: Date;
  end: Date;
  units: number;
}

export type UnscheduledReason = "weekly limit reached" | "per-visit limit reached" | "time window too short" | "no matching days left";

export interface BuildScheduleResult {
  visits: PlannedVisit[];
  unitsAvailable: number;
  unitsScheduled: number;
  unscheduledUnits: number;
  unscheduledReason: UnscheduledReason | null;
}

interface Slot {
  date: string;
  week: string;
  units: number;
}

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function buildSchedule(input: BuildScheduleInput): BuildScheduleResult {
  const { authorization: auth, service, window } = input;
  const unit = service.unitMinutes;
  const existing = input.existingVisits.filter((visit) => visit.status !== "cancelled");
  const unitsAvailable = Math.max(0, auth.totalUnits - existing.reduce((sum, visit) => sum + visit.units, 0));

  const windowMinutes = minutesOf(window.end) - minutesOf(window.start);
  if (windowMinutes <= 0) throw new BadRequestError("The time window must end after it starts.");
  const windowCap = Math.floor(windowMinutes / unit);
  const visitCap = auth.maxUnitsPerVisit ?? Infinity;
  const slotCap = Math.min(visitCap, windowCap);

  // Weekly room left after existing visits.
  const weekUsed = new Map<string, number>();
  for (const visit of existing) weekUsed.set(weekKey(visit.start), (weekUsed.get(weekKey(visit.start)) ?? 0) + visit.units);
  const weekMax = auth.maxUnitsPerWeek ?? Infinity;
  const weekRoom = (week: string) => weekMax - (weekUsed.get(week) ?? 0);

  // Every chosen weekday from tomorrow (or the start date) to the end date, without a visit already.
  const busyDates = new Set(existing.map((visit) => denverDate(visit.start)));
  const first = input.today >= auth.startDate ? addDays(input.today, 1) : auth.startDate;
  const slots: Slot[] = [];
  for (let date = first; date <= auth.endDate; date = addDays(date, 1)) {
    if (!input.days.includes(weekdayOfDate(date)) || busyDates.has(date)) continue;
    slots.push({ date, week: weekKey(atDenver(date, window.start)), units: 0 });
  }

  const result = (reason: UnscheduledReason | null): BuildScheduleResult => {
    const visits = slots
      .filter((slot) => slot.units > 0)
      .map((slot) => {
        const start = atDenver(slot.date, window.start);
        const endMinutes = minutesOf(window.start) + slot.units * unit;
        const end = atDenver(slot.date, `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`);
        return { start, end, units: slot.units };
      });
    const unitsScheduled = visits.reduce((sum, visit) => sum + visit.units, 0);
    const unscheduledUnits = unitsAvailable - unitsScheduled;
    return { visits, unitsAvailable, unitsScheduled, unscheduledUnits, unscheduledReason: unscheduledUnits > 0 ? reason : null };
  };

  if (slots.length === 0) return result("no matching days left");
  if (slotCap <= 0) return result(windowCap <= 0 ? "time window too short" : "per-visit limit reached");

  // Which limit stopped us, for an honest message.
  const limitReason = (): UnscheduledReason => {
    const anyWeekRoom = slots.some((slot) => weekRoom(slot.week) > 0);
    if (!anyWeekRoom) return "weekly limit reached";
    if (windowCap < visitCap) return "time window too short";
    return "per-visit limit reached";
  };
  const take = (slot: Slot, units: number) => {
    slot.units += units;
    weekUsed.set(slot.week, (weekUsed.get(slot.week) ?? 0) + units);
  };

  if (input.visitMinutes !== undefined) {
    if (input.visitMinutes % unit !== 0) throw new BadRequestError(`A visit must be whole ${unit}-minute units.`);
    const size = input.visitMinutes / unit;
    if (size > slotCap) return result(size > windowCap ? "time window too short" : "per-visit limit reached");
    const wanted = Math.floor(unitsAvailable / size);
    const k = Math.min(wanted, slots.length);
    if (k > 0) {
      // Evenly spaced slots; skip forward past full weeks.
      const chosen = new Set<number>();
      for (let i = 0; i < k; i += 1) {
        let index = Math.floor((i * slots.length) / k);
        while (index < slots.length && (chosen.has(index) || weekRoom(slots[index].week) < size)) index += 1;
        if (index >= slots.length) break;
        chosen.add(index);
        take(slots[index], size);
      }
    }
    return result(wanted > slots.length ? "no matching days left" : limitReason());
  }

  // Even share first, then hand out what is left one unit at a time, earliest first.
  const base = Math.floor(unitsAvailable / slots.length);
  let remaining = unitsAvailable;
  for (const slot of slots) {
    const units = Math.min(base, slotCap, weekRoom(slot.week));
    if (units > 0) {
      take(slot, units);
      remaining -= units;
    }
  }
  let placed = true;
  while (remaining > 0 && placed) {
    placed = false;
    for (const slot of slots) {
      if (remaining === 0) break;
      if (slot.units < slotCap && weekRoom(slot.week) > 0) {
        take(slot, 1);
        remaining -= 1;
        placed = true;
      }
    }
  }
  return result(remaining > 0 ? limitReason() : null);
}

/** Wall-clock check used by tests and the seed: every planned visit is whole units. */
export function plannedMinutes(visit: PlannedVisit): number {
  return wallMinutes(visit.start, visit.end);
}
