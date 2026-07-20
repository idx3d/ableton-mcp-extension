import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../../src/port/types.js";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

const GROOVE: Note[] = [
  [36, 0, 0.5, 110],
  [42, 0.5, 0.25, 55],
  [38, 1, 0.5, 100],
  [42, 1.5, 0.25, 55],
  [36, 2, 0.5, 110],
  [42, 2.5, 0.25, 55],
  [38, 3, 0.5, 100],
  [42, 3.5, 0.25, 55],
];

describe("scenario: AI edits an existing set", () => {
  let stack: TestStack;
  let clipId: string;

  beforeEach(async () => {
    stack = await startTestStack();
    const { client } = stack;
    // Seed a small in-progress set through the tools themselves.
    await callTool(client, "create_tracks", {
      tracks: [
        { type: "midi", name: "Drums" },
        { type: "audio", name: "Vocal Chops" },
      ],
    });
    await callTool(client, "create_scenes", { count: 2 });
    const created = await callTool(client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: GROOVE,
      name: "Groove",
    });
    clipId = created.payload.clip.id;
    await callTool(client, "create_audio_clip", {
      trackId: "t2",
      sceneId: "s1",
      filePath: "/samples/chop.wav",
      name: "Chop",
    });
    await callTool(client, "insert_device", { trackId: "t1", device: "Compressor" });
    stack.fake.undoSteps.length = 0; // measure only the editing phase
  });

  afterEach(async () => {
    await stack.close();
  });

  it("describes, then performs targeted edits without collateral damage", async () => {
    const { client, fake } = stack;

    // 1. Describe: the set reads back accurately.
    const set = await callTool(client, "get_set");
    expect(set.payload.set.tracks.map((t: { name: string }) => t.name)).toEqual([
      "Drums",
      "Vocal Chops",
    ]);
    expect(set.payload.set.tracks[0].deviceNames).toEqual(["Compressor"]);

    // 2. Thin out the hats after beat 2 (filter-based edit, no full resend).
    const thin = await callTool(client, "edit_clip_notes", {
      clipId,
      select: { pitchMin: 42, pitchMax: 42, startBeat: 2 },
      remove: true,
    });
    expect(thin.payload.noteCount).toBe(6);

    // 3. Rename + color the clip; rename a scene; drop the unused scene.
    await callTool(client, "update_clip", {
      clipId,
      name: "Groove v2",
      color: "#22CC88",
    });
    await callTool(client, "update_scene", { sceneId: "s1", name: "Verse" });
    await callTool(client, "delete_scenes", { sceneIds: ["s2"] });

    // 4. Verify the deltas — and that nothing else changed.
    const clip = await callTool(client, "get_clip", { clipId });
    expect(clip.payload.clip).toMatchObject({ name: "Groove v2", color: "#22CC88" });
    expect(clip.payload.clip.notes.filter((n: Note) => n[0] === 42)).toHaveLength(2);
    expect(clip.payload.clip.notes.filter((n: Note) => n[0] === 36)).toHaveLength(2);

    const after = await callTool(client, "get_set");
    expect(after.payload.set.scenes).toEqual([{ id: "s1", name: "Verse" }]);
    expect(after.payload.set.tracks[1].clipCount).toBe(1); // audio clip untouched

    // 5. Data safety: exactly one named undo step per edit.
    expect(fake.undoSteps).toEqual([
      "edit_clip_notes",
      "update_clip",
      "update_scene",
      "delete_scenes",
    ]);
  });

  it("audio clip refuses note edits with a clear error", async () => {
    const { client } = stack;
    const track = await callTool(client, "get_track", { trackId: "t2" });
    const audioClipId = track.payload.track.slots[0].clip.id;
    const result = await callTool(client, "edit_clip_notes", {
      clipId: audioClipId,
      remove: true,
    });
    expect(result.isError).toBe(true);
    expect(result.payload).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(result.payload.hint).toContain("MIDI");
  });
});
