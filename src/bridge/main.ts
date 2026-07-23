/**
 * CLI entry for the `ableton-mcp` stdio bridge (esbuild adds the shebang).
 * Resolves the running server, then pumps stdio <-> HTTP. All diagnostics go to
 * stderr — stdout is reserved for the MCP JSON-RPC stream.
 */
import { resolveConnection, runBridge } from "./bridge.js";

async function main(): Promise<void> {
  const { url, token } = resolveConnection();
  await runBridge({ url, token, stdin: process.stdin, stdout: process.stdout });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
