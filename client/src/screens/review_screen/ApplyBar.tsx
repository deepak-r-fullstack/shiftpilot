import { ExternalLink, Send } from "lucide-react";
import { DisplayBadge, DisplayButton, Tone } from "components/display_components";
import { GuardInfo, Proposal, ProposalStatus } from "utils/types";

// The bottom of the review: send the approved changes, then follow what AgentGuard decided.

const STATUS: Record<ProposalStatus, { label: string; tone: Tone }> = {
  draft: { label: "Not applied yet", tone: "neutral" },
  applying: { label: "Sending to AgentGuard", tone: "waiting" },
  applied: { label: "Applied", tone: "done" },
  pending_approval: { label: "Waiting for a manager in AgentGuard", tone: "waiting" },
  denied: { label: "Refused by a rule", tone: "refused" },
  undone: { label: "Undone", tone: "undone" },
  failed: { label: "Failed", tone: "refused" },
};

interface ApplyBarProps {
  proposal: Proposal;
  guard: GuardInfo | undefined;
  approvedCount: number;
  pendingCount: number;
  applying: boolean;
  onApply: () => void;
}

export const ApplyBar = ({ proposal, guard, approvedCount, pendingCount, applying, onApply }: ApplyBarProps) => {
  const status = STATUS[proposal.status];
  const guardUrl = guard?.guardUrl;
  const linkLabel = proposal.status === "applied" ? "Undo in AgentGuard" : proposal.status === "pending_approval" ? "Open in AgentGuard" : "See it in AgentGuard";

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-line bg-sheet/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <DisplayBadge tone={status.tone}>{status.label}</DisplayBadge>
          {proposal.status === "draft" ? (
            <span className="text-ink-soft">
              {approvedCount} approved{pendingCount > 0 ? `, ${pendingCount} still waiting for you` : ""}
            </span>
          ) : (
            proposal.guardMessage && <span className="text-ink-soft">{proposal.guardMessage}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {guardUrl && (
            <a href={guardUrl} target="_blank" rel="noreferrer">
              <DisplayButton variant="secondary" icon={<ExternalLink className="h-4 w-4" />}>
                {linkLabel}
              </DisplayButton>
            </a>
          )}
          {proposal.status === "draft" && (
            <DisplayButton variant="primary" size="lg" disabled={approvedCount === 0} loading={applying} onClick={onApply} icon={<Send className="h-4 w-4" />}>
              Apply {approvedCount} approved change{approvedCount === 1 ? "" : "s"}
            </DisplayButton>
          )}
        </div>
      </div>
    </div>
  );
};
