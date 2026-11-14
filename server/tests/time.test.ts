import { atDenver, denverDate, isInsideWindow, wallMinutes, weekdayOf, weekKey } from "../src/utils/time";
import { haversineKm } from "../src/utils/geo";

describe("Denver time helpers", () => {
  it("counts wall-clock minutes across the daylight-saving change", () => {
    // On 1 Nov 2026 Denver clocks go back at 2:00, but the coordinator reads 00:30 -> 03:30 as 3 hours.
    expect(wallMinutes(atDenver("2026-11-01", "00:30"), atDenver("2026-11-01", "03:30"))).toBe(180);
    expect(wallMinutes(atDenver("2027-03-14", "09:00"), atDenver("2027-03-14", "11:00"))).toBe(120);
  });

  it("uses Monday-start weeks", () => {
    expect(weekKey(atDenver("2026-11-16", "10:00"))).toBe(weekKey(atDenver("2026-11-22", "23:00")));
    expect(weekKey(atDenver("2026-11-23", "00:30"))).not.toBe(weekKey(atDenver("2026-11-22", "23:00")));
  });

  it("knows the Denver weekday and date", () => {
    expect(weekdayOf(atDenver("2026-11-16", "09:00"))).toBe("mon");
    // 23:30 in Denver is already the next day in UTC.
    expect(denverDate(atDenver("2026-11-16", "23:30"))).toBe("2026-11-16");
  });

  it("checks a visit against a weekly window", () => {
    const window = { day: "mon" as const, start: "08:00", end: "12:00" };
    expect(isInsideWindow(atDenver("2026-11-16", "09:00"), atDenver("2026-11-16", "11:00"), window)).toBe(true);
    expect(isInsideWindow(atDenver("2026-11-16", "11:00"), atDenver("2026-11-16", "12:30"), window)).toBe(false);
    expect(isInsideWindow(atDenver("2026-11-17", "09:00"), atDenver("2026-11-17", "10:00"), window)).toBe(false);
  });
});

describe("distance", () => {
  it("measures straight-line km", () => {
    const km = haversineKm({ lat: 39.7392, lng: -104.9903 }, { lat: 39.7294, lng: -105.0839 });
    expect(km).toBeGreaterThan(7.9);
    expect(km).toBeLessThan(8.3);
  });
});
