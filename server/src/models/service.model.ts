import { Schema, model, InferSchemaType, Types } from "mongoose";
import { sandboxField } from "./common";

// A service a client can be authorized for, e.g. PC-15 personal care in 15-minute units. Codes are fake.
const serviceSchema = new Schema({
  sandboxId: sandboxField,
  code: { type: String, required: true },
  name: { type: String, required: true },
  unitMinutes: { type: Number, required: true },
  requiredSkill: { type: String, required: true },
});
serviceSchema.index({ sandboxId: 1, code: 1 }, { unique: true });

export type ServiceDoc = InferSchemaType<typeof serviceSchema> & { _id: Types.ObjectId };
export const Service = model("Service", serviceSchema);
