import { MockLanguageModelV3 } from "ai/test";
import { DateTime } from "luxon";
import { agencyToday } from "../../utils/clock";
import { ZONE } from "../../utils/time";

// ---------------------------------------------------------------------------
// A scripted stand-in for the AI, for local development and the browser check
// only (FAKE_AI=stories, never in production). It walks the four story buttons
// with REAL tool calls, reading the real tool results, so everything after the
// model (rules, proposals, review, apply, undo) runs for real without an API key.
// ---------------------------------------------------------------------------

type ToolCall = { name: string; input: Record<string, unknown> };
type Message = { role: string; content: any };

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };

function nextWeekday(day: number): string {
  // 1 = Monday ... 7 = Sunday; the next one after today.
  let date = DateTime.fromISO(agencyToday(), { zone: ZONE }).plus({ days: 1 });
  while (date.weekday !== day) date = date.plus({ days: 1 });
  return date.toISODate()!;
}

function toolResults(messages: Message[]): { name: string; output: any }[] {
  return messages
    .filter((m) => m.role === "tool")
    .flatMap((m) => m.content)
    .filter((part: any) => part.type === "tool-result")
    .map((part: any) => ({ name: part.toolName, output: part.output?.value ?? part.output }));
}

function plan(text: string, done: { name: string; output: any }[]): ToolCall[] | string {
  const last = (name: string) => [...done].reverse().find((r) => r.name === name)?.output;
  const lower = text.toLowerCase();
  const tomorrow = DateTime.fromISO(agencyToday(), { zone: ZONE }).plus({ days: 1 }).toISODate()!;

  if (lower.includes("priya")) {
    const visits = last("find_visits")?.visits;
    if (!visits) return [{ name: "find_visits", input: { caregiver: "Priya", fromDate: tomorrow, toDate: tomorrow } }];
    const candidates = done.filter((r) => r.name === "find_candidates");
    if (candidates.length === 0) return visits.map((v: any) => ({ name: "find_candidates", input: { visitCode: v.visitCode } }));
    if (last("submit_proposal")?.saved) return "Done. The plan is ready for your review.";
    const attempt = done.filter((r) => r.name === "submit_proposal").length; // 0 = top choice, 1 = second choice
    return [
      {
        name: "submit_proposal",
        input: {
          summary: "Cover Priya Nair's visits tomorrow while she is sick",
          changes: visits.map((v: any, i: number) => {
            const options = candidates[i]?.output?.candidates ?? [];
            const pick = options[Math.min(attempt, options.length - 1)];
            return { kind: "assign", visitCode: v.visitCode, caregiverCode: pick?.caregiverCode ?? null, reason: pick ? `${pick.name}: ${pick.facts}` : "Nobody is free; left open." };
          }),
        },
      },
    ];
  }

  if (lower.includes("set up asha") || lower.includes("build")) {
    const auth = last("get_authorization");
    if (!auth) return [{ name: "get_authorization", input: { client: "Asha Patel", service: "personal care" } }];
    const built = last("build_schedule");
    if (!built) return [{ name: "build_schedule", input: { authorizationCode: auth.authorizations[0].authorizationCode, days: ["mon", "wed", "fri"], windowStart: "09:00", windowEnd: "11:00" } }];
    if (last("submit_proposal")?.saved) return "Done. Asha's schedule is ready for your review.";
    return [{ name: "submit_proposal", input: { summary: `Asha Patel: ${built.visits} visits Mon/Wed/Fri mornings from her personal care authorization`, buildPlanId: built.buildPlanId } }];
  }

  if (lower.includes("rao")) {
    const thursday = nextWeekday(4);
    const friday = DateTime.fromISO(thursday).plus({ days: 1 }).toISODate()!;
    const visits = last("find_visits")?.visits;
    if (!visits) return [{ name: "find_visits", input: { client: "Mohan Rao", fromDate: thursday, toDate: thursday } }];
    const visit = visits[0];
    if (!visit) return "Mohan Rao has no visit on Thursday.";
    const candidates = last("find_candidates")?.candidates;
    if (!candidates) return [{ name: "find_candidates", input: { visitCode: visit.visitCode, date: friday, startTime: visit.start, endTime: visit.end } }];
    if (last("submit_proposal")?.saved) return "Done. The move is ready for your review.";
    const pick = candidates[0];
    return [{ name: "submit_proposal", input: { summary: `Move Mohan Rao's Thursday visit to Friday ${visit.start}`, changes: [{ kind: "move", visitCode: visit.visitCode, caregiverCode: pick?.caregiverCode ?? null, date: friday, startTime: visit.start, endTime: visit.end, reason: pick ? `${pick.name}: ${pick.facts}` : "Nobody is free; left open." }] } }];
  }

  if (lower.includes("add")) {
    const tuesday = nextWeekday(2);
    const auth = last("get_authorization");
    if (!auth) return [{ name: "get_authorization", input: { client: "Asha", service: "personal care" } }];
    const code = auth.authorizations[0].authorizationCode;
    const candidates = last("find_candidates")?.candidates;
    if (!candidates) return [{ name: "find_candidates", input: { clientCode: auth.client.code, authorizationCode: code, date: tuesday, startTime: "13:00", endTime: "15:00" } }];
    if (last("submit_proposal")?.saved) return "Done. The new visit is ready for your review.";
    const pick = candidates[0];
    return [{ name: "submit_proposal", input: { summary: "Add a 2-hour personal care visit for Asha Patel next Tuesday afternoon", changes: [{ kind: "create", clientCode: auth.client.code, authorizationCode: code, caregiverCode: pick?.caregiverCode ?? null, date: tuesday, startTime: "13:00", endTime: "15:00", reason: pick ? `${pick.name}: ${pick.facts}` : "Nobody is free; left open." }] } }];
  }

  return "I only help with visit scheduling. (This is the scripted demo model: it knows the four story buttons.)";
}

export function createStoryModel() {
  let call = 0;
  return new MockLanguageModelV3({
    doGenerate: async (options: any) => {
      call += 1;
      const messages: Message[] = options.prompt;
      const userText = messages.filter((m) => m.role === "user").flatMap((m) => m.content).map((p: any) => p.text ?? "").join(" ");
      const next = plan(userText, toolResults(messages));
      if (typeof next === "string") return { content: [{ type: "text", text: next }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] } as any;
      return {
        content: next.map((t, i) => ({ type: "tool-call", toolCallId: `story-${call}-${i}`, toolName: t.name, input: JSON.stringify(t.input) })),
        finishReason: { unified: "tool-calls", raw: "tool_use" },
        usage,
        warnings: [],
      } as any;
    },
  });
}
