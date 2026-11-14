import { Schema, model, InferSchemaType, Types } from "mongoose";
import { sandboxField } from "./common";

// One visit. "version" goes up on every change, so applying or undoing a plan
// can refuse when someone else changed the visit in the meantime.
const visitSchema = new Schema({
  sandboxId: sandboxField,
  code: { type: String, required: true }, // "V-1042"
  clientCode: { type: String, required: true },
  caregiverCode: { type: String, default: null }, // null = uncovered
  authorizationCode: { type: String, required: true },
  serviceCode: { type: String, required: true },
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  units: { type: Number, required: true },
  status: { type: String, enum: ["scheduled", "cancelled", "completed"], default: "scheduled" },
  version: { type: Number, default: 0 },
});
visitSchema.index({ sandboxId: 1, code: 1 }, { unique: true });
visitSchema.index({ sandboxId: 1, caregiverCode: 1, start: 1 });
visitSchema.index({ sandboxId: 1, clientCode: 1, start: 1 });
visitSchema.index({ sandboxId: 1, authorizationCode: 1 });

export type VisitDoc = InferSchemaType<typeof visitSchema> & { _id: Types.ObjectId };
export const Visit = model("Visit", visitSchema);
