import { AlertTriangle, CheckCircle2, CircleDot, HelpCircle, Loader2, Wrench } from "lucide-react";
import { AgentEvent } from "utils/types";

// The agent's steps, as they happen. Each line is short and plain.
export const LiveSteps = ({ events, running }: { events: AgentEvent[]; running: boolean }) => {
  const visible = events.filter((event) => event.type !== "done");
  if (visible.length === 0 && !running) return null;
  return (
    <ol className="mt-4 flex flex-col gap-2" aria-live="polite">
      {visible.map((event, index) => {
        if (event.type === "tool")
          return (
            <li key={index} className="flex gap-2 text-sm">
              <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
              <span>{event.summary}</span>
            </li>
          );
        if (event.type === "status")
          return (
            <li key={index} className="flex gap-2 text-sm text-ink-soft">
              <CircleDot className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{event.text}</span>
            </li>
          );
        if (event.type === "question")
          return (
            <li key={index} className="flex gap-2 text-sm font-medium text-waiting">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{event.text}</span>
            </li>
          );
        if (event.type === "proposal")
          return (
            <li key={index} className="flex gap-2 text-sm font-medium text-done">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Plan ready: {event.changes} change{event.changes === 1 ? "" : "s"} for you to review.
              </span>
            </li>
          );
        if (event.type === "error")
          return (
            <li key={index} className="flex gap-2 text-sm text-refused" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{event.message}</span>
            </li>
          );
        return null;
      })}
      {running && (
        <li className="flex gap-2 text-sm text-ink-faint">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <span>Working…</span>
        </li>
      )}
    </ol>
  );
};
