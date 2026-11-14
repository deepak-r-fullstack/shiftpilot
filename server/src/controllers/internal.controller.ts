import { Request, Response } from "express";
import { successResponseWithData } from "../helpers/response";
import { planFacts, runPlan, undoPlan } from "../services/proposals/applyPlan.service";

// Called by AgentGuard only (shared secret). AgentGuard decides; we do the work.

export async function getPlanFacts(req: Request, res: Response) {
  return successResponseWithData(res, "Plan facts.", await planFacts(req.params.proposalId));
}

export async function runPlanNow(req: Request, res: Response) {
  return successResponseWithData(res, "Plan applied.", await runPlan(req.params.proposalId));
}

export async function undoPlanNow(req: Request, res: Response) {
  return successResponseWithData(res, "Plan undone.", await undoPlan(req.params.proposalId));
}
