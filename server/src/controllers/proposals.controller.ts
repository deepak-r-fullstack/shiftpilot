import { Request, Response } from "express";
import { z } from "zod";
import { successResponseWithData } from "../helpers/response";
import { getSandboxId } from "../middlewares/sandbox.middleware";
import { approveAll, candidatesForChange, decideChange, editChange, getProposal } from "../services/proposals/proposal.service";

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
  return successResponseWithData(res, "All open changes approved.", await approveAll(getSandboxId(res), req.params.id));
}

export async function edit(req: Request, res: Response) {
  const input = res.locals.body as z.infer<typeof editChangeSchema>;
  const proposal = await editChange(getSandboxId(res), req.params.id, req.params.changeId, input);
  return successResponseWithData(res, "Change updated. Every rule still passes.", proposal);
}

export async function getCandidates(req: Request, res: Response) {
  return successResponseWithData(res, "Who could take this visit.", await candidatesForChange(getSandboxId(res), req.params.id, req.params.changeId));
}
