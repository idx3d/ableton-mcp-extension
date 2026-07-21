import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import type { Note } from "../../../src/port/types.js";

const NOTES: Note[] = [
  [36, 0, 0.5, 100], // kick
  [42, 0.5, 0.25, 60], // hat
  [42, 1.5, 0.25, 60], // hat
  [60, 2, 1, 90], // keys
];

describe("ClipEditor.editClipNotes", () => {
  let fake: FakeLive;
  let clips: ClipEditor;
  let clipId: string;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }, { type: "audio" }]);
    await fake.createScenes(1);
    clips = new ClipEditor(fake);
    clipId = (await fake.createMidiClip("t1", "s1", 4, NOTES)).id;
  });

  it("removes notes matching a pitch filter", async () => {
    const result = await clips.editClipNotes(clipId, {
      select: { pitchMin: 42, pitchMax: 42 },
      remove: true,
    });
    expect(result.noteCount).toBe(2);
    expect((await fake.getClip(clipId)).notes.map((n) => n[0])).toEqual([36, 60]);
    expect(fake.undoSteps).toEqual(["edit_clip_notes"]);
  });

  it("transforms only selected notes; time window is [startBeat, endBeat)", async () => {
    await clips.editClipNotes(clipId, {
      select: { startBeat: 0.5, endBeat: 2 },
      transform: { transpose: 12, velocityDelta: -10 },
    });
    expect((await fake.getClip(clipId)).notes).toEqual([
      [36, 0, 0.5, 100],
      [54, 0.5, 0.25, 50],
      [54, 1.5, 0.25, 50],
      [60, 2, 1, 90],
    ]);
  });

  it("clamps transform results to valid ranges", async () => {
    await clips.editClipNotes(clipId, {
      select: { pitchMin: 60 },
      transform: { transpose: 100, velocityDelta: 100, shiftBeats: -10 },
    });
    const keys = (await fake.getClip(clipId)).notes.find((n) => n[0] === 127);
    expect(keys).toEqual([127, 0, 1, 127]);
  });

  it("adds notes (validated) alongside existing ones", async () => {
    const result = await clips.editClipNotes(clipId, { add: [[48, 3, 0.5, 80]] });
    expect(result.noteCount).toBe(5);
    await expect(
      clips.editClipNotes(clipId, { add: [[200, 0, 1, 100]] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects no-action, remove+transform, and audio clips", async () => {
    await expect(clips.editClipNotes(clipId, {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      clips.editClipNotes(clipId, { remove: true, transform: { transpose: 1 } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const audio = await fake.createAudioClip("t2", "s1", "/x.wav");
    await expect(clips.editClipNotes(audio.id, { remove: true })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual([]);
  });

  it("preserves note extras through transforms", async () => {
    await fake.replaceClipNotes(clipId, [[42, 0, 0.25, 60, { prob: 0.7 }]]);
    await clips.editClipNotes(clipId, { transform: { transpose: 1 } });
    expect((await fake.getClip(clipId)).notes).toEqual([
      [43, 0, 0.25, 60, { prob: 0.7 }],
    ]);
  });
});
