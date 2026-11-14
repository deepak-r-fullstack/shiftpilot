import { Schema } from "mongoose";

// Shared sub-schemas. Every scheduling record belongs to one sandbox: the
// "template" agency, or one visitor's private copy of it. Records point at each
// other by their readable code ("CG-01", "AU-03", "V-1042"), which stays the same
// in every copy, so a sandbox is a plain copy with no id remapping.

export const TEMPLATE_SANDBOX = "template";

export const latLngSchema = new Schema({ lat: { type: Number, required: true }, lng: { type: Number, required: true } }, { _id: false });

export const sandboxField = { type: String, required: true, index: true } as const;
