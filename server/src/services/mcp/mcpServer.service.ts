import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { logger, serializeError } from "../../utils/logger";
import { createTools } from "../agent/tools";

// ---------------------------------------------------------------------------
// MCP front door: the same read-and-propose tools the built-in agent uses, so
// Claude Desktop, Claude Code or any MCP client can plan schedule changes in a
// visitor's demo agency. Nothing here applies a plan: that still needs the
// coordinator's review and AgentGuard. Stateless: a fresh server per request.
// ---------------------------------------------------------------------------

const READ_ONLY = new Set(["find_visits", "get_authorization", "find_candidates", "check_change", "build_schedule"]);
const EXPOSED = [...READ_ONLY, "submit_proposal"];

// Same reason as in AgentGuard: the SDK's generic registerTool() typing is too deep for TypeScript here.
type RegisterTool = (
  name: string,
  config: { title: string; description: string; inputSchema: z.ZodTypeAny; annotations: ToolAnnotations },
  handler: (args: Record<string, unknown>) => Promise<CallToolResult>
) => unknown;

interface ExposedTool {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
}

export function createMcpServer(sandboxId: string): McpServer {
  const server = new McpServer({ name: "shiftpilot", version: "1.0.0" });
  const tools = createTools({
    sandboxId,
    requestId: null,
    emit: () => undefined,
    state: { proposalId: null, proposalSummary: "", changeCount: 0, asked: false },
  }) as unknown as Record<string, ExposedTool>;

  for (const name of EXPOSED) {
    const definition = tools[name];
    (server.registerTool as unknown as RegisterTool).call(
      server,
      name,
      {
        title: name.replace(/_/g, " "),
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: { readOnlyHint: READ_ONLY.has(name), destructiveHint: false, idempotentHint: READ_ONLY.has(name), openWorldHint: false },
      },
      async (args) => {
        try {
          const output = await definition.execute(args);
          const failed = typeof output === "object" && output !== null && "error" in output;
          return { ...(failed ? { isError: true } : {}), content: [{ type: "text", text: JSON.stringify(output) }] };
        } catch (err) {
          logger.error("mcp tool call failed", { tool: name, ...serializeError(err) });
          return { isError: true, content: [{ type: "text", text: "The tool failed because of an unexpected error." }] };
        }
      }
    );
  }
  return server;
}
