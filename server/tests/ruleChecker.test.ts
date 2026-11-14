import { allPassed, checkVisit, RuleContext } from "../src/services/scheduling/ruleChecker";
import { RuleId, VisitFacts } from "../src/services/scheduling/types";
import { atDenver } from "../src/utils/time";

const HOME = { lat: 39.74, lng: -104.99 };
const OTHER_HOME = { lat: 39.7, lng: -105.05 };

function visit(overrides: Partial<VisitFacts> = {}): VisitFacts {
  return {
    id: "v1",
    clientId: "cl1",
    caregiverId: "cg1",
    authorizationId: "au1",
    serviceCode: "PC-15",
    start: atDenver("2026-11-16", "09:00"),
    end: atDenver("2026-11-16", "11:00"),
    units: 8,
    status: "scheduled",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    visit: visit(),
    service: { code: "PC-15", name: "Personal care", unitMinutes: 15, requiredSkill: "personal_care" },
    authorization: {
      id: "au1",
      clientId: "cl1",
      serviceCode: "PC-15",
      startDate: "2026-11-01",
      endDate: "2026-12-31",
      totalUnits: 400,
      maxUnitsPerVisit: 12,
      maxUnitsPerWeek: 20,
    },
    caregiver: {
      id: "cg1",
      name: "Priya Nair",
      skills: ["personal_care"],
      homeLocation: HOME,
      weeklyAvailability: ["mon", "tue", "wed", "thu", "fri"].map((day) => ({ day: day as any, start: "07:00", end: "17:00" })),
      timeOff: [],
      maxHoursPerWeek: 40,
    },
    clientLocation: HOME,
    otherVisits: [],
    ...overrides,
  };
}

function result(ctx: RuleContext, rule: RuleId) {
  const found = checkVisit(ctx).find((r) => r.rule === rule);
  if (!found) throw new Error(`rule ${rule} not checked`);
  return found;
}

const other = (overrides: Partial<VisitFacts> & { clientLocation?: typeof HOME } = {}) => ({
  ...visit({ id: "v2", ...overrides }),
  clientLocation: overrides.clientLocation ?? HOME,
});

describe("rule checker", () => {
  it("passes a normal visit", () => {
    expect(allPassed(checkVisit(makeCtx()))).toBe(true);
    expect(checkVisit(makeCtx())).toHaveLength(11);
  });

  it("skips caregiver rules for an uncovered visit", () => {
    const rules = checkVisit(makeCtx({ caregiver: null, visit: visit({ caregiverId: null }) })).map((r) => r.rule);
    expect(rules).not.toContain("caregiver_available");
    expect(rules).toContain("no_clash");
  });

  describe("whole_units", () => {
    it("passes 2 hours as 8 units, even on the daylight-saving day", () => {
      const ctx = makeCtx({
        visit: visit({ start: atDenver("2026-11-01", "09:00"), end: atDenver("2026-11-01", "11:00") }),
        authorization: { ...makeCtx().authorization!, startDate: "2026-10-01" },
      });
      expect(result(ctx, "whole_units").passed).toBe(true);
    });
    it("fails a 50-minute visit", () => {
      const ctx = makeCtx({ visit: visit({ end: atDenver("2026-11-16", "09:50"), units: 3 }) });
      expect(result(ctx, "whole_units").passed).toBe(false);
    });
    it("fails when units do not match the length", () => {
      expect(result(makeCtx({ visit: visit({ units: 6 }) }), "whole_units").passed).toBe(false);
    });
  });

  describe("authorized_service", () => {
    it("fails without an authorization", () => {
      expect(result(makeCtx({ authorization: null }), "authorized_service").passed).toBe(false);
    });
    it("fails for another service", () => {
      expect(result(makeCtx({ visit: visit({ serviceCode: "HM-15" }) }), "authorized_service").passed).toBe(false);
    });
  });

  describe("inside_dates", () => {
    it("passes on the last day", () => {
      const ctx = makeCtx({ visit: visit({ start: atDenver("2026-12-31", "09:00"), end: atDenver("2026-12-31", "11:00") }) });
      expect(result(ctx, "inside_dates").passed).toBe(true);
    });
    it("fails the day after", () => {
      const ctx = makeCtx({ visit: visit({ start: atDenver("2027-01-01", "09:00"), end: atDenver("2027-01-01", "11:00") }) });
      expect(result(ctx, "inside_dates").passed).toBe(false);
    });
  });

  describe("units_left", () => {
    const usedVisit = (units: number) =>
      other({ id: "old", caregiverId: "cg9", start: atDenver("2026-11-02", "09:00"), end: atDenver("2026-11-02", "09:15"), units });
    it("lets the last units fit exactly", () => {
      expect(result(makeCtx({ otherVisits: [usedVisit(392)] }), "units_left").passed).toBe(true);
    });
    it("fails with 4 left for an 8-unit visit, naming both numbers", () => {
      const r = result(makeCtx({ otherVisits: [usedVisit(396)] }), "units_left");
      expect(r.passed).toBe(false);
      expect(r.message).toContain("4 units");
      expect(r.message).toContain("8");
    });
    it("ignores cancelled visits", () => {
      expect(result(makeCtx({ otherVisits: [{ ...usedVisit(396), status: "cancelled" }] }), "units_left").passed).toBe(true);
    });
  });

  describe("per_visit_limit", () => {
    it("passes at the limit", () => {
      const ctx = makeCtx({ visit: visit({ end: atDenver("2026-11-16", "12:00"), units: 12 }) });
      expect(result(ctx, "per_visit_limit").passed).toBe(true);
    });
    it("fails over the limit", () => {
      const ctx = makeCtx({ visit: visit({ end: atDenver("2026-11-16", "12:15"), units: 13 }) });
      expect(result(ctx, "per_visit_limit").passed).toBe(false);
    });
  });

  describe("per_week_limit", () => {
    it("fails when the week is full", () => {
      const sameWeek = other({ id: "w", caregiverId: "cg9", start: atDenver("2026-11-18", "09:00"), end: atDenver("2026-11-18", "12:00"), units: 12 + 1 });
      expect(result(makeCtx({ otherVisits: [sameWeek] }), "per_week_limit").passed).toBe(false);
    });
    it("does not count another week", () => {
      const lastWeek = other({ id: "w", caregiverId: "cg9", start: atDenver("2026-11-15", "09:00"), end: atDenver("2026-11-15", "12:00"), units: 12 });
      expect(result(makeCtx({ otherVisits: [lastWeek] }), "per_week_limit").passed).toBe(true);
    });
  });

  describe("caregiver_available", () => {
    it("fails outside working hours", () => {
      const ctx = makeCtx({ visit: visit({ start: atDenver("2026-11-16", "16:00"), end: atDenver("2026-11-16", "18:00") }) });
      expect(result(ctx, "caregiver_available").passed).toBe(false);
    });
    it("fails on time off", () => {
      const base = makeCtx();
      const ctx = makeCtx({ caregiver: { ...base.caregiver!, timeOff: [{ start: atDenver("2026-11-16", "00:00"), end: atDenver("2026-11-17", "00:00") }] } });
      expect(result(ctx, "caregiver_available").passed).toBe(false);
    });
  });

  describe("caregiver_qualified", () => {
    it("fails without the skill", () => {
      const base = makeCtx();
      expect(result(makeCtx({ caregiver: { ...base.caregiver!, skills: ["homemaker"] } }), "caregiver_qualified").passed).toBe(false);
    });
  });

  describe("no_clash", () => {
    it("fails when the caregiver is already booked", () => {
      const clash = other({ clientId: "cl2", authorizationId: "au2", start: atDenver("2026-11-16", "10:00"), end: atDenver("2026-11-16", "12:00") });
      expect(result(makeCtx({ otherVisits: [clash] }), "no_clash").passed).toBe(false);
    });
    it("fails when the client already has a visit", () => {
      const clash = other({ caregiverId: "cg9", start: atDenver("2026-11-16", "10:00"), end: atDenver("2026-11-16", "12:00") });
      expect(result(makeCtx({ otherVisits: [clash] }), "no_clash").passed).toBe(false);
    });
  });

  describe("hours_limit", () => {
    it("fails over the weekly hours", () => {
      const base = makeCtx();
      const busy = other({ clientId: "cl2", authorizationId: "au2", start: atDenver("2026-11-17", "07:00"), end: atDenver("2026-11-17", "15:00"), units: 32 });
      const ctx = makeCtx({ caregiver: { ...base.caregiver!, maxHoursPerWeek: 9 }, otherVisits: [busy] });
      expect(result(ctx, "hours_limit").passed).toBe(false);
    });
  });

  describe("travel_buffer", () => {
    const before = (clientId: string, clientLocation = OTHER_HOME) =>
      other({ clientId, authorizationId: "au2", start: atDenver("2026-11-16", "07:50"), end: atDenver("2026-11-16", "08:50"), units: 4, clientLocation });
    it("fails a 10-minute gap at another client", () => {
      expect(result(makeCtx({ otherVisits: [before("cl2")] }), "travel_buffer").passed).toBe(false);
    });
    it("passes a 10-minute gap at the same client", () => {
      const sameClient = { ...before("cl1", HOME), authorizationId: "au9" };
      expect(result(makeCtx({ otherVisits: [sameClient] }), "travel_buffer").passed).toBe(true);
    });
  });
});
