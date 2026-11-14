# Scheduling Assistant — Design

*Date: 14 Nov 2026 · Owner: Deepak R · Status: draft for review*
*Working name: **ShiftPilot – Scheduling Assistant** (final name is open).*

---

## 1. Why this exists

Deepak wants a portfolio project that shows recruiters he is strong in **GenAI and agentic AI**, built on real domain knowledge most candidates don't have: US home care (HCBS) and Electronic Visit Verification (EVV). He designed and owned a production caregiver scheduling module at Navjoy (150–200 users), so he knows the real pain.

**The pain:** home care coordinators build schedules by hand, check who is free, fix double-bookings by hand, and keep every visit inside each client's Medicaid authorization (approved service, dates, units). When a caregiver calls in sick, this takes a lot of phone calls and spreadsheet work, and mistakes happen easily.

**The product:** a coordinator types a change in plain English. An AI agent finds what's affected, looks for caregivers who are free, qualified and close by, keeps every visit inside the authorization rules, and suggests an updated schedule with a reason for each change. The coordinator approves, edits or rejects each change. Nothing changes without approval, except small low-risk fixes that a written rule allows.

**The portfolio story:** this is Deepak's third project and it connects the other two:
- **AgentGuard** (live) is the safety layer. Applied changes go through it to get rules, an audit trail and one-click undo.
- **AgentReplay** (live, `@sritarak/agentreplay` on npm) records every agent run, so a bad run can be replayed and turned into a test.

The interview line: *"I built the agent, the safety layer, and the testing tool, and they work together."*

## 2. Goals, non-goals, anti-goals

**Goals (v1)**
1. Handle four kinds of request in plain English:
   - **Build a schedule from an authorization:** "Set up Asha's visits Mon/Wed/Fri mornings using her personal care authorization."
   - **Caregiver call-out:** "Priya is sick tomorrow, cover her visits."
   - **Client cancels or moves a visit:** "Mr. Rao cancelled Thursday; move it to Friday if possible."
   - **Add a visit:** "Add a 2-hour personal care visit for Asha next Tuesday afternoon."
2. Never suggest a change that breaks a rule (authorization, availability, skills, clashes, hours limits). The rules are checked by plain code, not by the AI.
3. Explain every suggested change in one readable line.
4. The coordinator approves, edits or rejects each change. Optionally, low-risk fixes are approved automatically by a readable rule.
5. A public live demo with ready-made buttons that walks through the whole story in under a minute and never breaks.
6. An automatic test set of about 30 scenarios that scores the agent.

**Non-goals (not in v1)**
- Real EVV clock-in/out, GPS, mobile app.
- Billing, claims, payroll.
- Real driving routes or maps APIs. Distance is straight-line km.
- Optimizing a whole month at once ("best possible schedule"). The agent fixes what's asked.
- Real customer accounts, sign-up or multiple agencies. Demo accounts only.
- Free-form questions like "who's free Friday?" (possible v2).

**Anti-goals (would make this a failure even if it works)**
- The AI decides whether a rule is broken. The code always has the final say.
- The live demo breaks, hangs or runs up a big AI bill while a recruiter is watching.
- Any employer code, data, screenshots or real client or caregiver names. Everything is fake. Only public Colorado rules are used.
- It looks like a chatbot toy rather than a real coordinator tool.

## 3. Constraints

- **Stack:** MERN with TypeScript throughout, Tailwind. Match Deepak's AgentGuard structure and style (see §9).
- **Data:** 100% generated fake data. Fake Colorado-style towns and addresses. Fake service codes (e.g. `PC-15` = personal care, 15-minute units). Rules are modeled on public Colorado HCPF EVV material only.
- **Hosting:** free tier, same as his other projects (Render + MongoDB Atlas M0), at `shiftpilot.sritaraksolutions.in` *(my call)*.
- **Cost:** AI spend must have a hard daily cap.
- **Time:** about 2–3 weeks with AI-assisted building in cloud sessions (as with AgentReplay), with Deepak reviewing each stage. About 5 weeks if written mostly by hand, part-time.

## 4. Approaches considered

**How v1's scope was chosen.** Sick calls only (fast, but looks like one fixed script) vs. **three kinds of change sharing one toolset (picked)** vs. any change plus free questions (impressive but hard to make reliable). Deepak then added **build-from-authorization** as a fourth kind, because he built this for real and it gives the demo a start-to-finish story.

**How recruiters see it.** Public free-typing demo (convincing but risky and costly) vs. **live demo with ready-made buttons plus limited typing, plus a 2-minute video and a strong README (picked)** vs. video and README only (cheap but not believable).

**How the agent is built.**
- **A. Own agent loop in TypeScript on the Vercel AI SDK (picked).** Simple, easy to debug, switch models in one line, streams each step to React. Connects to AgentGuard (apply, audit, undo), AgentReplay (recording) and exposes its tools over MCP.
- B. LangGraph.js. A strong job-post keyword, but more layers, and its pause-for-approval repeats what AgentGuard already does.
- C. Raw model API with no SDK. Most control, but it rebuilds streaming and model switching for no recruiter benefit.

## 5. How it works

### 5.1 The big picture

```
Coordinator (React)
   │ types request / clicks demo button
   ▼
ShiftPilot API (Express)
   ├─ Agent loop (Vercel AI SDK) ── uses tools ──► Scheduling tools (plain code)
   │        │                                        ├─ Rule checker   (final say)
   │        │                                        └─ Schedule builder (unit math)
   │        └─ every step recorded ──► AgentReplay (background, never blocks)
   ├─ Proposal saved → Review screen (approve / edit / reject per change)
   └─ Apply approved changes ──► AgentGuard (rules, audit trail, undo)
                                    └─ calls back ShiftPilot to run / undo the change
MCP server: the same scheduling tools, usable from Claude or any MCP client
```

### 5.2 Data model (MongoDB)

All records carry `sandboxId` (one per demo visitor, see §6).

| Model | Key fields |
|---|---|
| `Service` | `code`, `name`, `unitMinutes` (e.g. 15), `requiredSkill` |
| `Caregiver` | `name`, `skills[]`, `homeLocation {lat,lng}`, `weeklyAvailability[] {day, start, end}`, `timeOff[] {start, end, reason}`, `maxHoursPerWeek` |
| `Client` | `name`, `location {lat,lng}`, `preferredCaregiverIds[]` |
| `Authorization` | `clientId`, `serviceCode`, `startDate`, `endDate`, `totalUnits`, `maxUnitsPerVisit?`, `maxUnitsPerWeek?` |
| `Visit` | `clientId`, `caregiverId` (nullable = uncovered), `authorizationId`, `start`, `end`, `units`, `status` (`scheduled` / `cancelled` / `completed`), `version` |
| `ChangeRequest` | `text`, `detectedType`, `createdBy`, `status`, `agentRunId` |
| `Proposal` | `requestId`, `changes[]`, `status`, `summary` |
| `ProposedChange` (embedded) | `kind` (`assign` / `move` / `cancel` / `create`), `visitId?`, `before`, `after`, `reasons[]`, `ruleResults[]`, `unitsLeftBefore/After`, `lowRisk`, `decision` (`pending` / `approved` / `edited` / `rejected` / `auto_approved`), `agentGuardActionId?` |

`units` are always derived from duration: `minutes / unitMinutes`. Visit length must be a whole number of units *(my call)*.

### 5.3 The rule checker (plain code, final say)

One pure module, `ruleChecker.ts`, with no database inside. It takes a proposed change plus the facts and returns pass/fail per rule with a plain-English message. It is used in three places: inside the agent's tools, when a proposal is saved, and again at apply time (the data may have changed in between).

Rules:
1. **Authorized service:** the visit's service is on an active authorization for this client.
2. **Inside dates:** visit date is between the authorization's start and end.
3. **Units left:** the visit's units ≤ units remaining (total − scheduled − completed, excluding cancelled).
4. **Per-visit limit:** units ≤ `maxUnitsPerVisit` when set.
5. **Per-week limit:** units that week ≤ `maxUnitsPerWeek` when set (week = Mon–Sun) *(my call)*.
6. **Caregiver available:** inside weekly availability, not on time off.
7. **Caregiver qualified:** has the service's required skill.
8. **No clash:** no overlapping visit for the caregiver or the client.
9. **Hours limit:** caregiver's weekly hours ≤ `maxHoursPerWeek`.
10. **Travel buffer:** at least 15 minutes between a caregiver's back-to-back visits at different clients *(my call)*.

### 5.4 The schedule builder (plain code)

Input: `authorizationId`, chosen weekdays, a time window (e.g. 9:00–12:00), optional visit length. Output: a list of visits.
- Covers the **whole authorization period**, from the later of today or the start date to the end date (as Deepak's Navjoy module did).
- Existing visits on the authorization are **kept** and their units counted; only the remaining units are spread *(my call)*.
- Spread the total units evenly over the chosen days between start and end date, never above the per-visit or per-week limits.
- Leftover units go one at a time to the earliest visits, still inside limits.
- Units that cannot fit are reported clearly ("12 units could not be scheduled: weekly limit reached").
- Caregiver assignment is a separate step (the candidate finder, below), so a built schedule can come back partly uncovered, and that's shown honestly.

### 5.5 Candidate finder (plain code)

For one visit, return caregivers who pass every rule, ranked by a simple score *(my call)*: has seen this client before (+), distance in km (−), hours left this week (+). Each candidate comes with its facts ("free 9–11, has skill, 3.2 km, saw this client 4 times"). The AI picks among these and can weigh trade-offs across several visits (e.g. not giving one caregiver all of Priya's visits), but can never add a caregiver who isn't on the list.

### 5.6 The agent

- **Loop:** Vercel AI SDK tool-calling with streaming. Maximum 15 tool calls per request *(my call)*. Each step streams to the screen ("Finding Priya's visits tomorrow… 4 found").
- **Tools the AI can use (read and propose only, never write):**
  - `find_visits({ caregiver?, client?, from, to })`
  - `get_authorization({ client, service? })`: balance and limits
  - `find_candidates({ visitId })`
  - `check_change({ change })`: runs the rule checker
  - `build_schedule({ authorizationId, days, timeWindow })`
  - `submit_proposal({ changes[], summary })`: saves the proposal; refused if any change fails a rule, and the AI sees why
- **Names to records:** tools accept names ("Priya") and resolve them. If a name matches more than one person, the tool returns the choices and the agent asks the coordinator.
- **Model:** a small, cheap tool-calling model (Claude Haiku-class or GPT mini-class). Final pick by eval score and cost in week 2.
- **If the AI fails** (timeout, bad output, step limit): show "I couldn't finish this. Here is what I found so far" and save nothing.

### 5.7 Review and apply

**Review screen** (in ShiftPilot): changes grouped by day (or by week for a built schedule), one card per change showing before → after, the reason, the rule results, and units before → after. Buttons: Approve, Edit, Reject, plus Approve all. *Edit* lets the coordinator pick a different caregiver from the candidate list or change the time, and the rule checker runs again immediately.

**Apply** (approved changes only): the ShiftPilot server sends the approved changes of one proposal to AgentGuard as **one** action, `schedule.applyPlan` (`params: { proposalId }`, `onBehalfOf` = coordinator, `idempotencyKey` = proposal id + attempt). One action per plan keeps calls low (AgentGuard limits agents to 120 requests/min) and makes Undo cover the whole plan. AgentGuard:
- looks up trusted facts from ShiftPilot (`prepare`): number of **existing** visits changed, number of new visits, any caregiver removed from a visit;
- checks its rules. Demo rule: a plan that changes **more than 10 existing visits** needs a manager's approval (separation of duties: not the coordinator). New visits built from an authorization do not count, so story 1 is not stopped *(my call)*;
- records it in the hash-chained audit trail;
- runs it by calling back ShiftPilot's internal endpoint, which re-checks every rule and saves the visits in one transaction (using `version` to refuse if any visit changed);
- offers **Undo** for the whole plan, which calls ShiftPilot to put every visit back, refusing if any changed since.

**Where Undo and manager sign-off happen: in AgentGuard (Deepak's decision).** ShiftPilot does its own Approve / Edit / Reject before anything is applied. After apply, each plan in ShiftPilot shows its status from AgentGuard (`done`, `pending_approval`, `denied`, `undone`) and a link:
- "Undo in AgentGuard" or "Waiting for a manager in AgentGuard" → opens `<agentguard>/activity?action=<id>`.
- AgentGuard's existing one-click demo sign-in handles login, and its existing deep link opens that exact action.
- No new AgentGuard approval or undo endpoints. The recruiter clicks between the two products, which shows the connection.
- ShiftPilot reads the status with the agent key (`GET /api/agent/actions/:id`), which already exists.

**Auto-approve low-risk:** **code** (not the AI) marks a change `lowRisk` only if it moves a visit by ≤ 15 minutes with the same caregiver and the same units *(my call)*. Low-risk changes skip the review card and are applied as their own small plan, where an AgentGuard rule allows them. They show as "auto-approved", with the same "Undo in AgentGuard" link.

**AgentGuard work needed** (in the agentguard repo, about 3–4 days):
- A new demo workspace, **"Sunrise Home Care (demo)"**, currency USD, with a coordinator, a manager, an admin and a ShiftPilot agent key. It is kept apart from Acme/Globex, and their demo reset does not touch it *(my call)*.
- A new `schedule.applyPlan` action, written like the GitHub sandbox adapter: server-owned ShiftPilot base URL and shared secret, strict params (`proposalId` only), `prepare` / `run` / `undo` call ShiftPilot's internal endpoints. Unlike the GitHub adapter, it is allowed on the demo, but only for the Sunrise workspace.
- ShiftPilot sandboxes all share the Sunrise workspace. Each action's summary names the sandbox's visitor label, so a recruiter can find theirs. Undo is safe across visitors because each plan only touches its own sandbox's visits *(my call)*.

**If AgentGuard is unreachable** *(my call)*: apply fails clearly ("Safety layer is waking up, try again in a minute"), nothing is saved, and ShiftPilot pings AgentGuard on page load to wake it (Render free tier sleeps).

### 5.8 AgentReplay recording

Every agent run is one AgentReplay run named after the request: the LLM calls as `llm` steps, each tool call as a `tool` step, and the applied changes linked with `externalRef { system: "agentguard", id, url }`. Recording is in the background and never blocks (the SDK already guarantees this). It is off without `AGENTREPLAY_API_KEY`.

### 5.9 MCP server

`POST /api/mcp` exposes the same read and propose tools (not apply). This lets Deepak show Claude Desktop or Claude Code using ShiftPilot. It uses the same pattern and SDK as AgentGuard's MCP server.

## 6. The public demo

- **Sign-in:** one-click demo coordinator (like AgentGuard).
- **Own copy of the data:** each visitor gets a fresh sandbox (a copy of the seed agency) on first visit. Sandboxes are deleted after 24 hours. Nobody sees anyone else's changes.
- **Story buttons, in order:**
  1. "Build Asha's schedule from her authorization"
  2. "Priya is sick tomorrow, cover her visits"
  3. "Mr. Rao cancelled Thursday, move it to Friday"
  4. "Add a 2-hour visit for Asha next Tuesday"
  
  Each button shows the agent working live, then the review screen.
- **Free typing:** allowed, up to 10 agent requests per visitor per day *(my call)*.
- **Cost guard:** a global daily AI spend cap (about US$1/day, set by env) *(my call)*. When the cap is hit, the story buttons **play back a saved real run**, view-only, labelled "Recorded run, live AI resumes tomorrow", with a link to the video for the Approve/Undo ending. Nothing is applied from a playback *(my call)*.
- **Dates:** the seed generator builds visits relative to today, so "tomorrow" always has visits. Time zone: America/Denver *(my call)*.
- **Reset** button: fresh sandbox.

**Demo data size** *(my call)*: 1 fake Colorado agency, ~25 caregivers, ~40 clients, ~60 authorizations, ~6 months of visits (~2,500). A deterministic seed generator (same seed = same data) makes evals repeatable.

## 7. Quality: tests and evals

- **Unit tests (Jest):** rule checker (every rule, edge cases like visits across midnight or week boundaries, the last unit), schedule builder (even spread, leftovers, limits, unfittable units), candidate ranking.
- **API tests (Supertest + in-memory MongoDB):** proposal refusal on rule break, edit re-check, apply idempotency, stale-version refusal, sandbox isolation, rate limits. The AI is mocked here.
- **Evals (real model, run by hand and before releases, not in CI):** ~30 fixed scenarios on the seed data, each with checks such as "no rule broken", "all of Priya's visits covered or flagged", "asked when the name was ambiguous", "refused when units ran out". The output is a score table, shown in the README. Failed runs are opened in AgentReplay.

## 8. Presentation for recruiters

- **Live demo** at the subdomain, linked from his portfolio and sritaraksolutions.in.
- **2-minute video:** the four story steps, then "Undo in AgentGuard" (clicking across), then the run in AgentReplay.
- **README:** problem in 3 lines, demo link, GIF, architecture diagram, key decisions table ("why the code, not the AI, checks rules"), eval score table, how the three projects connect, how to run locally. Same style as AgentGuard's README.

## 9. Code structure (match AgentGuard)

Mirror `agentguard/`: `server/src/{api/routes.ts, controllers/, services/, models/, helpers/, middlewares/, loaders/, utils/, constants/}`, `client/src/{screens/<name>_screen/, components/, utils/{hooks, services, store, helper_functions}}`. React 18 + Vite + Tailwind + React Query + Zustand + axios. Zod for validation. Jest + Supertest + mongodb-memory-server. One Render service serving API and client.

New pieces: `services/scheduling/{ruleChecker, scheduleBuilder, candidateFinder}.ts`, `services/agent/{agentLoop, tools, prompts}.ts`, `services/integrations/{agentGuard, agentReplay}.ts`, `services/demo/{sandbox, costGuard, savedRuns}.ts`, `scripts/seed.ts`, `evals/`.

## 10. Rough build order (≈2–3 weeks)

Estimated with AI-assisted building; double it if written mostly by hand.

1. **Days 1–3:** models, seed generator, rule checker, schedule builder, candidate finder, with tests.
2. **Days 4–6:** agent tools and loop with streaming, model choice, first 10 evals.
3. **Days 7–9:** React screens: schedule view (week grid per caregiver), request box with live steps, review screen with edit.
4. **Days 10–13:** AgentGuard Sunrise workspace and `schedule.applyPlan` adapter, apply flow and status links, AgentReplay recording, MCP server.
5. **Days 14–17:** demo sandboxes, limits, cost guard and saved runs, deploy, 30 evals, README, video.

## 11. Left to the builder

Exact prompt wording, the exact model, the scoring weights in the candidate finder, UI layout details, the fake names and towns, how sandboxes are copied (bulk insert vs. copy-on-write), and the exact eval checks per scenario.
