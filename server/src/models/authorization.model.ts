import { Schema, model, InferSchemaType, Types } from "mongoose";
import { sandboxField } from "./common";

// What a client is approved to receive: one service, a date range and a number of units.
const authorizationSchema = new Schema({
  sandboxId: sandboxField,
  code: { type: String, required: true }, // "AU-01"
  clientCode: { type: String, required: true },
  serviceCode: { type: String, required: true },
  startDate: { type: String, required: true }, // "YYYY-MM-DD" Denver, inclusive
  endDate: { type: String, required: true },
  totalUnits: { type: Number, required: true },
  maxUnitsPerVisit: { type: Number, default: null },
  maxUnitsPerWeek: { type: Number, default: null },
});
authorizationSchema.index({ sandboxId: 1, code: 1 }, { unique: true });
authorizationSchema.index({ sandboxId: 1, clientCode: 1 });

export type AuthorizationDoc = InferSchemaType<typeof authorizationSchema> & { _id: Types.ObjectId };
export const Authorization = model("Authorization", authorizationSchema);
