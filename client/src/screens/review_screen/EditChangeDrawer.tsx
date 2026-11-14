import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { DisplayButton, DisplayError, DisplayLoading } from "components/display_components";
import { queryKeys, useCandidates } from "utils/hooks/useShiftPilotQueries";
import { agencyDate, agencyHHmm, agencyInstant } from "utils/helper_functions/format";
import { proposalService } from "utils/services/api_services/shiftpilot_service";
import { getErrorMessage, getRuleResults } from "utils/services/api_services/apiClient";
import { showToast } from "utils/store/toastStore";
import { ProposedChange, RuleResult } from "utils/types";

// Pick another caregiver (from those who pass every rule) or another time.
// The server checks every rule again before it saves; a broken rule is shown here.
export const EditChangeDrawer = ({ proposalId, change, onClose }: { proposalId: string; change: ProposedChange; onClose: () => void }) => {
  const after = change.after!;
  const queryClient = useQueryClient();
  const { data: candidates, isLoading } = useCandidates(proposalId, change._id);
  const [caregiverCode, setCaregiverCode] = useState<string | null>(after.caregiverCode);
  const [date, setDate] = useState(agencyDate(after.start));
  const [startTime, setStartTime] = useState(agencyHHmm(after.start));
  const [endTime, setEndTime] = useState(agencyHHmm(after.end));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [broken, setBroken] = useState<RuleResult[]>([]);
  const canMove = change.kind === "move" || change.kind === "create";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setBroken([]);
    try {
      const input: { caregiverCode: string | null; start?: string; end?: string } = { caregiverCode };
      if (canMove) {
        input.start = agencyInstant(date, startTime);
        input.end = agencyInstant(date, endTime);
      }
      const response = await proposalService.edit(proposalId, change._id, input);
      queryClient.setQueryData(queryKeys.proposal(proposalId), response.data);
      showToast("Change updated. Every rule still passes.");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err));
      setBroken((getRuleResults(err) ?? []).filter((r) => !r.passed));
    } finally {
      setSaving(false);
    }
  };

  const options = [...(candidates ?? [])];
  if (after.caregiverCode && !options.some((c) => c.caregiverId === after.caregiverCode)) {
    options.unshift({ caregiverId: after.caregiverCode, name: "Keep the agent's pick", distanceKm: 0, visitsWithClient: 0, hoursLeftThisWeek: 0, facts: after.caregiverCode });
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="edit-title">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} aria-hidden />
      <form onSubmit={save} className="drawer-enter absolute right-0 top-0 flex h-full w-full max-w-md flex-col bg-sheet shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="edit-title" className="text-lg font-semibold">Edit this change</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-2 hover:bg-ink/5">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <fieldset>
            <legend className="field-label">Caregiver (only people who pass every rule are listed)</legend>
            {isLoading ? (
              <DisplayLoading label="Finding who is free" />
            ) : (
              <div className="flex flex-col gap-2">
                {options.map((candidate) => (
                  <label key={candidate.caregiverId} className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${caregiverCode === candidate.caregiverId ? "border-brand bg-brand-tint" : "border-line"}`}>
                    <input type="radio" name="caregiver" className="mt-1" checked={caregiverCode === candidate.caregiverId} onChange={() => setCaregiverCode(candidate.caregiverId)} />
                    <span>
                      <span className="block font-medium">{candidate.name}</span>
                      <span className="block text-xs text-ink-soft">{candidate.facts}</span>
                    </span>
                  </label>
                ))}
                <label className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2 ${caregiverCode === null ? "border-waiting bg-waiting-tint" : "border-line"}`}>
                  <input type="radio" name="caregiver" className="mt-1" checked={caregiverCode === null} onChange={() => setCaregiverCode(null)} />
                  <span className="font-medium">Leave it open for now</span>
                </label>
              </div>
            )}
          </fieldset>

          {canMove && (
            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="col-span-3">
                <label htmlFor="edit-date" className="field-label">Date</label>
                <input id="edit-date" type="date" className="field-input" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <label htmlFor="edit-start" className="field-label">Start</label>
                <input id="edit-start" type="time" step={900} className="field-input" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
              </div>
              <div className="col-span-3 sm:col-span-1">
                <label htmlFor="edit-end" className="field-label">End</label>
                <input id="edit-end" type="time" step={900} className="field-input" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
              </div>
              <p className="col-span-3 text-xs text-ink-faint">Denver (agency) time. Visits are whole 15-minute units.</p>
            </div>
          )}

          {error && (
            <div className="mt-5">
              <DisplayError message={error} />
              {broken.length > 1 && (
                <ul className="mt-2 list-disc pl-5 text-sm text-refused">
                  {broken.slice(1).map((rule) => (
                    <li key={rule.rule}>{rule.message}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <DisplayButton onClick={onClose}>Cancel</DisplayButton>
          <DisplayButton type="submit" variant="primary" loading={saving}>
            Check and save
          </DisplayButton>
        </div>
      </form>
    </div>
  );
};
