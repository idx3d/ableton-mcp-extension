/**
 * The `ableton-mcp` stdio bridge. Runs OUTSIDE Live (never imports the Ableton
 * SDK — enforced by scripts/check-boundaries.mjs). It resolves the running
 * server's URL + token, then splices an MCP stdio client to the loopback HTTP
 * endpoint at the transport layer.
 */
import type { Readable, Writable } from "node:stream";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

export interface RunningBridge {
  close(): Promise<void>;
}

/**
 * Splices an MCP stdio client (over the given streams) to the loopback HTTP
 * endpoint. Both transports are transparent JSONRPCMessage pipes — no
 * Client/Server objects — so capabilities and tool lists pass through untouched.
 */
export async function runBridge(opts: {
  url: string;
  token: string;
  stdin: Readable;
  stdout: Writable;
}): Promise<RunningBridge> {
  const stdio = new StdioServerTransport(opts.stdin, opts.stdout);
  const http = new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
  });

  // NOTE: both transports' close() call onclose() SYNCHRONOUSLY before
  // returning (verified in the installed SDK: StreamableHTTPClientTransport
  // and StdioServerTransport both do `this.onclose?.()` with no preceding
  // `await`). Since onclose is wired to closeBoth below, a naive
  // `closing = Promise.allSettled([http.close(), stdio.close()])` would
  // re-enter closeBoth from within that same expression's evaluation —
  // before `closing` is assigned — recursing synchronously until the stack
  // overflows. Deferring the actual close() calls into a microtask (via
  // `Promise.resolve().then(...)`) guarantees `closing` is assigned first,
  // so the re-entrant call sees the guard and short-circuits.
  let closing: Promise<void> | undefined;
  const closeBoth = (): Promise<void> => {
    if (!closing) {
      closing = Promise.resolve().then(async () => {
        await Promise.allSettled([http.close(), stdio.close()]);
      });
    }
    return closing;
  };

  stdio.onmessage = (msg) =>
    void http
      .send(msg)
      .catch((err) => console.error("[ableton-mcp bridge] forward-to-http failed:", err));
  http.onmessage = (msg) =>
    void stdio
      .send(msg)
      .catch((err) => console.error("[ableton-mcp bridge] forward-to-stdio failed:", err));
  stdio.onclose = () => void closeBoth();
  http.onclose = () => void closeBoth();
  stdio.onerror = (err) => console.error("[ableton-mcp bridge] stdio error:", err);
  http.onerror = (err) => {
    if (closing || (err as { name?: string })?.name === "AbortError") return;
    console.error("[ableton-mcp bridge] http error:", err);
  };

  await http.start();
  try {
    await stdio.start();
  } catch (err) {
    await http.close();
    throw err;
  }

  return { close: () => closeBoth() };
}
