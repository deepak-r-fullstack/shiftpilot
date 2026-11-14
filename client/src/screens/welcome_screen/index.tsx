import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { DisplayButton, DisplayError } from "components/display_components";
import { sessionService } from "utils/services/api_services/shiftpilot_service";
import { getErrorMessage } from "utils/services/api_services/apiClient";
import { useSessionStore } from "utils/store/sessionStore";

const STEPS = [
  { icon: Sparkles, title: "Type a change in plain English", text: "“Priya is sick tomorrow, cover her visits.”" },
  { icon: CheckCircle2, title: "The agent plans it within the rules", text: "Free, qualified and nearby caregivers, inside each client's authorized units." },
  { icon: ShieldCheck, title: "You approve, and can undo", text: "Nothing changes until you say so. AgentGuard keeps the record and the Undo button." },
];

export const WelcomeScreen = () => {
  const setSession = useSessionStore((state) => state.setSession);
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The free hosting of the safety layer sleeps when idle; start waking it now.
  useEffect(() => {
    sessionService.wakeSafetyLayer().catch(() => undefined);
  }, []);

  const start = async () => {
    setError("");
    setLoading(true);
    try {
      const response = await sessionService.start();
      setSession(response.data.token, response.data.coordinator, response.data.sandbox);
      navigate("/schedule", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center gap-2">
          <CalendarClock className="h-7 w-7 text-brand" aria-hidden />
          <span className="text-xl font-semibold tracking-tight">ShiftPilot</span>
        </div>
        <h1 className="font-serif text-3xl leading-tight sm:text-[2.4rem]">Reschedule home care visits in one sentence.</h1>
        <p className="mt-3 max-w-xl text-lg text-ink-soft">
          An AI scheduling assistant for home care coordinators. It plans every change inside the rules, and a person approves before anything moves.
        </p>

        <ol className="mt-8 grid gap-3 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, text }, index) => (
            <li key={title} className="rounded-lg border border-line bg-sheet p-4">
              <div className="flex items-center gap-2 text-brand">
                <Icon className="h-4 w-4" aria-hidden />
                <span className="text-xs font-semibold uppercase tracking-wide">Step {index + 1}</span>
              </div>
              <p className="mt-2 font-semibold">{title}</p>
              <p className="mt-1 text-sm text-ink-soft">{text}</p>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-lg border border-line bg-sheet p-5">
          <p className="font-semibold">Try it as Dana Lopez, coordinator at Sunrise Home Care</p>
          <p className="mt-1 text-sm text-ink-soft">
            You get your own private copy of a made-up Colorado agency: 25 caregivers, 40 clients and about 2,500 visits. All people and data are fake. Your copy is deleted after 24 hours.
          </p>
          <DisplayButton variant="primary" size="lg" className="mt-4 w-full sm:w-auto" onClick={start} loading={loading}>
            {loading ? "Setting up your agency" : "Start the demo"}
          </DisplayButton>
          {error && (
            <div className="mt-4">
              <DisplayError message={error} onRetry={start} />
            </div>
          )}
        </div>

        <p className="mt-6 text-sm text-ink-faint">
          Built by Deepak R with MERN and TypeScript. Works with{" "}
          <a className="underline hover:text-ink" href="https://agentguard.sritaraksolutions.in" target="_blank" rel="noreferrer">AgentGuard</a> (approvals and undo) and{" "}
          <a className="underline hover:text-ink" href="https://agentreplay.sritaraksolutions.in" target="_blank" rel="noreferrer">AgentReplay</a> (recordings of every AI run).
        </p>
      </div>
    </div>
  );
};
