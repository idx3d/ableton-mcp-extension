import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { NodeHttpStatelessTransport } from "../../../src/mcp/node-http-transport.js";

function fakeRes(): { res: ServerResponse; calls: { status?: number; body?: string } } {
  const calls: { status?: number; body?: string } = {};
  const res = {
    writeHead(status: number) {
      calls.status = status;
      return res;
    },
    end(body?: string) {
      calls.body = body;
    },
  };
  return { res: res as unknown as ServerResponse, calls };
}

describe("NodeHttpStatelessTransport", () => {
  it("settles handleHttpRequest when closed before a reply (client abort)", async () => {
    const { res } = fakeRes();
    const t = new NodeHttpStatelessTransport(res);
    // A request whose id nothing answers (no server connected) — done stays
    // pending until close() settles it.
    const pending = t.handleHttpRequest('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    await t.close();
    await expect(pending).resolves.toBeUndefined();
  });

  it("202-accepts a notification-only body", async () => {
    const { res, calls } = fakeRes();
    const t = new NodeHttpStatelessTransport(res);
    await t.handleHttpRequest('{"jsonrpc":"2.0","method":"notifications/x"}');
    expect(calls.status).toBe(202);
  });

  it("returns a JSON-RPC parse error for invalid JSON", async () => {
    const { res, calls } = fakeRes();
    const t = new NodeHttpStatelessTransport(res);
    await t.handleHttpRequest("{not json");
    expect(calls.status).toBe(200);
    expect(JSON.parse(calls.body ?? "{}").error.code).toBe(-32700);
  });

  it("delivers requests and writes the collected response", async () => {
    const { res, calls } = fakeRes();
    const t = new NodeHttpStatelessTransport(res);
    // Stand in for the server: answer each request via send().
    t.onmessage = (msg) => {
      const id = (msg as { id: number }).id;
      void t.send({ jsonrpc: "2.0", id, result: { ok: true } });
    };
    await t.handleHttpRequest('{"jsonrpc":"2.0","id":7,"method":"ping"}');
    expect(calls.status).toBe(200);
    expect(JSON.parse(calls.body ?? "{}")).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { ok: true },
    });
  });
});
