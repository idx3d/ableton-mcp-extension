import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import { DeviceService } from "../../../src/domain/device-service.js";
import { MixerService } from "../../../src/domain/mixer-service.js";
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
    devices: new DeviceService(fake),
    mixer: new MixerService(fake),
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

  it("lists the 21 v1 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_audio_clip",
        "create_midi_clip",
        "create_scenes",
        "create_tracks",
        "delete_clips",
        "delete_device",
        "delete_scenes",
        "delete_tracks",
        "edit_clip_notes",
        "get_clip",
        "get_device",
        "get_set",
        "get_track",
        "insert_device",
        "replace_clip_notes",
        "set_device_params",
        "set_mixer",
        "update_clip",
        "update_scene",
        "update_song",
        "update_track",
      ].sort(),
    );
  });

  it("edit_clip_notes round-trip returns only clipId and noteCount", async () => {
    await call(client, "create_tracks", { tracks: [{ type: "midi" }] });
    await call(client, "create_scenes", { count: 1 });
    const created = await call(client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [
        [36, 0, 0.5, 100],
        [42, 0.5, 0.25, 60],
      ],
    });
    const edited = await call(client, "edit_clip_notes", {
      clipId: created.payload.clip.id,
      select: { pitchMin: 42 },
      remove: true,
    });
    expect(edited.payload).toEqual({
      ok: true,
      clipId: created.payload.clip.id,
      noteCount: 1,
    });
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
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "create_scenes",
      "create_midi_clip",
    ]);
  });

  it("stale ID surfaces as structured NOT_FOUND with isError", async () => {
    const { payload, isError } = await call(client, "get_track", { trackId: "t9" });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(payload.hint).toContain("get_set");
  });

  it("device round-trip: insert, tweak, read, mixer", async () => {
    await call(client, "create_tracks", { tracks: [{ type: "midi", name: "Pad" }] });
    const inserted = await call(client, "insert_device", {
      trackId: "t1",
      device: "Reverb",
    });
    expect(inserted.payload.ok).toBe(true);
    const deviceId = inserted.payload.device.id;

    const tweaked = await call(client, "set_device_params", {
      deviceId,
      params: { "Dry/Wet": 0.25 },
    });
    expect(tweaked.payload).toMatchObject({
      ok: true,
      deviceId,
      changed: { "Dry/Wet": 0.25 },
    });

    const detail = await call(client, "get_device", { deviceId });
    expect(
      detail.payload.device.params.find((p: { name: string }) => p.name === "Dry/Wet")
        .value,
    ).toBe(0.25);

    const mixed = await call(client, "set_mixer", {
      updates: [{ trackId: "t1", volume: 0.5, sends: [{ returnId: "r1", value: 0.2 }] }],
    });
    expect(mixed.payload).toMatchObject({ ok: true, updated: ["t1"] });
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "insert_device",
      "set_device_params",
      "set_mixer",
    ]);
  });
});
