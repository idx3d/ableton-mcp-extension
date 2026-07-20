import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool } from "./envelope.js";
import { allTools } from "./tools/index.js";
import type { ToolDeps } from "./tools/types.js";

/**
 * Builds a fresh McpServer wired to the given services. The HTTP layer creates
 * one per request (stateless Streamable HTTP); dev:fake creates one per session.
 */
export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "ableton-live", version: "0.1.0" });
  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await runTool(() => tool.handler(args ?? {}, deps));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: result.ok === false,
        };
      },
    );
  }
  return server;
}
