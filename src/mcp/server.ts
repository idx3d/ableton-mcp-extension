import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool } from "./envelope.js";
import { allTools } from "./tools/index.js";
import type { ToolDeps } from "./tools/types.js";

/** What onToolResult receives for each completed tool call. */
export interface ToolResultReport {
  tool: string;
  ok: boolean;
  code?: string;
  durationMs: number;
}

export interface ServerOptions {
  /**
   * Optional hook invoked after every tool call resolves (the shell wires the
   * audit log here). Left unset by tests and dev:fake — the server is fully
   * functional without it.
   */
  onToolResult?(report: ToolResultReport): void;
}

/**
 * Builds a fresh McpServer wired to the given services. The HTTP layer creates
 * one per request (stateless Streamable HTTP); dev:fake creates one per session.
 */
export function createMcpServer(deps: ToolDeps, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "ableton-live", version: "0.1.0" });
  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const start = performance.now();
        const result = await runTool(() => tool.handler(args ?? {}, deps));
        options.onToolResult?.({
          tool: tool.name,
          ok: result.ok,
          code: result.ok === false ? result.code : undefined,
          durationMs: Math.round((performance.now() - start) * 1000) / 1000,
        });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: result.ok === false,
        };
      },
    );
  }
  return server;
}
