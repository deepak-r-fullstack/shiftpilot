import { FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { DisplayButton } from "components/display_components";
import { queryKeys, useRequestOptions } from "utils/hooks/useShiftPilotQueries";
import { streamRequest } from "utils/services/api_services/shiftpilot_service";
import { getErrorMessage } from "utils/services/api_services/apiClient";
import { AgentEvent } from "utils/types";
import { LiveSteps } from "./LiveSteps";

// Where the coordinator talks to the assistant: four story buttons that tell the
// whole demo in order, or a free sentence of their own.
export const RequestPanel = () => {
  const { data: options } = useRequestOptions();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [running, setRunning] = useState(false);
  const lastText = useRef("");

  const question = [...events].reverse().find((e): e is Extract<AgentEvent, { type: "question" }> => e.type === "question");
  const proposal = events.find((e): e is Extract<AgentEvent, { type: "proposal" }> => e.type === "proposal");

  const send = async (body: { text?: string; storyKey?: string }) => {
    if (running) return;
    setRunning(true);
    setEvents([]);
    lastText.current = body.text ?? options?.stories.find((s) => s.key === body.storyKey)?.text ?? "";
    try {
      await streamRequest(body, (event) => {
        setEvents((current) => [...current, event]);
        if (event.type === "proposal") window.setTimeout(() => navigate(`/proposals/${event.proposalId}`), 1200);
      });
    } catch (error) {
      setEvents((current) => [...current, { type: "error", message: getErrorMessage(error) }]);
    } finally {
      setRunning(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.options });
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim().length < 3) return;
    send({ text: text.trim() });
  };

  // The answer goes back with the question's request, kept short enough for the 500-character limit.
  const answer = (choice: string) => send({ text: `${lastText.current.slice(0, 400)}\n(The coordinator means: ${choice.slice(0, 80)})` });

  return (
    <section className="rounded-lg border border-line bg-sheet p-4" aria-label="Ask the scheduling assistant">
      <h2 className="font-semibold">Ask the scheduling assistant</h2>
      <p className="mt-1 text-sm text-ink-soft">Try the four steps of the story in order, or type your own change.</p>

      <div className="mt-4 flex flex-col gap-2">
        {options?.stories.map((story, index) => (
          <button
            key={story.key}
            type="button"
            disabled={running}
            onClick={() => send({ storyKey: story.key })}
            className="flex items-start gap-3 rounded-md border border-line px-3 py-2 text-left transition-colors hover:border-brand hover:bg-brand-tint disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{index + 1}</span>
            <span>
              <span className="block text-sm font-semibold">{story.title}</span>
              <span className="block text-xs text-ink-soft">“{story.text}”</span>
            </span>
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="mt-4">
        <label htmlFor="request-text" className="field-label">
          Or type a change
        </label>
        <textarea
          id="request-text"
          className="field-input min-h-[72px] resize-y"
          placeholder="e.g. Maria Lopez is off on Friday, cover her visits"
          value={text}
          maxLength={500}
          onChange={(event) => setText(event.target.value)}
          disabled={running || options?.liveAi === false}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-ink-faint">
            {options?.liveAi === false ? "Live AI is resting: the story buttons use a scripted planner." : `${options?.freeRequestsLeft ?? "…"} of 10 free requests left today`}
          </span>
          <DisplayButton type="submit" variant="primary" loading={running} disabled={text.trim().length < 3 || options?.liveAi === false} icon={<Send className="h-4 w-4" />}>
            Send
          </DisplayButton>
        </div>
      </form>

      <LiveSteps events={events} running={running} />

      {question?.choices && question.choices.length > 0 && !running && options?.liveAi && (
        <div className="mt-3 flex flex-wrap gap-2">
          {question.choices.map((choice) => (
            <DisplayButton key={choice} onClick={() => answer(choice)}>
              {choice}
            </DisplayButton>
          ))}
        </div>
      )}
      {proposal && (
        <DisplayButton variant="primary" className="mt-3 w-full" onClick={() => navigate(`/proposals/${proposal.proposalId}`)}>
          Review the plan
        </DisplayButton>
      )}
    </section>
  );
};
