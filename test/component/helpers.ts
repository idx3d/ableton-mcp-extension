import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../src/domain/clip-editor.js";
import { SetInspector } from "../../src/domain/set-inspector.js";
import { SongService } from "../../src/domain/song-service.js";
import { TrackService } from "../../src/domain/track-service.js";
import { startHttpServer, type RunningHttpServer } from "../../src/mcp/http.js";
import { createMcpServer } from "../../src/mcp/server.js";

export const TEST_TOKEN = "component-test-token";

export interface TestStack {
  fake: FakeLive;
  server: RunningHttpServer;
  client: Client;
  close(): Promise<void>;
}

/** Full stack: real MCP client → real HTTP → real tools → real services → FakeLive. */
export async function startTestStack(fake = new FakeLive()): Promise<TestStack> {
  const server = await startHttpServer({
    port: 0,
    token: TEST_TOKEN,
    createServer: () =>
      createMcpServer({
        inspector: new SetInspector(fake),
        tracks: new TrackService(fake),
        clips: new ClipEditor(fake),
        song: new SongService(fake),
      }),
  });
  const client = new Client({ name: "component-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
    }),
  );
  return {
    fake,
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ payload: any; isError: boolean; bytes: number }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = res.content[0].text;
  return { payload: JSON.parse(text), isError: res.isError ?? false, bytes: text.length };
}
