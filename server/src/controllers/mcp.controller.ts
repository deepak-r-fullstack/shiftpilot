import { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getSandboxId } from "../middlewares/sandbox.middleware";
import { createMcpServer } from "../services/mcp/mcpServer.service";

// Stateless MCP over HTTP, like AgentGuard: a fresh server and transport per request, plain JSON replies.
export async function handleMcpRequest(req: Request, res: Response) {
  const server = createMcpServer(getSandboxId(res));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

export function rejectMcpMethod(_req: Request, res: Response) {
  res.setHeader("Allow", "POST");
  return res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Send MCP requests with POST." }, id: null });
}
