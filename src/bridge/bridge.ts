/**
 * The `ableton-mcp` stdio bridge. Runs OUTSIDE Live (never imports the Ableton
 * SDK — enforced by scripts/check-boundaries.mjs). It resolves the running
 * server's URL + token, then splices an MCP stdio client to the loopback HTTP
 * endpoint at the transport layer.
 */
import { readConnectionFile, type ConnectionInfo } from "../shell/connection-file.js";

export interface Connection {
  url: string;
  token: string;
}

/** env (URL or PORT + TOKEN) wins; else the connection file; else a hint error. */
export function resolveConnection(
  env: NodeJS.ProcessEnv = process.env,
  readFile: () => ConnectionInfo | undefined = readConnectionFile,
): Connection {
  const token = env.ABLETON_MCP_TOKEN;
  if (env.ABLETON_MCP_URL && token) {
    return { url: env.ABLETON_MCP_URL, token };
  }
  if (env.ABLETON_MCP_PORT && token) {
    return { url: `http://127.0.0.1:${env.ABLETON_MCP_PORT}/mcp`, token };
  }
  const fromFile = readFile();
  if (fromFile) {
    return { url: fromFile.url, token: fromFile.token };
  }
  throw new Error(
    "No Ableton MCP connection found. In Ableton Live, right-click a Scene in " +
      "Session view and choose 'Ableton MCP: Status…' to confirm the extension " +
      "is running, or set ABLETON_MCP_URL and ABLETON_MCP_TOKEN.",
  );
}
