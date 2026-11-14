import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agencyService, proposalService, requestService } from "utils/services/api_services/shiftpilot_service";
import { getErrorMessage } from "utils/services/api_services/apiClient";
import { showToast } from "utils/store/toastStore";
import { ProposalStatus } from "utils/types";

// React Query hooks, one per screen need. Mutations refresh what they change.

export const queryKeys = {
  schedule: (from: string, to: string) => ["schedule", from, to] as const,
  caregivers: ["caregivers"] as const,
  clients: ["clients"] as const,
  options: ["request-options"] as const,
  proposal: (id: string) => ["proposal", id] as const,
  candidates: (id: string, changeId: string) => ["candidates", id, changeId] as const,
};

export function useSchedule(from: string, to: string) {
  return useQuery({ queryKey: queryKeys.schedule(from, to), queryFn: () => agencyService.schedule(from, to).then((r) => r.data) });
}

export function useCaregivers() {
  return useQuery({ queryKey: queryKeys.caregivers, queryFn: () => agencyService.caregivers().then((r) => r.data), staleTime: Infinity });
}

export function useClients() {
  return useQuery({ queryKey: queryKeys.clients, queryFn: () => agencyService.clients().then((r) => r.data), staleTime: Infinity });
}

/** Code -> name for caregivers and clients, so cards read "Priya Nair", not "CG-01". */
export function useNames() {
  const { data: caregivers } = useCaregivers();
  const { data: clients } = useClients();
  const names = new Map<string, string>();
  caregivers?.forEach((c) => names.set(c.code, c.name));
  clients?.forEach((c) => names.set(c.code, c.name));
  return (code: string | null | undefined) => (code ? names.get(code) ?? code : "Nobody (open)");
}

export function useRequestOptions() {
  return useQuery({ queryKey: queryKeys.options, queryFn: () => requestService.options().then((r) => r.data) });
}

const WAITING: ProposalStatus[] = ["applying", "pending_approval"];

export function useProposal(id: string) {
  return useQuery({
    queryKey: queryKeys.proposal(id),
    queryFn: () => proposalService.get(id).then((r) => r.data),
  });
}

/** While a plan waits in AgentGuard, check every 5 seconds (and when the tab comes back into view). */
export function useGuardStatus(id: string, status: ProposalStatus | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["guard-status", id],
    queryFn: async () => {
      const response = await proposalService.guardStatus(id);
      queryClient.setQueryData(queryKeys.proposal(id), response.data.proposal);
      if (response.data.proposal.status !== status) queryClient.invalidateQueries({ queryKey: ["schedule"] });
      return response.data.guard;
    },
    enabled: Boolean(status && status !== "draft"),
    refetchInterval: status && WAITING.includes(status) ? 5000 : false,
    refetchOnWindowFocus: true,
  });
}

export function useCandidates(id: string, changeId: string | null) {
  return useQuery({
    queryKey: queryKeys.candidates(id, changeId ?? ""),
    queryFn: () => proposalService.candidates(id, changeId!).then((r) => r.data),
    enabled: Boolean(changeId),
  });
}

function useProposalMutation<TVars>(id: string, run: (vars: TVars) => Promise<{ data: unknown }>, successMessage?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (response) => {
      const data = response.data as { proposal?: unknown };
      queryClient.setQueryData(queryKeys.proposal(id), data.proposal ?? data);
      queryClient.invalidateQueries({ queryKey: ["schedule"] });
      queryClient.invalidateQueries({ queryKey: ["guard-status", id] });
      if (successMessage) showToast(successMessage);
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useDecideChange(id: string) {
  return useProposalMutation(id, ({ changeId, decision }: { changeId: string; decision: "approve" | "reject" }) => proposalService.decide(id, changeId, decision));
}

export function useApproveAll(id: string) {
  return useProposalMutation(id, (changeIds?: string[]) => proposalService.approveAll(id, changeIds));
}

export function useApplyProposal(id: string) {
  return useProposalMutation(id, () => proposalService.apply(id));
}

/** Undo in ShiftPilot itself: only offered when AgentGuard is not connected or lost track of the plan. */
export function useUndoHere(id: string) {
  return useProposalMutation(id, () => proposalService.undo(id), "Plan undone. Every visit is back.");
}
