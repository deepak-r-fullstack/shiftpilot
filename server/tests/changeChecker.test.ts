import { Caregiver } from "../src/models/caregiver.model";
import { Visit } from "../src/models/visit.model";
import { FIXTURES } from "../src/services/demo/seedData";
import { checkChange, factsOf } from "../src/services/scheduling/changeChecker";
import { atDenver } from "../src/utils/time";
import { newSandbox, priyaVisitsTomorrow, TOMORROW } from "./helpers/fixtures";
import { startTestDb, stopTestDb } from "./helpers/testDb";

describe("change checker", () => {
  let sandboxId: string;
  beforeAll(async () => {
    await startTestDb();
    sandboxId = await newSandbox();
  });
  afterAll(stopTestDb);

  it("accepts an assign to a float caregiver", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const checked = await checkChange(sandboxId, { kind: "assign", visitCode: visit.code, caregiverCode: "CG-02" });
    expect(checked.ok).toBe(true);
    expect(checked.after?.caregiverCode).toBe("CG-02");
    expect(checked.unitsLeftAfter).toBe(checked.unitsLeftBefore);
  });

  it("refuses a caregiver who is already booked", async () => {
    const [first, second] = await priyaVisitsTomorrow(sandboxId);
    // Book CG-03 on the first visit in the database, then try to give it an overlapping one.
    await Visit.updateOne({ sandboxId, code: first.code }, { caregiverCode: "CG-03" });
    const checked = await checkChange(sandboxId, {
      kind: "move",
      visitCode: second.code,
      caregiverCode: "CG-03",
      start: first.start.toISOString(),
      end: first.end.toISOString(),
    });
    expect(checked.ok).toBe(false);
    expect(checked.ruleResults.find((r) => r.rule === "no_clash")?.passed).toBe(false);
    await Visit.updateOne({ sandboxId, code: first.code }, { caregiverCode: FIXTURES.priya });
  });

  it("sees a clash between two changes in the same proposal", async () => {
    const [first, second] = await priyaVisitsTomorrow(sandboxId);
    const one = await checkChange(sandboxId, { kind: "assign", visitCode: first.code, caregiverCode: "CG-04" });
    expect(one.ok).toBe(true);
    const sibling = factsOf(one.after!);
    const two = await checkChange(
      sandboxId,
      { kind: "move", visitCode: second.code, caregiverCode: "CG-04", start: first.start.toISOString(), end: first.end.toISOString() },
      [sibling]
    );
    expect(two.ruleResults.find((r) => r.rule === "no_clash")?.passed).toBe(false);
  });

  it("gives units back on cancel", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const checked = await checkChange(sandboxId, { kind: "cancel", visitCode: visit.code });
    expect(checked.ok).toBe(true);
    expect(checked.unitsLeftAfter).toBe(checked.unitsLeftBefore! + visit.units);
  });

  it("refuses a new visit that needs more units than are left", async () => {
    const free = await Caregiver.findOne({ sandboxId, code: "CG-02" }).lean();
    expect(free).toBeTruthy();
    const checked = await checkChange(sandboxId, {
      kind: "create",
      clientCode: FIXTURES.nearlyUsedUp,
      authorizationCode: FIXTURES.nearlyUsedUpAuthorization,
      caregiverCode: "CG-02",
      start: atDenver(TOMORROW, "16:00").toISOString(),
      end: atDenver(TOMORROW, "18:00").toISOString(),
    });
    const units = checked.ruleResults.find((r) => r.rule === "units_left")!;
    expect(units.passed).toBe(false);
    expect(units.message).toContain("4 units");
  });

  it("marks a small move as low risk", async () => {
    const [visit] = await priyaVisitsTomorrow(sandboxId);
    const checked = await checkChange(sandboxId, {
      kind: "move",
      visitCode: visit.code,
      start: new Date(visit.start.getTime() - 15 * 60000).toISOString(),
      end: new Date(visit.end.getTime() - 15 * 60000).toISOString(),
    });
    expect(checked.lowRisk).toBe(true);
  });
});
