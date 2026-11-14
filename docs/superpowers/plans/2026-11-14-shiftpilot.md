# ShiftPilot – Scheduling Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build ShiftPilot, a MERN + TypeScript app where an AI agent turns a coordinator's plain-English scheduling request into a rule-checked proposal that the coordinator reviews, and that is applied (and undone) through AgentGuard and recorded in AgentReplay.

**Architecture:** One Express + Mongoose server with pure scheduling modules (rule checker, schedule builder, candidate finder) that have the final say on rules. A Vercel AI SDK tool-calling loop can only read and propose, and it streams steps to a React client over Server-Sent Events. Approved plans go to AgentGuard as one `schedule.applyPlan` action, and AgentGuard calls back ShiftPilot's internal endpoints to run or undo.

**Tech Stack:** Node 22, TypeScript, Express 4, Mongoose 8, Zod 3, Luxon, Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), `@modelcontextprotocol/sdk`, `@sritarak/agentreplay`; React 18, Vite, Tailwind 3, React Query 5, Zustand, axios, lucide-react; Jest + Supertest + mongodb-memory-server (replica set).

**Spec:** `docs/superpowers/specs/2026-11-14-scheduling-assistant-design.md`

## Global Constraints

- 100% fake data. No employer code, data or real names. Service codes are fake (e.g. `PC-15`).
- Rules are decided by plain code (`ruleChecker.ts`). The AI never writes data and never decides whether a rule passed.
- Business time zone: `America/Denver`. All wall-clock logic (days, weeks Mon–Sun, availability windows) uses Luxon in that zone.
- Units: `units = minutes / unitMinutes`. Visit length must be a whole number of units.
- Travel buffer: 15 minutes between a caregiver's back-to-back visits at different clients.
- Low-risk change (decided in code): a move of ≤ 15 minutes, same caregiver, same units.
- Manager approval demo rule (in AgentGuard): `facts.existingVisitsChanged > 10` → `require_approval`; new visits do not count.
- Agent: max 15 tool calls per request. Free typing: 10 agent requests per sandbox per day. Global AI spend cap: env `AI_DAILY_USD_CAP`, default `1`.
- Sandboxes expire after 24 hours (TTL index).
- Demo data: 1 agency, ~25 caregivers, ~40 clients, ~60 authorizations, ~6 months of visits (~2,500), built relative to today by a seeded generator (same seed + same "today" = same data).
- Code structure and style mirror `deepak-r-fullstack/agentguard`: `server/src/{api/routes.ts, controllers/, services/, models/, helpers/, middlewares/, loaders/, utils/, constants/, config/env.ts}`, the `{ success, message, data }` response helpers, `asyncHandler`, typed errors in `helpers/errors.ts`, Zod `validateRequest`; client `src/{screens/<name>_screen/index.tsx, components/, utils/{hooks, services/api_services, store, helper_functions}}`. Short "why" comments at the top of each file, as in AgentGuard.
- Hosting: one Render web service (API + built client), MongoDB Atlas M0, `https://shiftpilot.sritaraksolutions.in`.
- Every integration (AgentGuard, AgentReplay, AI provider) is optional by env. Without it, the app still runs and says plainly what is off.

## Review Focus

1. **Daylight-saving change in Denver** (e.g. 1 Nov 2026, 8 Mar 2027) inside an authorization or a week: units and availability use wall-clock minutes, so a 9:00–11:00 visit is still 8 units. → Task 2 and Task 4 tests.
2. **Ambiguous or misspelled names** ("Priya" matching two caregivers, "Pria"): tools return choices or "not found", the agent asks the coordinator, and no proposal is saved. → Task 9 tests.
3. **Two changes in the same proposal clash with each other** (the agent or an edit gives one caregiver two overlapping visits): the checker includes the proposal's other approved or pending changes. → Task 8 tests.
4. **Data changes between proposal and apply** (another tab applied a plan that touched the same visits): `run` refuses the whole plan with a clear message and writes nothing. → Task 11 tests.
5. **Double-clicking Apply, or two tabs applying:** exactly one AgentGuard action and one write. → Task 11 tests.

---

## Part A: ShiftPilot (`deepak-r-fullstack/shiftpilot`)

### Task 1: Project skeleton, health route, test database

**Files:**
- Create: `package.json` (workspaces `server`, `client`; scripts `dev`, `test`, `typecheck`, `build`, `seed`, `evals`, `check:browser`), `.gitignore`, `render.yaml`
- Create: `server/package.json`, `server/tsconfig.json`, `server/tsconfig.build.json`, `server/jest.config.js`, `server/env/local.env.example`
- Create: `server/src/{server.ts, app.ts, config/env.ts, api/routes.ts, loaders/database.ts, helpers/{response.ts, asyncHandler.ts, errors.ts}, middlewares/{errorHandler.middleware.ts, validateRequest.middleware.ts}, utils/logger.ts}`
- Create: `server/tests/{setupEnv.ts, helpers/testDb.ts, health.test.ts}`
- Create: `client/` Vite + React + Tailwind scaffold (`package.json`, `vite.config.ts` proxying `/api` to `:5070`, `tailwind.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`)

**Interfaces:**
- Produces: `createApp(): Express`; `env` (Zod-parsed) with `PORT=5070`, `MONGO_URI`, `CLIENT_ORIGIN`, `JWT_SECRET`, `DEMO_MODE`, `LLM_PROVIDER ('anthropic'|'openai'|'none')`, `LLM_API_KEY`, `LLM_MODEL`, `AI_DAILY_USD_CAP`, `AGENTGUARD_URL`, `AGENTGUARD_PUBLIC_URL`, `SHIFTPILOT_AGENT_KEY`, `SHIFTPILOT_INTERNAL_SECRET`, `AGENTREPLAY_API_KEY`, `AGENTREPLAY_URL`; `startTestDb()` and `stopTestDb()` using `MongoMemoryReplSet` (transactions need a replica set), honouring `TEST_MONGO_URI`.
- Copy `response.ts`, `asyncHandler.ts`, `errors.ts`, `validateRequest.middleware.ts` and `errorHandler.middleware.ts` patterns from AgentGuard.

- [ ] **Step 1:** Write `health.test.ts`: `GET /api/health` → 200, `{ success: true, data: { status: "ok" } }`.
- [ ] **Step 2:** Run `npm test -w server`. Expected: FAIL (no app).
- [ ] **Step 3:** Implement the skeleton files above. Production serves `client/dist` and falls back to `index.html` for non-`/api` paths.
- [ ] **Step 4:** Run `npm test -w server && npm run typecheck && npm run build`. Expected: PASS, both builds succeed.
- [ ] **Step 5:** Commit `chore: project skeleton with health check`.

### Task 2: Time, distance and scheduling types

**Files:**
- Create: `server/src/services/scheduling/types.ts`, `server/src/utils/time.ts`, `server/src/utils/geo.ts`
- Test: `server/tests/time.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  export interface LatLng { lat: number; lng: number }
  export interface WeeklyWindow { day: Weekday; start: string; end: string } // "HH:mm" Denver wall clock
  export interface ServiceFacts { code: string; name: string; unitMinutes: number; requiredSkill: string }
  export interface AuthorizationFacts { id: string; clientId: string; serviceCode: string; startDate: string; endDate: string; totalUnits: number; maxUnitsPerVisit?: number; maxUnitsPerWeek?: number } // dates "YYYY-MM-DD", inclusive
  export interface CaregiverFacts { id: string; name: string; skills: string[]; homeLocation: LatLng; weeklyAvailability: WeeklyWindow[]; timeOff: { start: Date; end: Date }[]; maxHoursPerWeek: number }
  export interface ClientFacts { id: string; name: string; location: LatLng; preferredCaregiverIds: string[] }
  export type VisitStatus = "scheduled" | "cancelled" | "completed";
  export interface VisitFacts { id: string; clientId: string; caregiverId: string | null; authorizationId: string; serviceCode: string; start: Date; end: Date; units: number; status: VisitStatus }
  export type RuleId = "whole_units" | "authorized_service" | "inside_dates" | "units_left" | "per_visit_limit" | "per_week_limit" | "caregiver_available" | "caregiver_qualified" | "no_clash" | "hours_limit" | "travel_buffer";
  export interface RuleResult { rule: RuleId; passed: boolean; message: string }
  ```
- Produces (time.ts): `ZONE = "America/Denver"`; `wallMinutes(start: Date, end: Date): number` (wall-clock minutes in ZONE); `weekKey(d: Date): string` (ISO week of the Denver date, Monday start, e.g. `"2026-W46"`); `denverDate(d: Date): string` (`YYYY-MM-DD`); `weekdayOf(d: Date): Weekday`; `atDenver(date: string, hhmm: string): Date`; `isInsideWindow(start: Date, end: Date, w: WeeklyWindow): boolean`.
- Produces (geo.ts): `haversineKm(a: LatLng, b: LatLng): number` (rounded to 0.1).

- [ ] **Step 1:** Write tests:
  - `wallMinutes(atDenver("2026-11-01","00:30"), atDenver("2026-11-01","03:30"))` → `180` (wall clock, across the DST change)
  - `weekKey(atDenver("2026-11-16","10:00")) === weekKey(atDenver("2026-11-22","23:00"))`, and `!== weekKey(atDenver("2026-11-23","00:30"))`
  - `weekdayOf(atDenver("2026-11-16","09:00")) === "mon"`
  - `haversineKm({lat:39.7392,lng:-104.9903},{lat:39.7294,lng:-105.0839})` ≈ `8.1` (±0.2)
- [ ] **Step 2:** Run `npx jest tests/time.test.ts` in `server/`. Expected: FAIL.
- [ ] **Step 3:** Implement with Luxon (`DateTime.fromJSDate(d, { zone: ZONE })`).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat: Denver time, distance and scheduling types`.

### Task 3: Rule checker (pure, final say)

**Files:**
- Create: `server/src/services/scheduling/ruleChecker.ts`
- Test: `server/tests/ruleChecker.test.ts`

**Interfaces:**
- Consumes: Task 2 types and time utils.
- Produces:
  ```ts
  export interface RuleContext {
    visit: VisitFacts;                    // the visit as it would be after the change
    service: ServiceFacts;
    authorization: AuthorizationFacts | null; // null = no active authorization for this client and service
    caregiver: CaregiverFacts | null;     // null = uncovered (caregiver rules skipped)
    clientLocation: LatLng;
    otherVisits: (VisitFacts & { clientLocation: LatLng })[]; // all non-cancelled visits that may matter (same caregiver that week, same client that day, same authorization), EXCLUDING the visit itself; includes the proposal's other pending/approved changes
  }
  export function checkVisit(ctx: RuleContext): RuleResult[]; // one result per rule, in RuleId order; caregiver rules omitted when caregiver is null
  export function allPassed(results: RuleResult[]): boolean;
  ```
- Rule behaviour (messages are plain English and name the numbers):
  - `whole_units`: `wallMinutes % unitMinutes === 0` and `units === wallMinutes / unitMinutes`.
  - `authorized_service`: authorization not null, `serviceCode` matches, `authorizationId` matches.
  - `inside_dates`: `denverDate(start)` and `denverDate(end - 1ms)` within `[startDate, endDate]`.
  - `units_left`: `sum(otherVisits on same authorization).units + visit.units <= totalUnits`. Message example: `"Only 4 units left on this authorization; this visit needs 8."`
  - `per_visit_limit`, `per_week_limit` (same authorization, same `weekKey`).
  - `caregiver_available`: inside some `weeklyAvailability` window for that weekday, and not overlapping any `timeOff`.
  - `caregiver_qualified`: `skills.includes(service.requiredSkill)`.
  - `no_clash`: no overlap with the caregiver's or the client's other visits.
  - `hours_limit`: caregiver's minutes that `weekKey` + this visit ≤ `maxHoursPerWeek * 60`.
  - `travel_buffer`: for caregiver visits at a different client on the same day, the gap between them ≥ 15 minutes.

- [ ] **Step 1:** Write one passing-case test and one failing-case test per rule (22 tests), using a small fixture builder `makeCtx(overrides)` in the test file. Include these edge cases: the last unit exactly fits (`passed: true`); a 2-hour visit with 4 units left (`passed: false`, message contains `"4"` and `"8"`); a visit on the authorization's end date passes, and the day after fails; a back-to-back visit with a 10-minute gap at another client fails `travel_buffer`, but at the same client it passes; a 09:00–11:00 visit on 2026-11-01 (DST day) has 8 units and passes `whole_units`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement as pure functions (no Mongoose import).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: rule checker`.

### Task 4: Schedule builder (pure)

**Files:**
- Create: `server/src/services/scheduling/scheduleBuilder.ts`
- Test: `server/tests/scheduleBuilder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface BuildScheduleInput { authorization: AuthorizationFacts; service: ServiceFacts; days: Weekday[]; window: { start: string; end: string }; visitMinutes?: number; today: string; existingVisits: VisitFacts[] }
  export interface PlannedVisit { start: Date; end: Date; units: number }
  export interface BuildScheduleResult { visits: PlannedVisit[]; unitsAvailable: number; unitsScheduled: number; unscheduledUnits: number; unscheduledReason: string | null }
  export function buildSchedule(input: BuildScheduleInput): BuildScheduleResult;
  ```
- Algorithm (not determined by the signature):
  1. `unitsAvailable = totalUnits − Σ units of existing non-cancelled visits`.
  2. Slots = each date in `[max(today+1, startDate), endDate]` whose weekday is in `days` and that has no existing visit for this client and authorization. Each slot starts at `window.start`.
  3. Slot cap = `min(maxUnitsPerVisit ?? ∞, floor(windowMinutes / unitMinutes))`. Week cap = `maxUnitsPerWeek − units already in that week` (∞ if unset).
  4. If `visitMinutes` is set: `size = visitMinutes / unitMinutes` (reject non-whole with a `BadRequestError`). `k = min(floor(unitsAvailable / size), slots that fit size)`. Choose `k` evenly spaced slots (index `floor(i * n / k)`), skipping slots whose week cap is full.
  5. Otherwise: give each slot `floor(unitsAvailable / n)` capped by slot and week caps. Then hand out the remaining units one at a time, earliest slot first, in repeated passes, while any cap has room. Drop slots that end with 0 units.
  6. `unscheduledReason`: `"weekly limit reached"`, `"per-visit limit reached"`, `"time window too short"` or `"no matching days left"`, whichever bound the last unit that could not be placed.

- [ ] **Step 1:** Write tests:
  - 400 units, 15-min units, Mon/Wed/Fri, window 09:00–13:00, 2027-01-04..2027-06-25, no limits, today 2027-01-01 → `unitsScheduled === 400`; every visit's units in `{5,6}`; all visits with 6 units come before all visits with 5 units.
  - Same, with `maxUnitsPerWeek: 12` → no week over 12; `unscheduledUnits > 0`; `unscheduledReason === "weekly limit reached"`.
  - `maxUnitsPerVisit: 8` and window 09:00–10:00 → every visit has ≤ 4 units.
  - Existing visits using 100 units → `unitsAvailable === 300`, and no planned visit on a date that already has one.
  - `visitMinutes: 120` → every visit has 8 units and the number of visits is `floor(unitsAvailable / 8)`.
  - Authorization spanning 2027-03-14 (DST): every visit's `wallMinutes(start, end) === units * 15`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: schedule builder from authorization`.

### Task 5: Candidate finder and low-risk check (pure)

**Files:**
- Create: `server/src/services/scheduling/candidateFinder.ts`, `server/src/services/scheduling/lowRisk.ts`
- Test: `server/tests/candidateFinder.test.ts`

**Interfaces:**
- Consumes: `checkVisit`, `RuleContext`, `haversineKm`.
- Produces:
  ```ts
  export interface Candidate { caregiverId: string; name: string; distanceKm: number; visitsWithClient: number; hoursLeftThisWeek: number; score: number; facts: string }
  export function findCandidates(input: { visit: VisitFacts; caregivers: CaregiverFacts[]; contextFor: (caregiver: CaregiverFacts) => RuleContext; visitsWithClient: (caregiverId: string) => number; limit?: number /*default 5*/ }): Candidate[];
  export function isLowRisk(before: VisitFacts, after: VisitFacts): boolean;
  ```
- Only caregivers whose `checkVisit` passes every rule are returned, sorted by `score` descending. The weights are the builder's choice, but the order must be: has seen the client > nearer > more hours left. Example `facts`: `"free 9:00–11:00, has PC skill, 3.2 km, 4 past visits with this client"`.
- `isLowRisk`: same `caregiverId`, same `units`, and `|start shift| ≤ 15 min`.

- [ ] **Step 1:** Write tests: an unqualified caregiver and one on time off are excluded; of two qualified caregivers, the one who saw the client 3 times ranks above a nearer stranger; `limit` is respected; `isLowRisk` is true for a 15-min shift, false for 16 min, false for a caregiver change, false for a units change.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: candidate finder and low-risk check`.

### Task 6: Models, seed generator and sandboxes

**Files:**
- Create: `server/src/models/{sandbox.model.ts, service.model.ts, caregiver.model.ts, client.model.ts, authorization.model.ts, visit.model.ts, changeRequest.model.ts, proposal.model.ts, appliedPlan.model.ts, costLedger.model.ts, savedRun.model.ts}`
- Create: `server/src/services/demo/{seedData.ts, sandbox.service.ts}`, `server/src/scripts/seed.ts`
- Test: `server/tests/seed.test.ts`

**Interfaces:**
- Every scheduling model has `sandboxId` (indexed). The template agency uses `sandboxId: "template"`.
- `Sandbox { _id, label /* e.g. "Visitor 4F2A" */, createdAt, expiresAt (TTL index, +24h), requestsDay: string, requestsUsed: number }`.
- `Visit` adds `version: number` (default 0, `$inc` on every write) and `code` (`"V-1001"`). `Caregiver` and `Client` have `code` (`"CG-01"`, `"CL-01"`) plus `name`. `Authorization` has `code` (`"AU-01"`).
- `Proposal { sandboxId, requestId, summary, status: "draft"|"applying"|"applied"|"pending_approval"|"denied"|"undone"|"failed", changes: ProposedChange[], guardActionId?: string, guardStatus?: string, lowRiskBatch: boolean }`; `ProposedChange { _id, kind: "assign"|"move"|"cancel"|"create", visitId?: string, before?: VisitSnapshot, after?: VisitSnapshot, reasons: string[], ruleResults: RuleResult[], unitsLeftBefore: number|null, unitsLeftAfter: number|null, lowRisk: boolean, decision: "pending"|"approved"|"edited"|"rejected"|"auto_approved" }`. `VisitSnapshot = Pick<VisitFacts, "caregiverId"|"start"|"end"|"units"|"status"|"clientId"|"authorizationId"|"serviceCode"> & { version?: number }`.
- `AppliedPlan { proposalId (unique), sandboxId, beforeVisits: (VisitSnapshot & { visitId: string; existed: boolean })[], afterVersions: { visitId: string; version: number }[], undoneAt?: Date }`.
- `CostLedger { day: string /* Denver date */ (unique), usdSpent: number }`. `SavedRun { storyKey (unique), events: AgentEvent[], createdAt }`.
- Produces: `generateAgency(seed: number, today: string): AgencyData` (pure, deterministic); `seedTemplate(today?: string): Promise<void>`; `createSandbox(): Promise<SandboxDoc>` (bulk-copies template docs with new `sandboxId`, keeping `code`s and remapping `_id` references); `resetSandbox(id): Promise<void>`.
- Fixed story fixtures inside `generateAgency` (the evals and story buttons rely on them): caregiver **Priya Nair** (`CG-01`) with ≥ 3 visits tomorrow, each with ≥ 1 valid replacement; client **Asha Patel** (`CL-01`) with personal care authorization `AU-01` (400 units, 15-min, starting next Monday, ~6 months, `maxUnitsPerWeek: 20`) and no visits yet; client **Mohan Rao** (`CL-02`) with a visit this coming Thursday that can move to Friday; two caregivers named **Maria** (`CG-07` Maria Lopez, `CG-08` Maria Chen) for ambiguity tests; one client whose authorization has exactly 4 units left.

- [ ] **Step 1:** Write tests: `generateAgency(42, "2026-11-14")` called twice gives deep-equal output; counts are within ±10% of 25/40/60/2,500; every generated visit passes `checkVisit`; the fixtures above exist. `createSandbox()` produces the same counts under a new `sandboxId`, and a write in it does not change the template.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Names come from a fixed fake list. Locations are random points within 25 km of Denver. Generated visits are created by running `buildSchedule` per authorization and assigning a passing candidate, so they are valid by construction.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: models, deterministic seed and visitor sandboxes`.

### Task 7: Facts loader and change checker (database)

**Files:**
- Create: `server/src/services/scheduling/{factsLoader.ts, changeChecker.ts}`
- Test: `server/tests/changeChecker.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ChangeInput { kind: "assign"|"move"|"cancel"|"create"; visitId?: string; caregiverId?: string|null; start?: string; end?: string; authorizationId?: string; clientId?: string } // ISO strings
  export interface CheckedChange { input: ChangeInput; before: VisitSnapshot|null; after: VisitSnapshot|null; ruleResults: RuleResult[]; ok: boolean; unitsLeftBefore: number|null; unitsLeftAfter: number|null; lowRisk: boolean }
  export function checkChange(sandboxId: string, change: ChangeInput, siblings?: VisitSnapshot[]): Promise<CheckedChange>;
  export function loadRuleContext(sandboxId: string, visit: VisitFacts, siblings: VisitSnapshot[]): Promise<RuleContext>;
  export function unitsLeft(sandboxId: string, authorizationId: string): Promise<number>;
  ```
- `siblings` = the proposal's other non-rejected `after` states. They replace their originals in `otherVisits` (Review Focus 3). `cancel` is always `ok` and gives its units back. `assign` keeps time and changes caregiver; `move` changes time (and optionally caregiver); `create` needs `clientId`, `authorizationId`, `start`, `end` and computes units.

- [ ] **Step 1:** Write tests against a fresh sandbox: an assign to a valid replacement for one of Priya's visits is ok; an assign to a caregiver already booked then fails `no_clash`; **two siblings giving the same caregiver overlapping visits — the second fails `no_clash`**; cancel raises `unitsLeftAfter` by the visit's units; create on the 4-units-left authorization with 8 units fails `units_left`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Queries are scoped by `sandboxId`; load only the relevant week and authorization.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: change checker over the database`.

### Task 8: Proposals service and review API

**Files:**
- Create: `server/src/services/proposals/proposal.service.ts`, `server/src/controllers/proposals.controller.ts`, `server/src/middlewares/sandbox.middleware.ts`, `server/src/controllers/session.controller.ts`
- Modify: `server/src/api/routes.ts`
- Test: `server/tests/proposals.test.ts`

**Interfaces:**
- Demo sign-in: `POST /api/session` → creates a sandbox, returns a JWT `{ sandboxId, coordinator: { name: "Dana Lopez", email: "coordinator@sunrise.test" } }` (12h). `sandbox.middleware` sets `res.locals.sandboxId`, or returns 401 if the sandbox has expired. `POST /api/session/reset` → `resetSandbox`.
- Read endpoints: `GET /api/schedule?from&to&caregiverId?` (visits with names), `GET /api/caregivers`, `GET /api/clients`, `GET /api/authorizations?clientId`.
- `submitProposal(sandboxId, requestId, summary, changes: ChangeInput[]): Promise<{ ok: true; proposal } | { ok: false; failures: { index: number; results: RuleResult[] }[] }>`. Checks each change with the others as siblings. Saves only when all pass. Changes where `lowRisk` is true get `decision: "auto_approved"`.
- `GET /api/proposals/:id`, `POST /api/proposals/:id/changes/:changeId/decision { decision: "approve"|"reject" }`, `PUT /api/proposals/:id/changes/:changeId { caregiverId?, start?, end? }` (re-checks with siblings; on pass `decision: "edited"`, on fail 422 with `ruleResults`), `POST /api/proposals/:id/approve-all`, `GET /api/proposals/:id/changes/:changeId/candidates`.
- Decisions are allowed only while `status === "draft"`.

- [ ] **Step 1:** Write Supertest tests: session + schedule read; a submit with a failing change saves nothing and returns failures; a valid submit saves `draft`; edit to a clashing caregiver → 422 and the change is unchanged; edit to a valid one → `edited`; reject then approve-all leaves the rejected one rejected; another sandbox's token gets 404 for this proposal.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: proposals and review API`.

### Task 9: Agent tools, loop and streaming endpoint

**Files:**
- Create: `server/src/services/agent/{tools.ts, prompts.ts, agentLoop.ts, model.ts, events.ts}`, `server/src/controllers/requests.controller.ts`
- Modify: `server/src/api/routes.ts`
- Test: `server/tests/agent.test.ts`

**Interfaces:**
- `events.ts`: `type AgentEvent = { type: "status"; text: string } | { type: "tool"; name: string; summary: string } | { type: "question"; text: string; choices?: string[] } | { type: "proposal"; proposalId: string } | { type: "error"; message: string } | { type: "done" }`.
- `model.ts`: `getModel(): LanguageModel | null` (from `LLM_PROVIDER`/`LLM_MODEL`; null when `none`); `estimateUsd(usage): number`.
- `tools.ts`: `createTools(ctx: { sandboxId: string; requestId: string; emit: (e: AgentEvent) => void }): ToolSet` with exactly these tools (Zod inputs, names resolved case-insensitively by name or code):
  - `find_visits({ caregiver?, client?, from, to })`
  - `get_authorization({ client, service? })`
  - `find_candidates({ visitId })`
  - `check_change({ change: ChangeInput })`
  - `build_schedule({ authorization, days, window, visitMinutes? })`: returns `PlannedVisit[]` plus up to 3 candidates per visit
  - `submit_proposal({ summary, changes: (ChangeInput & { reasons: string[] })[] })`
  - `ask_coordinator({ question, choices? })`: emits `question` and ends the run.
  
  A name matching several people returns `{ ambiguous: [{ code, name }] }`. No match returns `{ notFound: "<name>" }`. Each tool emits one `tool` event with a short human summary (`"Found 4 visits for Priya Nair tomorrow"`).
- `agentLoop.ts`: `runAgent(input: { sandboxId; text; coordinator; model?: LanguageModel; emit }): Promise<{ proposalId: string | null }>`. It uses `streamText`/`generateText` with tools, a 15-step stop condition (`stopWhen: stepCountIs(15)` in AI SDK v5+; use the installed major version's equivalent) and a 60-second timeout. On a failure it emits `error` with `"I couldn't finish this. Here is what I found so far."` and saves nothing.
- `prompts.ts`: the system prompt states the four request kinds, "never invent caregivers; only use find_candidates results", "ask when a name is ambiguous", "today is <Denver date>, time zone America/Denver", and "submit one proposal with a reason per change".
- `POST /api/requests { text }` → `text/event-stream` of `AgentEvent` JSON lines. It creates a `ChangeRequest` first.

- [ ] **Step 1:** Write tests with the AI SDK mock language model (`MockLanguageModelV2` from `ai/test`, or the installed version's mock) scripted to call tools:
  - Priya-sick script → events include `tool` then `proposal`, and the saved proposal covers all of Priya's visits tomorrow.
  - The script calls `find_visits({ caregiver: "Maria" })` → the tool result has `ambiguous` with `CG-07` and `CG-08`; then `ask_coordinator` → a `question` event, no `proposal`, and no Proposal document exists.
  - A model that throws → an `error` event and no Proposal.
  - Tools never write `Visit` documents (count before = after).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: scheduling agent with streaming steps`.

### Task 10: Demo limits, cost guard, saved runs

**Files:**
- Create: `server/src/services/demo/{costGuard.ts, savedRuns.ts, stories.ts}`, `server/src/scripts/recordStories.ts`
- Modify: `server/src/controllers/requests.controller.ts`
- Test: `server/tests/demoGuard.test.ts`

**Interfaces:**
- `stories.ts`: `STORIES = [{ key: "build-asha", text: "Set up Asha Patel's visits Mon/Wed/Fri mornings 9 to 11 using her personal care authorization" }, { key: "priya-sick", text: "Priya is sick tomorrow, cover her visits" }, { key: "rao-move", text: "Mohan Rao cancelled Thursday, move it to Friday same time if possible" }, { key: "asha-add", text: "Add a 2-hour personal care visit for Asha next Tuesday afternoon" }]`.
- `POST /api/requests { text?, storyKey? }`: free text counts against `requestsUsed` (10/day per sandbox → 429 `"You've used today's 10 free requests. The story buttons still work."`). Story buttons don't count.
- `costGuard`: `canSpend(): Promise<boolean>`, `record(usd: number)`. When the cap is hit, or the model is null: for a story, stream the `SavedRun` events with an extra first `status` event `"Recorded run, live AI resumes tomorrow"`, and `proposal` events are replaced by `{ type: "status", text: "Approve and Undo are shown in the video" }`; for free text, return 503 `"Live AI is resting for today. Try the story buttons."`.
- `recordStories.ts` (`npm run record-stories`): runs each story live against a fresh sandbox and stores the events.

- [ ] **Step 1:** Write tests: the 11th free request → 429; a story request does not count; with the cap at 0, a story streams saved events starting with the "Recorded run" status and containing no `proposal`; free text → 503.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. The ledger day is the Denver date, and `record` uses an atomic `$inc` upsert.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: demo limits, AI cost cap and recorded story runs`.

### Task 11: Apply through AgentGuard (internal endpoints, client, status)

**Files:**
- Create: `server/src/services/integrations/agentGuard.client.ts`, `server/src/services/proposals/applyPlan.service.ts`, `server/src/controllers/internal.controller.ts`, `server/src/middlewares/internalSecret.middleware.ts`
- Modify: `server/src/api/routes.ts`, `server/src/controllers/proposals.controller.ts`
- Test: `server/tests/applyPlan.test.ts`

**Interfaces:**
- Internal (header `x-shiftpilot-secret: SHIFTPILOT_INTERNAL_SECRET`, timing-safe compare):
  - `GET /api/internal/plans/:proposalId/facts` → `{ existingVisitsChanged: number, newVisits: number, caregiversRemoved: number, summary: string, sandboxLabel: string, status }`. Counts approved, edited and auto-approved changes only.
  - `POST /api/internal/plans/:proposalId/run` → in one Mongo transaction: re-run `checkChange` for every applied change; refuse with 409 `"Some visits changed since this plan was made. Ask the agent again."` if any rule fails or any visit `version` differs from `before.version`; write the visits (`version` +1); create `AppliedPlan` (unique `proposalId` → a second run returns the first result); set the proposal to `applied`. Returns `{ applied: number }`.
  - `POST /api/internal/plans/:proposalId/undo` → in a transaction: refuse with 409 if any visit's current `version` ≠ `afterVersions`; restore `beforeVisits` (delete visits where `existed: false`); set `undoneAt` and the proposal to `undone`.
- `agentGuard.client.ts`: `submitPlan(proposalId: string, coordinatorEmail: string, attempt: number): Promise<{ id: string; status: string; message: string }>` → `POST {AGENTGUARD_URL}/api/agent/actions` with `x-agent-key: SHIFTPILOT_AGENT_KEY`, `{ action: "schedule.applyPlan", params: { proposalId }, onBehalfOf, reason, idempotencyKey: "shiftpilot-" + proposalId + "-" + attempt }`, 10s timeout. `getStatus(actionId)`; `wake(): Promise<void>` (`GET /api/health`, ignores errors); `actionUrl(id) = AGENTGUARD_PUBLIC_URL + "/activity?action=" + id`.
- `POST /api/proposals/:id/apply`: atomically flips `draft` → `applying` (`findOneAndUpdate` with a status filter; a second click gets the same proposal back without a second submit). It then calls `submitPlan` and maps `done` → `applied`, `pending_approval` → `pending_approval`, `denied` → `denied`. On a network error it reverts to `draft` and returns 503 `"Safety layer is waking up, try again in a minute."`. Low-risk changes are submitted first as their own proposal (`lowRiskBatch: true`).
- `GET /api/proposals/:id/guard-status` → refreshes from AgentGuard; maps `undone` too; returns `{ status, guardUrl }`. A 404 from AgentGuard → `"This record was reset in AgentGuard."`.
- Without `AGENTGUARD_URL`: apply runs `run` locally and the status says `"AgentGuard not connected"`.

- [ ] **Step 1:** Write tests (AgentGuard faked with `jest.spyOn(global, "fetch")`): internal endpoints reject a wrong secret (401); facts count only approved changes; run writes visits once even when called twice; **run after another plan changed one of the same visits → 409, nothing written**; undo restores and deletes created visits; undo after a later edit → 409; **two simultaneous `POST /apply` → `fetch` called once**; a network error → 503 and status back to `draft`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: apply and undo plans through AgentGuard`.

### Task 12: AgentReplay recording and MCP server

**Files:**
- Create: `server/src/services/integrations/agentReplay.ts`, `server/src/services/mcp/mcpServer.service.ts`, `server/src/controllers/mcp.controller.ts`
- Modify: `server/src/services/agent/agentLoop.ts`, `server/src/services/proposals/applyPlan.service.ts`, `server/src/api/routes.ts`
- Test: `server/tests/agentReplay.test.ts`, `server/tests/mcp.test.ts`

**Interfaces:**
- `agentReplay.ts`: `startRecording(name: string, userRef: string): RecordingHandle | null` (null when `AGENTREPLAY_API_KEY` is unset; the SDK is not even imported then). `RecordingHandle { llm(step), tool(name, input, output), link(actionId, url), end() }`. `applyPlan` adds a step with `externalRef { system: "agentguard", id, url }` after submit.
- MCP: `POST /api/mcp`, stateless Streamable HTTP like AgentGuard's `mcpServer.service.ts`. Auth: `Authorization: Bearer <sandbox JWT>`. Tools: the read and propose tools from Task 9 except `ask_coordinator` and without apply. `GET`/`DELETE` → 405.

- [ ] **Step 1:** Write tests: without a key, the SDK module is never loaded (mock and assert not called); with a key (SDK mocked), one run with `llm` and `tool` steps and an `externalRef` on apply; an AgentReplay throw never fails the request. MCP: `initialize`, `tools/list` names, a `find_visits` call, a `submit_proposal` call that creates a draft, and a missing token → 401.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat: AgentReplay recording and MCP tools`.

### Task 13: Client – sign-in, schedule view, request box with live steps

**Files:**
- Create: `client/src/utils/services/api_services/{apiClient.ts, scheduleApi.ts, requestsApi.ts}`, `client/src/utils/store/{sessionStore.ts, toastStore.ts}`, `client/src/utils/hooks/useShiftPilotQueries.ts`, `client/src/utils/helper_functions/format.ts`, `client/src/utils/types.ts`
- Create: `client/src/components/layout/AppLayout.tsx`, `client/src/components/display_components/index.tsx`
- Create: `client/src/screens/welcome_screen/index.tsx`, `client/src/screens/schedule_screen/{index.tsx, WeekGrid.tsx, RequestPanel.tsx, LiveSteps.tsx}`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: Task 8 to Task 10 endpoints. `streamRequest(body, onEvent: (e: AgentEvent) => void): Promise<void>` reads the SSE stream with `fetch` + `ReadableStream`.
- Welcome screen: one line on the product, a "Start demo as Dana (Coordinator)" button → `POST /api/session` → `/schedule`. It calls `wake()` on AgentGuard via `GET /api/integrations/wake` (a tiny server route that calls `agentGuard.wake()`).
- Schedule screen: a week grid with rows = caregivers and columns = Mon–Sun (Denver), visit chips with the client name and time, uncovered visits in amber, and week navigation. A right panel holds 4 story buttons (numbered 1–4), a free-text box with `"n of 10 left today"`, and `LiveSteps` showing events as they arrive. A `question` shows choice buttons that send a follow-up request with the choice appended. A `proposal` navigates to `/proposals/:id`.

- [ ] **Step 1:** Run `npm run typecheck -w client && npm run build -w client`. Expected: PASS after implementation.
- [ ] **Step 2:** Browser check (Task 16's script covers it): sign in, the grid shows tomorrow's visits for Priya, story 2 streams steps.
- [ ] **Step 3:** Commit `feat: schedule screen with live agent steps`.

### Task 14: Client – review screen, apply, AgentGuard links

**Files:**
- Create: `client/src/screens/review_screen/{index.tsx, ChangeCard.tsx, EditChangeDrawer.tsx, ApplyBar.tsx}`
- Modify: `client/src/App.tsx`, `client/src/utils/hooks/useShiftPilotQueries.ts`

**Interfaces:**
- Consumes: Task 8 and Task 11 endpoints.
- Changes are grouped by day (by week when there are more than 14 changes, with "Approve this week"). Each `ChangeCard` shows before → after, reasons, the rule results (collapsed; all green ticks), and "Units left: 40 → 32". Buttons: Approve / Edit / Reject. Auto-approved cards carry an "Auto-approved (low risk)" badge.
- `EditChangeDrawer`: a candidate list (from `/candidates`) and a time picker. Saving shows the failing rules inline on 422.
- `ApplyBar`: "Apply N approved changes". After apply it shows the status chip (`Applied` / `Waiting for a manager in AgentGuard` / `Refused by a rule` / `Undone`) and a link button `"Undo in AgentGuard"` or `"Open in AgentGuard"` → `guardUrl` (new tab). It polls `guard-status` every 5s while `pending_approval`, and refreshes on window focus.

- [ ] **Step 1:** Run `npm run typecheck -w client && npm run build -w client`. Expected: PASS.
- [ ] **Step 2:** Browser check (Task 16): story 2 → review → approve all → apply → `Applied` + "Undo in AgentGuard" link with `/activity?action=`.
- [ ] **Step 3:** Commit `feat: review, edit and apply screens`.

### Task 15: Evals

**Files:**
- Create: `server/evals/{scenarios.ts, checks.ts, run.ts}`, `server/evals/results/.gitkeep`
- Modify: `server/package.json` (`"evals": "tsx evals/run.ts"`)

**Interfaces:**
- `Scenario { id: string; text: string; expect: Check[] }`. `Check` is one of: `{ kind: "proposal" }`, `{ kind: "noProposal" }`, `{ kind: "asked"; mentions?: string[] }`, `{ kind: "coversVisitsOf"; caregiverCode: string; day: "tomorrow" }`, `{ kind: "allRulesPass" }`, `{ kind: "unitsWithinAuthorization"; authorizationCode: string }`, `{ kind: "noCaregiver"; caregiverCode: string }`, `{ kind: "maxChanges"; n: number }`.
- `run.ts`: for each scenario, create a fresh sandbox, call `runAgent` with the real model, apply the checks, and write `evals/results/<date>.md` (a table with id, pass/fail, steps, USD) plus a total score. It exits non-zero below 90%.
- 30 scenarios: 8 sick-call variants (including "Priya and Maria Lopez both sick"), 6 cancel/move (including a move into a full week), 6 add (including the 4-units-left client → refused and explained), 6 build-from-authorization (with weekly limit, with existing visits), 4 ambiguity/unknown (`"Maria is sick"` → asked; `"Pria is sick"` → asked or notFound; a client who doesn't exist; an off-topic request → noProposal).

- [ ] **Step 1:** Implement the checks with unit tests (`server/tests/evalChecks.test.ts`) against hand-made proposals.
- [ ] **Step 2:** Run `npm test -w server`. Expected: PASS.
- [ ] **Step 3:** Run `npm run evals -w server` with a real key. Expected: a results file, score ≥ 90%. Fix the prompts or tools until it passes.
- [ ] **Step 4:** Commit `feat: 30-scenario agent evals` (with the results file).

### Task 16: Browser check, deploy config, README

**Files:**
- Create: `checks/journey.mjs` (Playwright, desktop 1280×800 and phone 390×844), `README.md`, `docs/screenshots/`
- Modify: `render.yaml`

**Interfaces:**
- `npm run check:browser`: builds, starts the server against a local Mongo with `LLM_PROVIDER=none` and the saved-run fixtures, and a fake AgentGuard (a tiny Express stub in the script answering `/api/agent/actions` with `done`). Journey: welcome → schedule → story 2 (saved run) → story 1 → … The free-form path uses a seeded live-mock. Screenshots go to `checks/screenshots/`.
- `render.yaml`: like AgentGuard's (free plan, singapore, Node 22, `healthCheckPath: /api/health`, `MONGOMS_DISABLE_POSTINSTALL=1`), with env keys from Task 1 (secrets `sync: false`) and `SEED_ON_START=true`.
- README sections (AgentGuard style): what it does (3 lines), live demo link, GIF, the 4-step story, architecture (Mermaid), "how the three projects connect", key decisions table (code decides rules; one AgentGuard action per plan; Undo in AgentGuard; why not LangGraph), eval score table, run locally, tests, a fake-data statement.

- [ ] **Step 1:** Run `npm run check:browser`. Expected: the journey passes on both sizes and the screenshots are saved.
- [ ] **Step 2:** Run `npm test && npm run typecheck && npm run build`. Expected: all PASS.
- [ ] **Step 3:** Commit `docs: README, deploy config and browser journey check`.

---

## Part B: AgentGuard changes (`deepak-r-fullstack/agentguard`)

### Task 17: Sunrise Home Care demo workspace

**Files:**
- Modify: `server/src/services/demo/demo.service.ts` (add `SUNRISE` to `DEMO_COMPANIES`), `server/src/models/workspace.model.ts` (if needed for currency `USD`), `server/src/config/env.ts` (`SHIFTPILOT_AGENT_KEY`, `SHIFTPILOT_URL`, `SHIFTPILOT_INTERNAL_SECRET`), the client login screen's one-click account list, `render.yaml`
- Test: `server/tests/sunrise.test.ts`

**Interfaces:**
- `SUNRISE = { slug: "sunrise-home-care", name: "Sunrise Home Care (demo)", currency: "USD", users: [Dana Lopez coordinator@sunrise.test role manager, Sam Ortiz manager@sunrise.test role manager, Grace Kim admin@sunrise.test role admin], agents: [{ name: "ShiftPilot", ... }], customers: [], bookings: [], policies: [{ name: "Big schedule changes need a manager", action: "schedule.applyPlan", effect: "require_approval", conditions: [{ field: "facts.existingVisitsChanged", op: "gt", value: 10 }] }, { name: "Normal schedule changes run", action: "schedule.applyPlan", effect: "allow", conditions: [{ field: "facts.existingVisitsChanged", op: "lte", value: 10 }] }] }`.
- When `SHIFTPILOT_AGENT_KEY` is set, the ShiftPilot agent's key hash is computed from it (a fixed key across reseeds). Otherwise a random key, as for the other agents.
- Acme's demo reset never touches Sunrise (it already resets per workspace; add a test).

- [ ] **Step 1:** Write tests: the seed creates Sunrise with 3 users, the ShiftPilot agent, and both rules; with `SHIFTPILOT_AGENT_KEY=agk_test...` the agent authenticates with that key; resetting Acme leaves Sunrise actions intact.
- [ ] **Step 2:** Run `npm test` in agentguard. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite. Expected: PASS (all of the existing 249+ tests too).
- [ ] **Step 5:** Commit `feat: Sunrise Home Care demo workspace for ShiftPilot`.

### Task 18: `schedule.applyPlan` action adapter

**Files:**
- Create: `server/src/services/shiftpilot/shiftpilotPlan.service.ts`
- Modify: `server/src/services/actions/actionRegistry.ts` (register it; expose it only when `isShiftPilotConfigured()` and only for the Sunrise workspace), `README.md` (a "Works with ShiftPilot" section)
- Test: `server/tests/shiftpilotPlan.test.ts`

**Interfaces:**
- `ActionDefinition` `schedule.applyPlan`: `paramsSchema: z.object({ proposalId: z.string().regex(/^[a-f0-9]{24}$/) }).strict()`, `irreversible: false`, `moneyFields: { facts: [], result: [] }`, `ruleFields: [facts.existingVisitsChanged (number), facts.newVisits (number), facts.caregiversRemoved (number), ...COMMON_FIELDS]`.
  - `prepare` → `GET {SHIFTPILOT_URL}/api/internal/plans/:id/facts`; summary = `"Apply schedule plan for <sandboxLabel>: <summary>"`. Refuses unless status is `draft`/`applying`.
  - `snapshot` → `{ proposalId }`.
  - `run` → `POST .../run`; `undo` → `POST .../undo`; a 409 maps to `ConflictError` with ShiftPilot's message.
  - 8s timeout, no redirects, no retries on writes, sanitized errors. The base URL and secret are server-owned (as in `githubSandbox.service.ts`). Allowed when `DEMO_MODE=true` but only for workspace slug `sunrise-home-care`.
- Separation of duties already applies: Dana (`onBehalfOf`) cannot approve her own big plan; Sam can.

- [ ] **Step 1:** Write tests (ShiftPilot faked with `fetch` mocks): a small plan → `done` and `run` called once; a plan with 11 existing visits → `pending_approval`, Dana's approve is refused, Sam's approve → `run` called; undo → ShiftPilot undo called, and a 409 → undo refused with the message; a ShiftPilot timeout on run → the action is `failed` with an "inspect" message and no retry; the action is invisible to Acme agents and in the catalog when unconfigured; MCP `tools/list` for the ShiftPilot agent includes `schedule_applyPlan`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: schedule.applyPlan action for ShiftPilot`.

---

## Release checklist (after Part A and Part B)

- [ ] Deploy AgentGuard with `SHIFTPILOT_*` set; deploy ShiftPilot on Render; DNS `shiftpilot.sritaraksolutions.in`.
- [ ] `npm run record-stories` against production once, so the saved runs exist.
- [ ] Run the full live journey by hand: the 4 stories → apply → "Undo in AgentGuard" (sign in as Sam) → Undo → ShiftPilot shows `Undone` → the run is visible in AgentReplay.
- [ ] Record the 2-minute video, add the GIF to the README, link it from the portfolio site and sritaraksolutions.in.
