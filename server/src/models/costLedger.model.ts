import { Schema, model, InferSchemaType } from "mongoose";

// AI spend per Denver day, so the public demo can never run up a bill.
const costLedgerSchema = new Schema({
  day: { type: String, required: true, unique: true },
  usdSpent: { type: Number, default: 0 },
});

export type CostLedgerDoc = InferSchemaType<typeof costLedgerSchema>;
export const CostLedger = model("CostLedger", costLedgerSchema);
