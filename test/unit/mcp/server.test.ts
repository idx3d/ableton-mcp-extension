import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import { SetInspector } from "../../../src/domain/set-inspector.js";
import { SongService } from "../../../src/domain/song-service.js";
import { TrackService } from "../../../src/domain/track-service.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import type { ToolDeps } from "../../../src/mcp/tools/types.js";

function buildDeps(fake: FakeLive): ToolDeps {
  return {
    inspector: new SetInspector(fake),
    tracks: new TrackService(fake),
    clips: new ClipEditor(fake),
    song: new SongService(fake),
  };
}

async function connect(fake: FakeLive): Promise<Client> {
  const server = createMcpServer(buildDeps(fake));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { payload: JSON.parse(res.content[0].text), isError: res.isError ?? false };
}

describe("MCP server over in-memory transport", () => {
  let fake: FakeLive;
  let client: Client;

  beforeEach(async () => {
    fake = new FakeLive();
    client = await connect(fake);
  });

  it("lists the 10 v1 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_midi_clip",
        "create_scenes",
        "create_tracks",
        "delete_tracks",
        "get_clip",
        "get_set",
        "get_track",
        "replace_clip_notes",
        "update_song",
        "update_track",
      ].sort(),
    );
  });

  it("get_set returns the snapshot in an ok envelope", async () => {
    const { payload, isError } = await call(client, "get_set");
    expect(isError).toBe(false);
    expect(payload.ok).toBe(true);
    expect(payload.set.tempo).toBe(120);
  });

  it("create_tracks → create_scenes → create_midi_clip round-trip", async () => {
    await call(client, "create_tracks", { tracks: [{ type: "midi", name: "Drums" }] });
    await call(client, "create_scenes", { count: 1 });
    const { payload } = await call(client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [[36, 0, 0.5, 100]],
      name: "Kick",
    });
    expect(payload.ok).toBe(true);
    expect(payload.clip.id).toBe("c1");
    expect(fake.undoSteps).toEqual(["create_tracks", "create_scenes", "create_midi_clip"]);
  });

  it("stale ID surfaces as structured NOT_FOUND with isError", async () => {
    const { payload, isError } = await call(client, "get_track", { trackId: "t9" });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(payload.hint).toContain("get_set");
  });
});
