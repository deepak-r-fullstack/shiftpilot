import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { UnauthorizedError } from "../helpers/errors";

// AgentGuard calls our internal plan endpoints with a shared secret.
// Compared in constant time; with no secret configured, the endpoints are closed.
export function requireInternalSecret(req: Request, _res: Response, next: NextFunction) {
  const expected = env.SHIFTPILOT_INTERNAL_SECRET;
  const given = String(req.headers["x-shiftpilot-secret"] ?? "");
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new UnauthorizedError("Not allowed."));
  }
  return next();
}
