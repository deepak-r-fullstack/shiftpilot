import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { UnauthorizedError } from "../../helpers/errors";
import { Sandbox, SandboxDoc } from "../../models/sandbox.model";
import { createSandbox, SANDBOX_HOURS } from "../demo/sandbox.service";

// The demo has one coordinator. Signing in creates the visitor's own sandbox.
export const DEMO_COORDINATOR = { name: "Dana Lopez", email: "coordinator@sunrise.test", role: "Coordinator" } as const;

export interface SessionPayload {
  sandboxId: string;
}

export interface Session {
  sandbox: SandboxDoc;
  coordinator: typeof DEMO_COORDINATOR;
}

export function signSession(sandboxId: string): string {
  return jwt.sign({ sandboxId } satisfies SessionPayload, env.JWT_SECRET, { expiresIn: `${SANDBOX_HOURS}h` });
}

export async function startSession(today?: string) {
  const sandbox = await createSandbox(today);
  return { token: signSession(String(sandbox._id)), sandbox: describeSandbox(sandbox), coordinator: DEMO_COORDINATOR };
}

/** Reads a session token. Fails when the token is bad or the sandbox has expired. */
export async function readSession(token: string): Promise<Session> {
  let payload: SessionPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as SessionPayload;
  } catch {
    throw new UnauthorizedError("Your demo session has ended. Start a new one.");
  }
  const sandbox = await Sandbox.findById(payload.sandboxId).lean<SandboxDoc>();
  if (!sandbox || sandbox.expiresAt.getTime() < Date.now()) throw new UnauthorizedError("Your demo session has ended. Start a new one.");
  return { sandbox, coordinator: DEMO_COORDINATOR };
}

export function describeSandbox(sandbox: SandboxDoc) {
  return { id: String(sandbox._id), label: sandbox.label, expiresAt: sandbox.expiresAt };
}
