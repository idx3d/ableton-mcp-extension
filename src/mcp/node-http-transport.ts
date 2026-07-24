/**
 * A stateless MCP `Transport` backed only by `node:http` — no `@hono/node-server`
 * and no Web `Request`/`Response`/`Headers`. Ableton's Extension Host runs the
 * bundle in a stripped Node vm-context that lacks those web globals (see ADR
 * 0009 / the runtime notes), so the SDK's `StreamableHTTPServerTransport` cannot
 * load there. This transport speaks the subset of the Streamable HTTP wire
 * protocol we use — stateless, JSON responses, one MCP server per request — which
 * is enough for the real `StreamableHTTPClientTransport` on the other end.
 *
 * Lifecycle per HTTP POST: the caller connects a fresh `McpServer` to a fresh
 * instance (which sets `onmessage` and calls `start()`), then awaits
 * `handleHttpRequest(bodyText)`. Incoming JSON-RPC messages are delivered via
 * `onmessage`; the server's replies arrive through `send()` and are written to
 * the response once every request in the body has been answered. A body carrying
 * only notifications/responses (no request) gets `202 Accepted`.
 */
import type { ServerResponse } from "node:http";
import {
  isJSONRPCError,
  isJSONRPCRequest,
  isJSONRPCResponse,
  type JSONRPCMessage,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export class NodeHttpStatelessTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private readonly res: ServerResponse;
  private readonly pending = new Set<RequestId>();
  private readonly collected: JSONRPCMessage[] = [];
  private finished = false;
  private resolveDone!: () => void;
  private readonly done = new Promise<void>((resolve) => {
    this.resolveDone = resolve;
  });

  constructor(res: ServerResponse) {
    this.res = res;
  }

  async start(): Promise<void> {
    // Nothing to open — the HTTP request is already in flight.
  }

  /** The connected server sends replies (and only replies) here. */
  async send(message: JSONRPCMessage): Promise<void> {
    this.collected.push(message);
    if (isJSONRPCResponse(message) || isJSONRPCError(message)) {
      const id = message.id;
      if (id !== null && id !== undefined) this.pending.delete(id);
    }
    if (this.pending.size === 0) this.flushSuccess();
  }

  async close(): Promise<void> {
    // Settle `done` if we close before a reply was written (e.g. the client
    // aborted mid-request) so an awaiting `handleHttpRequest` never hangs.
    if (!this.finished) {
      this.finished = true;
      this.resolveDone();
    }
    this.onclose?.();
  }

  /**
   * Drive one HTTP request body through the connected server. Resolves once the
   * response has been written. Call after the server has connected (so
   * `onmessage` is wired).
   */
  handleHttpRequest(bodyText: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      this.writeError(-32700, "Parse error");
      return this.done;
    }

    const messages = (Array.isArray(parsed) ? parsed : [parsed]) as JSONRPCMessage[];
    for (const message of messages) {
      if (isJSONRPCRequest(message)) this.pending.add(message.id);
    }

    // No request means nothing to answer — accept and close.
    if (this.pending.size === 0) {
      for (const message of messages) this.deliver(message);
      this.writeAccepted();
      return this.done;
    }

    for (const message of messages) this.deliver(message);
    // flushSuccess() fires from send() once every pending request is answered.
    return this.done;
  }

  private deliver(message: JSONRPCMessage): void {
    try {
      this.onmessage?.(message);
    } catch (error) {
      this.onerror?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private flushSuccess(): void {
    if (this.finished) return;
    this.finished = true;
    const body = this.collected.length === 1 ? this.collected[0] : this.collected;
    this.res.writeHead(200, JSON_HEADERS).end(JSON.stringify(body));
    this.resolveDone();
  }

  private writeAccepted(): void {
    if (this.finished) return;
    this.finished = true;
    this.res.writeHead(202).end();
    this.resolveDone();
  }

  private writeError(code: number, message: string): void {
    if (this.finished) return;
    this.finished = true;
    const body = { jsonrpc: "2.0" as const, error: { code, message }, id: null };
    this.res.writeHead(200, JSON_HEADERS).end(JSON.stringify(body));
    this.resolveDone();
  }
}
