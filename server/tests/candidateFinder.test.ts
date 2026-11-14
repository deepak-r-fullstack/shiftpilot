import { findCandidates } from "../src/services/scheduling/candidateFinder";
import { isLowRisk } from "../src/services/scheduling/lowRisk";
import { RuleContext } from "../src/services/scheduling/ruleChecker";
import { CaregiverFacts, VisitFacts } from "../src/services/scheduling/types";
import { atDenver } from "../src/utils/time";

const CLIENT = { lat: 39.74, lng: -104.99 };
const week = ["mon", "tue", "wed", "thu", "fri"].map((day) => ({ day: day as any, start: "07:00", end: "17:00" }));

function caregiver(id: string, overrides: Partial<CaregiverFacts> = {}): CaregiverFacts {
  return { id, name: id, skills: ["personal_care"], homeLocation: CLIENT, weeklyAvailability: week, timeOff: [], maxHoursPerWeek: 40, ...overrides };
}

const visit: VisitFacts = {
  id: "v1",
  clientId: "cl1",
  caregiverId: null,
  authorizationId: "au1",
  serviceCode: "PC-15",
  start: atDenver("2026-11-16", "09:00"),
  end: atDenver("2026-11-16", "11:00"),
  units: 8,
  status: "scheduled",
};

function contextFor(): RuleContext {
  return {
    visit,
    service: { code: "PC-15", name: "Personal care", unitMinutes: 15, requiredSkill: "personal_care" },
    authorization: { id: "au1", clientId: "cl1", serviceCode: "PC-15", startDate: "2026-11-01", endDate: "2026-12-31", totalUnits: 400 },
    caregiver: null,
    clientLocation: CLIENT,
    otherVisits: [],
  };
}

describe("candidate finder", () => {
  const pool = [
    caregiver("unqualified", { skills: ["homemaker"] }),
    caregiver("on-leave", { timeOff: [{ start: atDenver("2026-11-16", "00:00"), end: atDenver("2026-11-17", "00:00") }] }),
    caregiver("near-stranger", { homeLocation: { lat: 39.741, lng: -104.991 } }),
    caregiver("familiar", { homeLocation: { lat: 39.8, lng: -105.1 } }),
    caregiver("far", { homeLocation: { lat: 40.2, lng: -105.5 } }),
  ];
  const visitsWithClient = (id: string) => (id === "familiar" ? 3 : 0);

  it("drops caregivers who break a rule", () => {
    const ids = findCandidates({ visit, caregivers: pool, contextFor, visitsWithClient }).map((c) => c.caregiverId);
    expect(ids).not.toContain("unqualified");
    expect(ids).not.toContain("on-leave");
  });

  it("ranks someone the client knows above a nearer stranger, then by distance", () => {
    const ids = findCandidates({ visit, caregivers: pool, contextFor, visitsWithClient }).map((c) => c.caregiverId);
    expect(ids).toEqual(["familiar", "near-stranger", "far"]);
  });

  it("explains each candidate and respects the limit", () => {
    const found = findCandidates({ visit, caregivers: pool, contextFor, visitsWithClient, limit: 1 });
    expect(found).toHaveLength(1);
    expect(found[0].facts).toContain("3 past visits");
    expect(found[0].facts).toContain("km");
  });
});

describe("low risk", () => {
  const before = { caregiverId: "cg1", units: 8, start: atDenver("2026-11-16", "09:00"), status: "scheduled" as const };
  it("allows a 15-minute move with the same caregiver", () => {
    expect(isLowRisk(before, { ...before, start: atDenver("2026-11-16", "09:15") })).toBe(true);
  });
  it("rejects 16 minutes, a new caregiver, or new units", () => {
    expect(isLowRisk(before, { ...before, start: atDenver("2026-11-16", "09:16") })).toBe(false);
    expect(isLowRisk(before, { ...before, caregiverId: "cg2", start: atDenver("2026-11-16", "09:15") })).toBe(false);
    expect(isLowRisk(before, { ...before, units: 9, start: atDenver("2026-11-16", "09:15") })).toBe(false);
  });
});
