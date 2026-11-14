import { useState } from "react";
import { ArrowDown, ArrowRight, Check, ChevronDown, Pencil, X } from "lucide-react";
import { DisplayBadge, DisplayButton, Tone } from "components/display_components";
import { formatDay, formatTimeRange } from "utils/helper_functions/format";
import { ChangeDecision, ProposedChange, VisitSnapshot } from "utils/types";

// One suggested change: what it was, what it would be, why, and the rule checks.

const KIND_LABEL = { assign: "Cover visit", move: "Move visit", cancel: "Cancel visit", create: "New visit" } as const;

const DECISION: Record<ChangeDecision, { label: string; tone: Tone }> = {
  pending: { label: "Waiting for you", tone: "neutral" },
  approved: { label: "Approved", tone: "done" },
  edited: { label: "Edited and approved", tone: "done" },
  rejected: { label: "Rejected", tone: "refused" },
  auto_approved: { label: "Auto-approved (low risk)", tone: "done" },
};

const VisitLine = ({ visit, name }: { visit: VisitSnapshot; name: (code: string | null) => string }) => (
  <div className="min-w-0">
    <p className="font-medium">{name(visit.caregiverCode)}</p>
    <p className="text-sm text-ink-soft">
      {formatDay(visit.start)}, {formatTimeRange(visit.start, visit.end)} · {visit.units} units
    </p>
  </div>
);

interface ChangeCardProps {
  change: ProposedChange;
  name: (code: string | null) => string;
  editable: boolean;
  busy: boolean;
  onDecide: (decision: "approve" | "reject") => void;
  onEdit: () => void;
}

export const ChangeCard = ({ change, name, editable, busy, onDecide, onEdit }: ChangeCardProps) => {
  const [showRules, setShowRules] = useState(false);
  const visit = (change.after ?? change.before)!;
  const decision = DECISION[change.decision];
  const passed = change.ruleResults.filter((r) => r.passed).length;

  return (
    <article className={`rounded-lg border bg-sheet p-4 ${change.decision === "rejected" ? "border-line opacity-60" : "border-line"}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand">{KIND_LABEL[change.kind]}</p>
          <h3 className="font-semibold">
            {name(visit.clientCode)} <span className="font-normal text-ink-faint">· {change.before?.visitCode ?? "new"}</span>
          </h3>
        </div>
        <DisplayBadge tone={decision.tone}>{decision.label}</DisplayBadge>
      </header>

      <div className="mt-3 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        {change.before ? <VisitLine visit={change.before} name={name} /> : <p className="text-sm text-ink-faint">No visit yet</p>}
        <ArrowRight className="hidden h-4 w-4 text-ink-faint sm:block" aria-hidden />
        <ArrowDown className="h-4 w-4 text-ink-faint sm:hidden" aria-hidden />
        {change.kind === "cancel" ? (
          <p className="font-medium text-refused">Cancelled (units go back)</p>
        ) : (
          change.after && <VisitLine visit={change.after} name={name} />
        )}
      </div>

      {change.reasons.length > 0 && <p className="mt-3 rounded-md bg-paper px-3 py-2 text-sm">{change.reasons.join(" ")}</p>}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          {change.unitsLeftBefore !== null && (
            <span>
              Units left: {change.unitsLeftBefore} → <strong className="text-ink">{change.unitsLeftAfter}</strong>
            </span>
          )}
          {change.ruleResults.length > 0 && (
            <button type="button" className="inline-flex items-center gap-1 text-done hover:underline" onClick={() => setShowRules((v) => !v)} aria-expanded={showRules}>
              <Check className="h-4 w-4" aria-hidden />
              {passed === change.ruleResults.length ? `All ${passed} rules pass` : `${passed} of ${change.ruleResults.length} rules pass`}
              <ChevronDown className={`h-4 w-4 transition-transform ${showRules ? "rotate-180" : ""}`} aria-hidden />
            </button>
          )}
        </div>
        {editable && (
          <div className="flex gap-2">
            {change.kind !== "cancel" && (
              <DisplayButton variant="ghost" onClick={onEdit} disabled={busy} icon={<Pencil className="h-4 w-4" />}>
                Edit
              </DisplayButton>
            )}
            {change.decision !== "rejected" && (
              <DisplayButton variant="danger" onClick={() => onDecide("reject")} disabled={busy} icon={<X className="h-4 w-4" />}>
                Reject
              </DisplayButton>
            )}
            {(change.decision === "pending" || change.decision === "rejected") && (
              <DisplayButton variant="primary" onClick={() => onDecide("approve")} disabled={busy} icon={<Check className="h-4 w-4" />}>
                Approve
              </DisplayButton>
            )}
          </div>
        )}
      </div>

      {showRules && (
        <ul className="mt-3 grid gap-1 border-t border-line pt-3 text-sm sm:grid-cols-2">
          {change.ruleResults.map((rule) => (
            <li key={rule.rule} className={`flex gap-2 ${rule.passed ? "text-ink-soft" : "text-refused"}`}>
              {rule.passed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-done" aria-hidden /> : <X className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
              <span>{rule.message}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};
