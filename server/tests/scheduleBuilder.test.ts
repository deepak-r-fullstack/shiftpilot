import { buildSchedule, BuildScheduleInput, plannedMinutes } from "../src/services/scheduling/scheduleBuilder";
import { atDenver, denverDate, weekKey } from "../src/utils/time";

function input(overrides: Partial<BuildScheduleInput> = {}, authOverrides: Partial<BuildScheduleInput["authorization"]> = {}): BuildScheduleInput {
  return {
    authorization: {
      id: "au1",
      clientId: "cl1",
      serviceCode: "PC-15",
      startDate: "2027-01-04",
      endDate: "2027-06-25",
      totalUnits: 400,
      maxUnitsPerVisit: null,
      maxUnitsPerWeek: null,
      ...authOverrides,
    },
    service: { code: "PC-15", name: "Personal care", unitMinutes: 15, requiredSkill: "personal_care" },
    days: ["mon", "wed", "fri"],
    window: { start: "09:00", end: "13:00" },
    today: "2027-01-01",
    existingVisits: [],
    ...overrides,
  };
}

describe("schedule builder", () => {
  it("spreads 400 units evenly, extras to the earliest visits", () => {
    const result = buildSchedule(input());
    expect(result.unitsScheduled).toBe(400);
    expect(result.unscheduledUnits).toBe(0);
    const units = result.visits.map((v) => v.units);
    expect(new Set(units)).toEqual(new Set([5, 6]));
    const lastSix = units.lastIndexOf(6);
    const firstFive = units.indexOf(5);
    expect(lastSix).toBeLessThan(firstFive);
  });

  it("never goes over the weekly limit and says so", () => {
    const result = buildSchedule(input({}, { maxUnitsPerWeek: 12 }));
    const perWeek = new Map<string, number>();
    result.visits.forEach((v) => perWeek.set(weekKey(v.start), (perWeek.get(weekKey(v.start)) ?? 0) + v.units));
    expect(Math.max(...perWeek.values())).toBeLessThanOrEqual(12);
    expect(result.unscheduledUnits).toBeGreaterThan(0);
    expect(result.unscheduledReason).toBe("weekly limit reached");
  });

  it("respects the per-visit limit and a short window", () => {
    const result = buildSchedule(input({ window: { start: "09:00", end: "10:00" } }, { maxUnitsPerVisit: 8 }));
    expect(Math.max(...result.visits.map((v) => v.units))).toBeLessThanOrEqual(4);
    expect(result.unscheduledReason).toBe("time window too short");
  });

  it("counts existing visits and skips their dates", () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      clientId: "cl1",
      caregiverId: "cg1",
      authorizationId: "au1",
      serviceCode: "PC-15",
      start: atDenver(`2027-01-${String(4 + i).padStart(2, "0")}`, "09:00"),
      end: atDenver(`2027-01-${String(4 + i).padStart(2, "0")}`, "11:30"),
      units: 10,
      status: "scheduled" as const,
    }));
    const result = buildSchedule(input({ existingVisits: existing }));
    expect(result.unitsAvailable).toBe(300);
    const busy = new Set(existing.map((v) => denverDate(v.start)));
    expect(result.visits.some((v) => busy.has(denverDate(v.start)))).toBe(false);
  });

  it("uses a fixed visit length when given", () => {
    const result = buildSchedule(input({ visitMinutes: 120 }));
    expect(result.visits.every((v) => v.units === 8)).toBe(true);
    expect(result.visits.length).toBe(Math.floor(400 / 8));
  });

  it("keeps wall-clock length across the March daylight-saving change", () => {
    const result = buildSchedule(input({ days: ["sun", "mon"] }, { startDate: "2027-03-07", endDate: "2027-03-21" }));
    expect(result.visits.some((v) => denverDate(v.start) === "2027-03-14")).toBe(true);
    result.visits.forEach((v) => expect(plannedMinutes(v)).toBe(v.units * 15));
  });

  it("starts the day after today when the authorization already started", () => {
    const result = buildSchedule(input({ today: "2027-02-01" }));
    expect(denverDate(result.visits[0].start) > "2027-02-01").toBe(true);
  });

  it("reports when no days are left", () => {
    const result = buildSchedule(input({ today: "2027-07-01" }));
    expect(result.visits).toHaveLength(0);
    expect(result.unscheduledReason).toBe("no matching days left");
  });
});
