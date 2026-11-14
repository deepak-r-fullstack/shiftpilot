import { Request, Response } from "express";
import { z } from "zod";
import { successResponseWithData } from "../helpers/response";
import { getSandboxId } from "../middlewares/sandbox.middleware";
import { listAuthorizations, listCaregivers, listClients, listServices, listVisits } from "../services/scheduling/schedule.service";

export const scheduleQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    caregiverCode: z.string().trim().max(20).optional(),
    clientCode: z.string().trim().max(20).optional(),
  })
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= 62 * 24 * 3600 * 1000, {
    message: "Pick a range of at most two months.",
  });

export const authorizationsQuerySchema = z.object({ clientCode: z.string().trim().max(20).optional() });

export async function getSchedule(_req: Request, res: Response) {
  const query = res.locals.query as z.infer<typeof scheduleQuerySchema>;
  return successResponseWithData(res, "Visits.", await listVisits(getSandboxId(res), query));
}

export async function getCaregivers(_req: Request, res: Response) {
  return successResponseWithData(res, "Caregivers.", await listCaregivers(getSandboxId(res)));
}

export async function getClients(_req: Request, res: Response) {
  return successResponseWithData(res, "Clients.", await listClients(getSandboxId(res)));
}

export async function getServices(_req: Request, res: Response) {
  return successResponseWithData(res, "Services.", await listServices(getSandboxId(res)));
}

export async function getAuthorizations(_req: Request, res: Response) {
  const query = res.locals.query as z.infer<typeof authorizationsQuerySchema>;
  return successResponseWithData(res, "Authorizations.", await listAuthorizations(getSandboxId(res), query.clientCode));
}
