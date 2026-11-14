// The four story buttons. Together they tell the whole demo story in under a minute:
// build a schedule, a caregiver calls in sick, a client moves a visit, a visit is added.
export const STORIES = [
  { key: "build-asha", title: "Build Asha's schedule", text: "Set up Asha Patel's visits Mon/Wed/Fri mornings 9 to 11 using her personal care authorization" },
  { key: "priya-sick", title: "Priya is sick", text: "Priya is sick tomorrow, cover her visits" },
  { key: "rao-move", title: "Mr. Rao moves a visit", text: "Mohan Rao cancelled Thursday, move it to Friday same time if possible" },
  { key: "asha-add", title: "Add a visit for Asha", text: "Add a 2-hour personal care visit for Asha next Tuesday afternoon" },
] as const;

export type StoryKey = (typeof STORIES)[number]["key"];

export function findStory(key: string) {
  return STORIES.find((story) => story.key === key) ?? null;
}
