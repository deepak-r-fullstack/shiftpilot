import { Schema, model, InferSchemaType, Types } from "mongoose";
import { sandboxField } from "./common";

// What a plan changed, so it can be undone exactly once and only if nothing changed since.
const beforeVisitSchema = new Schema(
  {
    visitCode: { type: String, required: true },
    existed: { type: Boolean, required: true }, // false = the plan created it; undo deletes it
    caregiverCode: { type: String, default: null },
    start: { type: Date, default: null },
    end: { type: Date, default: null },
    units: { type: Number, default: null },
    status: { type: String, default: null },
  },
  { _id: false }
);

const appliedPlanSchema = new Schema(
  {
    proposalId: { type: Schema.Types.ObjectId, required: true, unique: true },
    sandboxId: sandboxField,
    beforeVisits: { type: [beforeVisitSchema], default: [] },
    afterVersions: { type: [{ visitCode: String, version: Number, _id: false }], default: [] },
    applied: { type: Number, required: true },
    undoneAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export type AppliedPlanDoc = InferSchemaType<typeof appliedPlanSchema> & { _id: Types.ObjectId };
export const AppliedPlan = model("AppliedPlan", appliedPlanSchema);
