import { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../helpers/errors";
import { readSession, Session } from "../services/session/session.service";

// The visitor's sandbox (from the session token) is kept on res.locals, like the
// signed-in user in AgentGuard. Every scheduling query is scoped by it.

export function getSession(res: Response): Session {
  const session = res.locals.session as Session | undefined;
  if (!session) throw new UnauthorizedError();
  return session;
}

export function getSandboxId(res: Response): string {
  return String(getSession(res).sandbox._id);
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

export async function authenticateSession(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearerToken(req);
    if (!token) throw new UnauthorizedError("Please start the demo first.");
    res.locals.session = await readSession(token);
    next();
  } catch (err) {
    next(err);
  }
}
