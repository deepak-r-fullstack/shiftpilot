import { Schema, model, InferSchemaType, Types } from "mongoose";

// One demo visitor's private copy of the agency. Deleted automatically 24 hours
// after it was made (TTL index), so the free database never fills up.
const sandboxSchema = new Schema(
  {
    label: { type: String, required: true }, // e.g. "Visitor 4F2A", shown in AgentGuard
    expiresAt: { type: Date, required: true },
    requestsDay: { type: String, default: "" }, // Denver date the counter below belongs to
    requestsUsed: { type: Number, default: 0 },
    nextVisitNumber: { type: Number, required: true },
  },
  { timestamps: true }
);
sandboxSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SandboxDoc = InferSchemaType<typeof sandboxSchema> & { _id: Types.ObjectId };
export const Sandbox = model("Sandbox", sandboxSchema);
