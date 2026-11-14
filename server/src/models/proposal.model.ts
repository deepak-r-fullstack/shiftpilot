import { Schema, model, InferSchemaType, Types } from "mongoose";
import { sandboxField } from "./common";

// A visit as it is (before) or would be (after) a change. Codes, not ids, so it reads well.
const visitSnapshotSchema = new Schema(
  {
    visitCode: { type: String, default: null }, // null for a visit that does not exist yet
    clientCode: { type: String, required: true },
    caregiverCode: { type: String, default: null },
    authorizationCode: { type: String, required: true },
    serviceCode: { type: String, required: true },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    units: { type: Number, required: true },
    status: { type: String, enum: ["scheduled", "cancelled", "completed"], required: true },
    version: { type: Number, default: null },
  },
  { _id: false }
);

const ruleResultSchema = new Schema({ rule: String, passed: Boolean, message: String }, { _id: false });

const proposedChangeSchema = new Schema({
  kind: { type: String, enum: ["assign", "move", "cancel", "create"], required: true },
  before: { type: visitSnapshotSchema, default: null },
  after: { type: visitSnapshotSchema, default: null },
  reasons: { type: [String], default: [] },
  ruleResults: { type: [ruleResultSchema], default: [] },
  unitsLeftBefore: { type: Number, default: null },
  unitsLeftAfter: { type: Number, default: null },
  lowRisk: { type: Boolean, default: false },
  decision: { type: String, enum: ["pending", "approved", "edited", "rejected", "auto_approved"], default: "pending" },
});

const proposalSchema = new Schema(
  {
    sandboxId: sandboxField,
    requestId: { type: Schema.Types.ObjectId, ref: "ChangeRequest", default: null },
    summary: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "applying", "applied", "pending_approval", "denied", "undone", "failed"],
      default: "draft",
    },
    changes: { type: [proposedChangeSchema], default: [] },
    applyAttempt: { type: Number, default: 0 },
    guardActionId: { type: String, default: null },
    guardStatus: { type: String, default: null },
    guardMessage: { type: String, default: null },
  },
  { timestamps: true }
);

export type VisitSnapshot = InferSchemaType<typeof visitSnapshotSchema>;
export type ProposedChangeDoc = InferSchemaType<typeof proposedChangeSchema> & { _id: Types.ObjectId };
export type ProposalDoc = InferSchemaType<typeof proposalSchema> & { _id: Types.ObjectId; createdAt: Date };
export const Proposal = model("Proposal", proposalSchema);
