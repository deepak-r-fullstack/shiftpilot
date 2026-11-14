import { Caregiver } from "../src/models/caregiver.model";
import { TEMPLATE_SANDBOX } from "../src/models/common";
import { Visit } from "../src/models/visit.model";
import { findCandidates } from "../src/services/scheduling/candidateFinder";
import { generateAgency, FIXTURES, AgencyData } from "../src/services/demo/seedData";
import { createSandbox } from "../src/services/demo/sandbox.service";
import { toAuthorizationFacts, toCaregiverFacts, toServiceFacts, toVisitFacts } from "../src/services/scheduling/mappers";
import { checkVisit, RuleContext } from "../src/services/scheduling/ruleChecker";
import { addDays, denverDate, weekdayOf } from "../src/utils/time";
import { startTestDb, stopTestDb } from "./helpers/testDb";

const TODAY = "2026-11-14";

function contextFor(data: AgencyData, visitCode: string, caregiverCode: string | null): RuleContext {
  const record = data.visits.find((v) => v.code === visitCode)!;
  const visit = { ...toVisitFacts(record), caregiverId: caregiverCode };
  const auth = data.authorizations.find((a) => a.code === record.authorizationCode)!;
  const location = (code: string) => data.clients.find((c) => c.code === code)!.location;
  return {
    visit,
    service: toServiceFacts(data.services.find((s) => s.code === record.serviceCode)!),
    authorization: toAuthorizationFacts(auth),
    caregiver: caregiverCode ? toCaregiverFacts(data.caregivers.find((c) => c.code === caregiverCode)!) : null,
    clientLocation: location(record.clientCode),
    otherVisits: data.visits.filter((v) => v.code !== visitCode).map((v) => ({ ...toVisitFacts(v), clientLocation: location(v.clientCode) })),
  };
}

describe("demo agency generator", () => {
  const data = generateAgency(42, TODAY);

  it("is deterministic", () => {
    expect(generateAgency(42, TODAY)).toEqual(data);
  });

  it("has the planned size", () => {
    expect(data.caregivers).toHaveLength(25);
    expect(data.clients).toHaveLength(40);
    expect(data.authorizations.length).toBeGreaterThanOrEqual(54);
    expect(data.authorizations.length).toBeLessThanOrEqual(66);
    expect(data.visits.length).toBeGreaterThanOrEqual(2250);
    expect(data.visits.length).toBeLessThanOrEqual(2750);
  });

  it("places every visit within the rules", () => {
    // A sample keeps the test quick; the generator checks every visit as it places it.
    for (const record of data.visits.filter((_, i) => i % 25 === 0)) {
      const results = checkVisit(contextFor(data, record.code, record.caregiverCode));
      expect({ code: record.code, failed: results.filter((r) => !r.passed) }).toEqual({ code: record.code, failed: [] });
    }
  });

  it("has the story fixtures", () => {
    const tomorrow = addDays(TODAY, 1);
    const priyaTomorrow = data.visits.filter((v) => v.caregiverCode === FIXTURES.priya && denverDate(v.start) === tomorrow);
    expect(priyaTomorrow.length).toBeGreaterThanOrEqual(3);
    for (const visit of priyaTomorrow) {
      const others = data.caregivers.filter((c) => c.code !== FIXTURES.priya).map(toCaregiverFacts);
      const candidates = findCandidates({
        visit: { ...toVisitFacts(visit), caregiverId: null },
        caregivers: others,
        contextFor: (cg) => contextFor(data, visit.code, cg.id),
        visitsWithClient: () => 0,
      });
      expect(candidates.length).toBeGreaterThan(0);
    }

    const asha = data.authorizations.find((a) => a.code === FIXTURES.ashaAuthorization)!;
    expect(asha).toMatchObject({ clientCode: FIXTURES.asha, serviceCode: "PC-15", totalUnits: 400, maxUnitsPerWeek: 20 });
    expect(data.visits.some((v) => v.authorizationCode === asha.code)).toBe(false);

    const names = data.caregivers.filter((c) => c.name.startsWith("Maria ")).map((c) => c.code);
    expect(names).toEqual([FIXTURES.mariaLopez, FIXTURES.mariaChen]);

    const raoVisits = data.visits.filter((v) => v.clientCode === FIXTURES.mohanRao && v.status === "scheduled");
    expect(new Set(raoVisits.map((v) => weekdayOf(v.start)))).toEqual(new Set(["mon", "thu"]));

    const nearly = data.authorizations.find((a) => a.code === FIXTURES.nearlyUsedUpAuthorization)!;
    const used = data.visits.filter((v) => v.authorizationCode === nearly.code).reduce((s, v) => s + v.units, 0);
    expect(nearly.totalUnits - used).toBe(4);
  });
});

describe("sandboxes", () => {
  beforeAll(startTestDb);
  afterAll(stopTestDb);

  it("copies the template for each visitor without touching it", async () => {
    const sandbox = await createSandbox(TODAY);
    const id = String(sandbox._id);
    const [templateVisits, sandboxVisits] = await Promise.all([
      Visit.countDocuments({ sandboxId: TEMPLATE_SANDBOX }),
      Visit.countDocuments({ sandboxId: id }),
    ]);
    expect(sandboxVisits).toBe(templateVisits);
    expect(await Caregiver.countDocuments({ sandboxId: id })).toBe(25);

    await Visit.updateMany({ sandboxId: id, caregiverCode: FIXTURES.priya }, { caregiverCode: null });
    expect(await Visit.countDocuments({ sandboxId: TEMPLATE_SANDBOX, caregiverCode: FIXTURES.priya })).toBeGreaterThan(0);
    expect(sandbox.label).toMatch(/^Visitor [0-9A-F]{4}$/);
  });
});
