import { Schema, model, InferSchemaType } from "mongoose";

// A real agent run for one story button, played back when live AI is off or the daily budget is used up.
const savedRunSchema = new Schema(
  {
    storyKey: { type: String, required: true, unique: true },
    events: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);

export type SavedRunDoc = InferSchemaType<typeof savedRunSchema>;
export const SavedRun = model("SavedRun", savedRunSchema);
