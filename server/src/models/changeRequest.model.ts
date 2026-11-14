import { Schema, model, InferSchemaType, Types } from "mongoose";
import { sandboxField } from "./common";

// What the coordinator typed (or which story button they pressed), and how it ended.
const changeRequestSchema = new Schema(
  {
    sandboxId: sandboxField,
    text: { type: String, required: true },
    storyKey: { type: String, default: null },
    createdBy: { type: String, required: true },
    status: { type: String, enum: ["running", "proposed", "asked", "failed"], default: "running" },
    // True when the scripted planner ran a story because live AI was off.
    scripted: { type: Boolean, default: false },
    proposalId: { type: Schema.Types.ObjectId, ref: "Proposal", default: null },
  },
  { timestamps: true }
);

export type ChangeRequestDoc = InferSchemaType<typeof changeRequestSchema> & { _id: Types.ObjectId };
export const ChangeRequest = model("ChangeRequest", changeRequestSchema);
