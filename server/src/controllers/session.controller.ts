import { Request, Response } from "express";
import { successResponseWithData } from "../helpers/response";
import { getSandboxId, getSession } from "../middlewares/sandbox.middleware";
import { resetSandbox } from "../services/demo/sandbox.service";
import { describeSandbox, startSession } from "../services/session/session.service";

export async function createSession(_req: Request, res: Response) {
  const session = await startSession();
  return successResponseWithData(res, "Your demo agency is ready.", session, 201);
}

export async function getCurrentSession(_req: Request, res: Response) {
  const { sandbox, coordinator } = getSession(res);
  return successResponseWithData(res, "Current session.", { sandbox: describeSandbox(sandbox), coordinator });
}

export async function resetSession(_req: Request, res: Response) {
  await resetSandbox(getSandboxId(res));
  return successResponseWithData(res, "Your demo agency is back to the start.", { reset: true });
}
