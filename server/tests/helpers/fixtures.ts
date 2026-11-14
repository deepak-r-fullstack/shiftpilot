import { Visit } from "../../src/models/visit.model";
import { createSandbox } from "../../src/services/demo/sandbox.service";
import { FIXTURES } from "../../src/services/demo/seedData";
import { addDays, dayRangeOfDate } from "../../src/utils/time";

// The fixed "today" all database tests run on, so the seed is the same every time.
export const TODAY = "2026-11-14";
export const TOMORROW = addDays(TODAY, 1);

export async function newSandbox() {
  const sandbox = await createSandbox(TODAY);
  return String(sandbox._id);
}

export async function priyaVisitsTomorrow(sandboxId: string) {
  const day = dayRangeOfDate(TOMORROW);
  return Visit.find({ sandboxId, caregiverCode: FIXTURES.priya, start: { $gte: day.from, $lt: day.to } }).sort({ start: 1 }).lean();
}
