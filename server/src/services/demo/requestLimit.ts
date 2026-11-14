import { TooManyRequestsError } from "../../helpers/errors";
import { Sandbox } from "../../models/sandbox.model";
import { todayInDenver } from "../../utils/time";

// Free-typed requests per visitor per day. Story buttons do not count.
export const FREE_REQUESTS_PER_DAY = 10;

export async function freeRequestsLeft(sandboxId: string): Promise<number> {
  const sandbox = await Sandbox.findById(sandboxId).lean();
  if (!sandbox || sandbox.requestsDay !== todayInDenver()) return FREE_REQUESTS_PER_DAY;
  return Math.max(0, FREE_REQUESTS_PER_DAY - sandbox.requestsUsed);
}

/** Takes one free request, atomically, or refuses with a friendly message. */
export async function takeFreeRequest(sandboxId: string): Promise<number> {
  const day = todayInDenver();
  // A new day starts the counter again.
  await Sandbox.updateOne({ _id: sandboxId, requestsDay: { $ne: day } }, { requestsDay: day, requestsUsed: 0 });
  const updated = await Sandbox.findOneAndUpdate(
    { _id: sandboxId, requestsDay: day, requestsUsed: { $lt: FREE_REQUESTS_PER_DAY } },
    { $inc: { requestsUsed: 1 } },
    { new: true }
  ).lean();
  if (!updated) throw new TooManyRequestsError(`You've used today's ${FREE_REQUESTS_PER_DAY} free requests. The story buttons still work.`);
  return FREE_REQUESTS_PER_DAY - updated.requestsUsed;
}
