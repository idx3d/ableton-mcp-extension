import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../src/domain/clip-editor.js";
import { DeviceService } from "../../src/domain/device-service.js";
import { MixerService } from "../../src/domain/mixer-service.js";
import { SetInspector } from "../../src/domain/set-inspector.js";
import { SongService } from "../../src/domain/song-service.js";
import { TrackService } from "../../src/domain/track-service.js";
import { startHttpServer } from "../../src/mcp/http.js";
import { createMcpServer } from "../../src/mcp/server.js";

const TOKEN = "test-token-123";

function makeServerFactory(fake: FakeLive) {
  return () =>
    createMcpServer({
      inspector: new SetInspector(fake),
      tracks: new TrackService(fake),
      clips: new ClipEditor(fake),
      song: new SongService(fake),
      devices: new DeviceService(fake),
      mixer: new MixerService(fake),
    });
}

describe("HTTP transport", () => {
  let fake: FakeLive;
  let server: Awaited<ReturnType<typeof startHttpServer>>;

  beforeEach(async () => {
    fake = new FakeLive();
    server = await startHttpServer({
      port: 0,
      token: TOKEN,
      createServer: makeServerFactory(fake),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("serves an MCP client end-to-end with the right token", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBe(22);
    await client.close();
  });

  it("rejects a missing token with 401", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-localhost Origin with 403 (DNS-rebinding defense)", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(403);
  });

  it("404s unknown paths", async () => {
    const base = server.url.replace(/\/mcp$/, "/other");
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});
