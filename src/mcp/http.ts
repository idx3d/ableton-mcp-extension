import {
  createServer as createNodeServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NodeHttpStatelessTransport } from "./node-http-transport.js";

export interface HttpOptions {
  /** 0 = let the OS pick (tests). Production default: 20808. */
  port: number;
  token: string;
  createServer(): McpServer;
}

export interface RunningHttpServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

function isLocal(value: string): boolean {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    return (
      LOCAL_HOSTS.includes(url.hostname) || LOCAL_HOSTS.includes(`[${url.hostname}]`)
    );
  } catch {
    return false;
  }
}

function deny(res: ServerResponse, status: number, message: string): void {
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify({ error: message }));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Stateless Streamable HTTP endpoint at /mcp, bound to 127.0.0.1 only.
 * Security (P2, per spec §7): loopback bind, Host/Origin validation, bearer token.
 */
export async function startHttpServer(opts: HttpOptions): Promise<RunningHttpServer> {
  const httpServer = createNodeServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const host = req.headers.host ?? "";
        const origin = req.headers.origin;
        if (!isLocal(host) || (origin !== undefined && !isLocal(origin))) {
          return deny(res, 403, "Forbidden: localhost only");
        }
        if (req.headers.authorization !== `Bearer ${opts.token}`) {
          return deny(res, 401, "Unauthorized: missing or invalid bearer token");
        }
        const url = new URL(req.url ?? "/", `http://${host}`);
        if (url.pathname !== "/mcp") {
          return deny(res, 404, "Not found");
        }
        // Stateless: only POST carries JSON-RPC. GET (SSE) / DELETE (session end)
        // have no meaning without sessions, so reject them like the SDK's own
        // stateless server does.
        if (req.method !== "POST") {
          return deny(res, 405, "Method not allowed");
        }

        // Stateless mode: fresh server + transport per request avoids session state.
        const mcpServer = opts.createServer();
        const transport = new NodeHttpStatelessTransport(res);
        res.on("close", () => {
          // Closing the transport settles its pending promise if the client
          // aborted before a reply (otherwise handleHttpRequest below hangs).
          transport
            .close()
            .catch((err) => console.error("[ableton-mcp] transport close error:", err));
          mcpServer
            .close()
            .catch((err) => console.error("[ableton-mcp] server close error:", err));
        });
        const body = await readBody(req);
        await mcpServer.connect(transport);
        await transport.handleHttpRequest(body);
      } catch (error) {
        console.error("[ableton-mcp] http error:", error);
        if (!res.headersSent) deny(res, 500, "Internal server error");
      }
    },
  );

  httpServer.on("error", (err) => {
    console.error("[ableton-mcp] http server error:", err);
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error) => reject(err);
    httpServer.once("error", onListenError);
    httpServer.listen(opts.port, "127.0.0.1", () => {
      httpServer.removeListener("error", onListenError);
      resolve();
    });
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
