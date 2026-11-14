import { env } from "../../config/env";
import { CostLedger } from "../../models/costLedger.model";
import { todayInDenver } from "../../utils/time";

// A hard daily cap on AI spend, so strangers on the public demo can never run up a bill.
export async function spentToday(): Promise<number> {
  const row = await CostLedger.findOne({ day: todayInDenver() }).lean();
  return row?.usdSpent ?? 0;
}

export async function canSpend(): Promise<boolean> {
  return (await spentToday()) < env.AI_DAILY_USD_CAP;
}

export async function recordSpend(usd: number): Promise<void> {
  if (!(usd > 0)) return;
  await CostLedger.updateOne({ day: todayInDenver() }, { $inc: { usdSpent: usd } }, { upsert: true });
}
