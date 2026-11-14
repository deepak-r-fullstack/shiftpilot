import { Schema, model, InferSchemaType, Types } from "mongoose";
import { latLngSchema, sandboxField } from "./common";

// A person receiving care at home. All names and places are made up.
const clientSchema = new Schema({
  sandboxId: sandboxField,
  code: { type: String, required: true }, // "CL-01"
  name: { type: String, required: true },
  town: { type: String, default: "" },
  location: { type: latLngSchema, required: true },
  preferredCaregiverCodes: { type: [String], default: [] },
});
clientSchema.index({ sandboxId: 1, code: 1 }, { unique: true });

export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: Types.ObjectId };
export const Client = model("Client", clientSchema);
