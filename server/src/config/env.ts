import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

// Load env/<NODE_ENV>.env when it exists (same convention as AgentGuard).
// Values already set in the real environment always win, so production never reads a file.
const NODE_ENV = (process.env.NODE_ENV || "local").toLowerCase();
const envFile = path.join(process.cwd(), "env", `${NODE_ENV}.env`);
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile, quiet: true });
}

const DEV_JWT_SECRET = "shiftpilot-dev-only-secret-change-me";
const booleanText = (fallback: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.string().default("local"),
  PORT: z.coerce.number().int().positive().default(5070),
  MONGO_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/shiftpilot"),
  CLIENT_ORIGIN: z.string().default("http://localhost:5174"),
  JWT_SECRET: z.string().min(16).default(DEV_JWT_SECRET),
  DEMO_MODE: booleanText("true"),
  // Hosted demo: create the template agency on start when the database has none.
  SEED_ON_START: booleanText("false"),
  // The AI that plans schedule changes. "none" keeps the app working with recorded story runs only.
  LLM_PROVIDER: z.enum(["none", "anthropic", "openai"]).default("none"),
  LLM_MODEL: z.string().optional().default(""),
  LLM_API_KEY: z.string().optional().default(""),
  // Hard cap on AI spend per Denver day for the public demo.
  AI_DAILY_USD_CAP: z.coerce.number().min(0).default(1),
  // AgentGuard: where approved plans are applied (rules, audit trail, undo). Optional.
  AGENTGUARD_URL: z.string().optional().default(""),
  AGENTGUARD_PUBLIC_URL: z.string().optional().default(""),
  SHIFTPILOT_AGENT_KEY: z.string().optional().default(""),
  // Shared secret AgentGuard sends when it calls our internal plan endpoints.
  SHIFTPILOT_INTERNAL_SECRET: z.string().optional().default(""),
  // AgentReplay recording is optional: without a key, nothing is recorded and nothing is sent.
  AGENTREPLAY_API_KEY: z.string().optional().default(""),
  AGENTREPLAY_URL: z.string().optional().default(""),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast at boot with a readable list instead of a confusing error later.
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV.toLowerCase() === "production";
export const isTest = env.NODE_ENV.toLowerCase() === "test";
// Development-only conveniences (the dev JWT secret, FAKE_AI) work ONLY here, never on a host that forgot NODE_ENV.
export const isLocalOrTest = ["local", "test", "development"].includes(env.NODE_ENV.toLowerCase());

if (!isLocalOrTest && env.JWT_SECRET === DEV_JWT_SECRET) {
  console.error("JWT_SECRET must be set outside local development.");
  process.exit(1);
}
