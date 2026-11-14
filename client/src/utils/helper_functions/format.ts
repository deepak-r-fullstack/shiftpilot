// Everything is shown in the agency's own time zone, wherever the visitor is.
export const AGENCY_ZONE = "America/Denver";

const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_ZONE, hour: "numeric", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_ZONE, weekday: "short", month: "short", day: "numeric" });
const longDayFormat = new Intl.DateTimeFormat("en-US", { timeZone: AGENCY_ZONE, weekday: "long", month: "long", day: "numeric" });
const isoDateFormat = new Intl.DateTimeFormat("en-CA", { timeZone: AGENCY_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatTime = (value: string | Date) => timeFormat.format(new Date(value));
export const formatDay = (value: string | Date) => dayFormat.format(new Date(value));
export const formatLongDay = (value: string | Date) => longDayFormat.format(new Date(value));
export const formatTimeRange = (start: string, end: string) => `${formatTime(start)}–${formatTime(end)}`;

/** "YYYY-MM-DD" of the agency's date for an instant. */
export const agencyDate = (value: string | Date) => isoDateFormat.format(new Date(value));

/** Plain calendar maths on "YYYY-MM-DD" strings (no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** "Mon 16" for column heads. */
export function shortDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}

/** "Mon, Nov 16" for headings. */
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}

/** Local "HH:mm" for a time input, in the agency's zone. */
export function agencyHHmm(value: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: AGENCY_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

/**
 * The instant for an agency date and "HH:mm". Works out Denver's offset for that day
 * (it changes with daylight saving) by asking Intl what the clock reads.
 */
export function agencyInstant(date: string, hhmm: string): string {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  for (let i = 0; i < 2; i += 1) {
    const shown = agencyHHmm(guess.toISOString());
    const shownDate = agencyDate(guess);
    const [h, m] = hhmm.split(":").map(Number);
    const [sh, sm] = shown.split(":").map(Number);
    const dayShift = shownDate === date ? 0 : shownDate > date ? 1 : -1;
    const diffMinutes = (h * 60 + m) - (sh * 60 + sm) - dayShift * 1440;
    guess.setUTCMinutes(guess.getUTCMinutes() + diffMinutes);
  }
  // On the spring daylight-saving day, 2:00-2:59 does not exist on the clock.
  if (agencyHHmm(guess.toISOString()) !== hhmm || agencyDate(guess) !== date) {
    throw new Error("That time does not exist on this day (the clocks change). Pick another time.");
  }
  return guess.toISOString();
}

export function firstName(name: string | null | undefined) {
  return name ? name.split(" ")[0] : "";
}
