import { Schema, model, InferSchemaType } from "mongoose";

// Remembers which day the template agency was generated for. Visits are placed
// relative to "today", so a template from yesterday is rebuilt before it is copied.
const templateStateSchema = new Schema({
  key: { type: String, required: true, unique: true, default: "template" },
  seededFor: { type: String, required: true }, // Denver date
  nextVisitNumber: { type: Number, required: true },
});

export type TemplateStateDoc = InferSchemaType<typeof templateStateSchema>;
export const TemplateState = model("TemplateState", templateStateSchema);
