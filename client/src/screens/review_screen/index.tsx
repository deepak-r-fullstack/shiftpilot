import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { DisplayButton, DisplayError, DisplayLoading, DisplayPageHeader } from "components/display_components";
import { useApplyProposal, useApproveAll, useDecideChange, useGuardStatus, useNames, useProposal, useUndoHere } from "utils/hooks/useShiftPilotQueries";
import { agencyDate, formatLongDay, dateLabel, mondayOf } from "utils/helper_functions/format";
import { getErrorMessage } from "utils/services/api_services/apiClient";
import { ProposedChange } from "utils/types";
import { ApplyBar } from "./ApplyBar";
import { ChangeCard } from "./ChangeCard";
import { EditChangeDrawer } from "./EditChangeDrawer";

// Review the agent's plan: approve, edit or reject each change, then apply.
// Big plans (a whole schedule) are grouped by week, with "Approve this week".

const APPLIED = new Set(["approved", "edited", "auto_approved"]);
const BY_WEEK_AFTER = 14;

export const ReviewScreen = () => {
  const { id = "" } = useParams();
  const { data: proposal, isLoading, error, refetch } = useProposal(id);
  const { data: guard } = useGuardStatus(id, proposal?.status);
  const name = useNames();
  const decide = useDecideChange(id);
  const approveAll = useApproveAll(id);
  const apply = useApplyProposal(id);
  const undo = useUndoHere(id);
  const [editing, setEditing] = useState<ProposedChange | null>(null);

  const groups = useMemo(() => {
    if (!proposal) return [];
    const byWeek = proposal.changes.length > BY_WEEK_AFTER;
    const map = new Map<string, ProposedChange[]>();
    for (const change of proposal.changes) {
      const day = agencyDate((change.after ?? change.before)!.start);
      const key = byWeek ? mondayOf(day) : day;
      map.set(key, [...(map.get(key) ?? []), change]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, changes]) => ({ key, byWeek, changes }));
  }, [proposal]);

  if (isLoading) return <DisplayLoading label="Loading the plan" />;
  if (error || !proposal) return <DisplayError message={getErrorMessage(error)} onRetry={() => refetch()} />;

  const editable = proposal.status === "draft";
  const approvedCount = proposal.changes.filter((c) => APPLIED.has(c.decision)).length;
  const pendingCount = proposal.changes.filter((c) => c.decision === "pending").length;
  const busy = decide.isPending || approveAll.isPending || apply.isPending;

  return (
    <>
      <Link to="/schedule" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the schedule
      </Link>
      <DisplayPageHeader
        title="Review the plan"
        description={proposal.summary}
        actions={
          editable && pendingCount > 0 ? (
            <DisplayButton variant="primary" onClick={() => approveAll.mutate(undefined)} loading={approveAll.isPending}>
              Approve all {pendingCount}
            </DisplayButton>
          ) : undefined
        }
      />
      {editable && (
        <p className="-mt-3 mb-5 text-sm text-ink-soft">
          Every change below already passes every scheduling rule. Nothing changes in the schedule until you press Apply.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {groups.map((group) => {
          const openIds = group.changes.filter((c) => c.decision === "pending").map((c) => c._id);
          return (
            <section key={group.key} aria-label={group.byWeek ? `Week of ${group.key}` : group.key}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="font-serif text-lg">{group.byWeek ? `Week of ${dateLabel(group.key)}` : formatLongDay((group.changes[0].after ?? group.changes[0].before)!.start)}</h2>
                {group.byWeek && editable && openIds.length > 0 && (
                  <DisplayButton variant="secondary" disabled={busy} onClick={() => approveAll.mutate(openIds)}>
                    Approve this week ({openIds.length})
                  </DisplayButton>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {group.changes.map((change) => (
                  <ChangeCard
                    key={change._id}
                    change={change}
                    name={name}
                    editable={editable}
                    busy={busy}
                    onDecide={(decision) => decide.mutate({ changeId: change._id, decision })}
                    onEdit={() => setEditing(change)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <ApplyBar proposal={proposal} guard={guard} approvedCount={approvedCount} pendingCount={pendingCount} applying={apply.isPending} onApply={() => apply.mutate(undefined)}
        undoing={undo.isPending}
        onUndo={() => {
          if (window.confirm("Put every visit in this plan back the way it was?")) undo.mutate(undefined);
        }}
      />

      {editing && <EditChangeDrawer proposalId={id} change={editing} onClose={() => setEditing(null)} />}
    </>
  );
};
