import { Request, Response } from "express";
import { z } from "zod";
import { successResponseWithData } from "../helpers/response";
import { getSandboxId, getSession } from "../middlewares/sandbox.middleware";
import { applyProposal, describeGuard, refreshGuardStatus, undoHere } from "../services/proposals/apply.service";
import { wake } from "../services/integrations/agentGuard.client";
import { startRecording } from "../services/integrations/agentReplay";
import { approveAll, candidatesForChange, decideChange, editChange, getProposal } from "../services/proposals/proposal.service";

export const approveAllSchema = z.object({ changeIds: z.array(z.string().regex(/^[a-f0-9]{24}$/)).max(200).optional() });

export const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) });

export const editChangeSchema = z
  .object({
    caregiverCode: z.string().trim().max(20).nullable().optional(),
    start: z.string().datetime({ offset: true }).optional(),
    end: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine((edit) => Boolean(edit.start) === Boolean(edit.end), { message: "Give both a start and an end time." });

export async function getProposalById(req: Request, res: Response) {
  return successResponseWithData(res, "Plan.", await getProposal(getSandboxId(res), req.params.id));
}

export async function decide(req: Request, res: Response) {
  const { decision } = res.locals.body as z.infer<typeof decisionSchema>;
  const proposal = await decideChange(getSandboxId(res), req.params.id, req.params.changeId, decision);
  return successResponseWithData(res, decision === "approve" ? "Change approved." : "Change rejected.", proposal);
}

export async function approveAllChanges(req: Request, res: Response) {
  const { changeIds } = res.locals.body as z.infer<typeof approveAllSchema>;
  return successResponseWithData(res, "Open changes approved.", await approveAll(getSandboxId(res), req.params.id, changeIds));
}

export async function edit(req: Request, res: Response) {
  const input = res.locals.body as z.infer<typeof editChangeSchema>;
  const proposal = await editChange(getSandboxId(res), req.params.id, req.params.changeId, input);
  return successResponseWithData(res, "Change updated. Every rule still passes.", proposal);
}

export async function getCandidates(req: Request, res: Response) {
  return successResponseWithData(res, "Who could take this visit.", await candidatesForChange(getSandboxId(res), req.params.id, req.params.changeId));
}

export async function apply(req: Request, res: Response) {
  const { coordinator, sandbox } = getSession(res);
  const sandboxId = getSandboxId(res);
  const current = await getProposal(sandboxId, req.params.id);
  const recorder = current.status === "draft" ? startRecording(`Apply: ${current.summary}`, sandbox.label) : null;
  const proposal = await applyProposal(sandboxId, req.params.id, coordinator.email, recorder);
  return successResponseWithData(res, "Plan sent.", { proposal, guard: describeGuard(proposal) });
}

export async function getGuardStatus(req: Request, res: Response) {
  const proposal = await refreshGuardStatus(getSandboxId(res), req.params.id);
  return successResponseWithData(res, "Plan status.", { proposal, guard: describeGuard(proposal) });
}

export async function wakeAgentGuard(_req: Request, res: Response) {
  void wake();
  return successResponseWithData(res, "Waking the safety layer.", { ok: true });
}

export async function undo(req: Request, res: Response) {
  const proposal = await undoHere(getSandboxId(res), req.params.id);
  return successResponseWithData(res, "Plan undone. Every visit is back.", { proposal, guard: describeGuard(proposal) });
}
