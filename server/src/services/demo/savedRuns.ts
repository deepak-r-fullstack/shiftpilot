import { isTest } from "../../config/env";
import { SavedRun } from "../../models/savedRun.model";
import { AgentEvent, Emit } from "../agent/events";

// Real runs of the story buttons, recorded once with live AI. When live AI is off
// or today's budget is used up, the buttons play these back so the demo never
// shows an error. A playback is view-only: nothing is saved or applied.

export const PLAYBACK_DELAY_MS = isTest ? 0 : 450;

export async function saveRun(storyKey: string, events: AgentEvent[]) {
  await SavedRun.findOneAndUpdate({ storyKey }, { events }, { upsert: true });
}

export async function hasSavedRun(storyKey: string): Promise<boolean> {
  return Boolean(await SavedRun.exists({ storyKey }));
}

export async function playSavedRun(storyKey: string, reason: "budget" | "off", emit: Emit): Promise<boolean> {
  const saved = await SavedRun.findOne({ storyKey }).lean();
  if (!saved) return false;
  emit({
    type: "status",
    text: reason === "budget" ? "Recorded run, live AI resumes tomorrow" : "Recorded run (live AI is not switched on for this demo)",
  });
  for (const event of saved.events as AgentEvent[]) {
    if (PLAYBACK_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, PLAYBACK_DELAY_MS));
    if (event.type === "proposal") {
      emit({ type: "status", text: `The agent saved a plan with ${event.changes} changes. Approve and Undo are shown in the video.` });
    } else if (event.type !== "done") {
      emit(event);
    }
  }
  return true;
}
