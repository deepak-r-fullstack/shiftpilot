import { Check } from "./checks";

// 30 fixed requests on the same seeded agency ("today" is pinned), with what a good plan must do.
export interface Scenario {
  id: string;
  text: string;
  expect: Check[];
}

const coverPriya: Check[] = [
  { kind: "proposal" },
  { kind: "coversVisitsOf", caregiverCode: "CG-01", day: "tomorrow" },
  { kind: "noCaregiver", caregiverCode: "CG-01" },
  { kind: "allRulesPass" },
];

export const SCENARIOS: Scenario[] = [
  // Sick calls
  { id: "sick-01", text: "Priya is sick tomorrow, cover her visits", expect: coverPriya },
  { id: "sick-02", text: "Priya Nair called in sick for tomorrow. Please reassign her visits.", expect: coverPriya },
  { id: "sick-03", text: "Priya can't work tomorrow", expect: coverPriya },
  { id: "sick-04", text: "CG-01 is out tomorrow, cover her shifts", expect: coverPriya },
  { id: "sick-05", text: "Priya is sick tomorrow; keep clients with someone close by if possible", expect: coverPriya },
  {
    id: "sick-06",
    text: "Priya and Maria Lopez are both sick tomorrow",
    expect: [{ kind: "proposal" }, { kind: "coversVisitsOf", caregiverCode: "CG-01", day: "tomorrow" }, { kind: "coversVisitsOf", caregiverCode: "CG-07", day: "tomorrow" }, { kind: "allRulesPass" }],
  },
  { id: "sick-07", text: "Maria Lopez is off tomorrow, cover her visits", expect: [{ kind: "coversVisitsOf", caregiverCode: "CG-07", day: "tomorrow" }, { kind: "allRulesPass" }] },
  { id: "sick-08", text: "Priya is sick tomorrow morning only", expect: [{ kind: "proposal" }, { kind: "allRulesPass" }] },

  // Cancel or move
  { id: "move-01", text: "Mohan Rao cancelled Thursday, move it to Friday same time if possible", expect: [{ kind: "proposal" }, { kind: "maxChanges", n: 1 }, { kind: "allRulesPass" }] },
  { id: "move-02", text: "Cancel Mohan Rao's visit this Thursday", expect: [{ kind: "proposal" }, { kind: "maxChanges", n: 1 }] },
  { id: "move-03", text: "Mr. Rao wants Thursday's visit 15 minutes later", expect: [{ kind: "proposal" }, { kind: "maxChanges", n: 1 }, { kind: "allRulesPass" }] },
  { id: "move-04", text: "Move Mohan Rao's Thursday visit to Saturday at 10", expect: [{ kind: "allRulesPass" }] },
  { id: "move-05", text: "Eleanor Wright cancelled her visit tomorrow", expect: [{ kind: "proposal" }, { kind: "maxChanges", n: 1 }] },
  { id: "move-06", text: "Harold Jensen wants tomorrow's visit moved to 2pm", expect: [{ kind: "allRulesPass" }, { kind: "maxChanges", n: 1 }] },

  // Add a visit
  { id: "add-01", text: "Add a 2-hour personal care visit for Asha next Tuesday afternoon", expect: [{ kind: "proposal" }, { kind: "maxChanges", n: 1 }, { kind: "unitsWithinAuthorization", authorizationCode: "AU-01" }] },
  { id: "add-02", text: "Add a 1-hour personal care visit for Asha on Friday at 3pm", expect: [{ kind: "proposal" }, { kind: "allRulesPass" }] },
  { id: "add-03", text: "Ruth Bennett needs an extra 2-hour visit tomorrow", expect: [{ kind: "noProposal" }] },
  { id: "add-04", text: "Add a homemaker visit for Asha tomorrow", expect: [{ kind: "noProposal" }] },
  { id: "add-05", text: "Add a 30-minute visit for Mohan Rao on Wednesday at 9", expect: [{ kind: "proposal" }, { kind: "allRulesPass" }] },
  { id: "add-06", text: "Schedule a 2-hour visit for Eleanor Wright next Saturday afternoon", expect: [{ kind: "allRulesPass" }] },

  // Build from an authorization
  { id: "build-01", text: "Set up Asha Patel's visits Mon/Wed/Fri mornings 9 to 11 using her personal care authorization", expect: [{ kind: "proposal" }, { kind: "unitsWithinAuthorization", authorizationCode: "AU-01" }, { kind: "allRulesPass" }] },
  { id: "build-02", text: "Build Asha Patel's schedule: Tuesdays and Thursdays 1 to 4 pm", expect: [{ kind: "proposal" }, { kind: "unitsWithinAuthorization", authorizationCode: "AU-01" }] },
  { id: "build-03", text: "Set up Asha's personal care visits every weekday morning 8 to 10", expect: [{ kind: "proposal" }, { kind: "unitsWithinAuthorization", authorizationCode: "AU-01" }] },
  { id: "build-04", text: "Use Asha's authorization for 2-hour visits Monday, Wednesday, Friday at 9", expect: [{ kind: "proposal" }, { kind: "allRulesPass" }] },
  { id: "build-05", text: "Build a schedule for Asha on Saturdays only, 9 to 12", expect: [{ kind: "proposal" }, { kind: "unitsWithinAuthorization", authorizationCode: "AU-01" }] },
  { id: "build-06", text: "Set up Asha's visits Mon/Wed/Fri mornings with Priya if possible", expect: [{ kind: "proposal" }, { kind: "allRulesPass" }] },

  // Ambiguous, unknown or off-topic
  { id: "ask-01", text: "Maria is sick tomorrow", expect: [{ kind: "asked", mentions: ["Lopez", "Chen"] }, { kind: "noProposal" }] },
  { id: "ask-02", text: "Pria is sick tomorrow", expect: [{ kind: "noProposal" }] },
  { id: "ask-03", text: "Cover John Smith's visits tomorrow", expect: [{ kind: "noProposal" }] },
  { id: "ask-04", text: "What's the weather in Denver?", expect: [{ kind: "noProposal" }] },
];
