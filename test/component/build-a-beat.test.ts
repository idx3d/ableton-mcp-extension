import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../../src/port/types.js";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

const DRUMS: Note[] = [
  [36, 0, 0.25, 110],
  [42, 0.5, 0.25, 70],
  [38, 1, 0.25, 100],
  [42, 1.5, 0.25, 70],
  [36, 2, 0.25, 110],
  [42, 2.5, 0.25, 70],
  [38, 3, 0.25, 100],
  [42, 3.5, 0.25, 70, { prob: 0.85 }],
];
const BASS: Note[] = [
  [36, 0, 1, 100],
  [36, 1.5, 0.5, 90],
  [43, 2, 1, 100],
  [41, 3, 1, 95],
];

describe("scenario: AI builds a beat from an empty set", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack();
  });
  afterEach(async () => {
    await stack.close();
  });

  it("creates tracks, scenes, clips with notes, and sets the tempo", async () => {
    const { client, fake } = stack;

    const created = await callTool(client, "create_tracks", {
      tracks: [
        { type: "midi", name: "Drums" },
        { type: "midi", name: "Bass" },
      ],
    });
    expect(created.payload.ok).toBe(true);
    const [drums, bass] = created.payload.tracks;

    await callTool(client, "create_scenes", { count: 2 });
    await callTool(client, "update_song", { tempo: 124 });

    const drumClip = await callTool(client, "create_midi_clip", {
      trackId: drums.id,
      sceneId: "s1",
      lengthBeats: 4,
      notes: DRUMS,
      name: "Beat A",
    });
    expect(drumClip.payload.ok).toBe(true);

    const bassClip = await callTool(client, "create_midi_clip", {
      trackId: bass.id,
      sceneId: "s1",
      lengthBeats: 4,
      notes: BASS,
      name: "Bassline",
    });
    expect(bassClip.payload.ok).toBe(true);

    // the set reflects everything
    const { payload: setPayload } = await callTool(client, "get_set");
    expect(setPayload.set.tempo).toBe(124);
    expect(setPayload.set.tracks).toHaveLength(2);
    expect(setPayload.set.tracks[0]).toMatchObject({ name: "Drums", clipCount: 1 });

    // notes round-trip exactly
    const { payload: clipPayload } = await callTool(client, "get_clip", {
      clipId: drumClip.payload.clip.id,
    });
    expect(clipPayload.clip.notes).toEqual(DRUMS);

    // data safety: one undo step per write tool call, named after the tool
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "create_scenes",
      "update_song",
      "create_midi_clip",
      "create_midi_clip",
    ]);
  });

  it("recovers from a stale ID mid-flow", async () => {
    const { client } = stack;
    await callTool(client, "create_tracks", { tracks: [{ type: "midi" }] });
    await callTool(client, "create_scenes", { count: 1 });
    await callTool(client, "delete_tracks", { trackIds: ["t1"] });

    const stale = await callTool(client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [],
    });
    expect(stale.isError).toBe(true);
    expect(stale.payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(stale.payload.hint).toContain("get_set");
  });
});
