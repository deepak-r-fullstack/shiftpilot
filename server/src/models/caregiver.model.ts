import { Schema, model, InferSchemaType, Types } from "mongoose";
import { latLngSchema, sandboxField } from "./common";

const windowSchema = new Schema(
  {
    day: { type: String, enum: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], required: true },
    start: { type: String, required: true }, // "HH:mm" Denver
    end: { type: String, required: true },
  },
  { _id: false }
);

const timeOffSchema = new Schema(
  { start: { type: Date, required: true }, end: { type: Date, required: true }, reason: { type: String, default: "" } },
  { _id: false }
);

const caregiverSchema = new Schema({
  sandboxId: sandboxField,
  code: { type: String, required: true }, // "CG-01"
  name: { type: String, required: true },
  skills: { type: [String], default: [] },
  homeLocation: { type: latLngSchema, required: true },
  weeklyAvailability: { type: [windowSchema], default: [] },
  timeOff: { type: [timeOffSchema], default: [] },
  maxHoursPerWeek: { type: Number, required: true },
});
caregiverSchema.index({ sandboxId: 1, code: 1 }, { unique: true });

export type CaregiverDoc = InferSchemaType<typeof caregiverSchema> & { _id: Types.ObjectId };
export const Caregiver = model("Caregiver", caregiverSchema);
