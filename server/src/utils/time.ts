import { DateTime } from "luxon";
import { Weekday, WeeklyWindow, WEEKDAYS } from "../services/scheduling/types";

// All scheduling happens in the agency's own time zone. Visits are stored as
// real instants (Date), but days, weeks and availability are Denver wall clock,
// so a 9:00–11:00 visit is 8 units even on the day the clocks change.
export const ZONE = "America/Denver";

function inZone(d: Date) {
  return DateTime.fromJSDate(d, { zone: ZONE });
}

/** Minutes between two instants as a person in Denver reads them on the clock. */
export function wallMinutes(start: Date, end: Date): number {
  const a = inZone(start);
  const b = inZone(end);
  const wallA = DateTime.fromObject(a.toObject(), { zone: "UTC" });
  const wallB = DateTime.fromObject(b.toObject(), { zone: "UTC" });
  return Math.round(wallB.diff(wallA, "minutes").minutes);
}

/** ISO week of the Denver date, weeks start on Monday, e.g. "2026-W47". */
export function weekKey(d: Date): string {
  const dt = inZone(d);
  return `${dt.weekYear}-W${String(dt.weekNumber).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" of the Denver date. */
export function denverDate(d: Date): string {
  return inZone(d).toISODate()!;
}

export function weekdayOf(d: Date): Weekday {
  return WEEKDAYS[inZone(d).weekday - 1];
}

export function weekdayOfDate(date: string): Weekday {
  return WEEKDAYS[DateTime.fromISO(date, { zone: ZONE }).weekday - 1];
}

/** The instant for a Denver date and "HH:mm". */
export function atDenver(date: string, hhmm: string): Date {
  const [hour, minute] = hhmm.split(":").map(Number);
  return DateTime.fromISO(date, { zone: ZONE }).set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

/** "HH:mm" of an instant in Denver. */
export function denverTime(d: Date): string {
  return inZone(d).toFormat("HH:mm");
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: ZONE }).plus({ days }).toISODate()!;
}

export function todayInDenver(now = new Date()): string {
  return denverDate(now);
}

function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(":").map(Number);
  return hour * 60 + minute;
}

/** True when the whole visit sits inside the weekly window on the same Denver day. */
export function isInsideWindow(start: Date, end: Date, window: WeeklyWindow): boolean {
  if (weekdayOf(start) !== window.day) return false;
  if (denverDate(start) !== denverDate(new Date(end.getTime() - 1))) return false;
  const startMinutes = minutesOfDay(denverTime(start));
  const endMinutes = startMinutes + wallMinutes(start, end);
  return startMinutes >= minutesOfDay(window.start) && endMinutes <= minutesOfDay(window.end);
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Readable Denver time for messages, e.g. "Tue 17 Nov, 9:00". */
export function describeTime(d: Date): string {
  return inZone(d).toFormat("ccc d LLL, H:mm");
}
