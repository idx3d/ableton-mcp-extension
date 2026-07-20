import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";

describe("ClipEditor CRUD", () => {
  let fake: FakeLive;
  let clips: ClipEditor;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }, { type: "audio" }]);
    await fake.createScenes(1);
    clips = new ClipEditor(fake);
  });

  it("creates audio clips with one undo step; rejects empty filePath", async () => {
    const clip = await clips.createAudioClip({
      trackId: "t2",
      sceneId: "s1",
      filePath: "/samples/beat.wav",
      name: "Beat",
    });
    expect(clip.kind).toBe("audio");
    expect(fake.undoSteps).toEqual(["create_audio_clip"]);
    await expect(
      clips.createAudioClip({ trackId: "t2", sceneId: "s1", filePath: "" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("updates clips, validating color and rejecting empty patches", async () => {
    const clip = await fake.createMidiClip("t1", "s1", 4, []);
    const updated = await clips.updateClip(clip.id, { name: "Hook", color: "#a1B2c3" });
    expect(updated).toMatchObject({ name: "Hook", color: "#a1B2c3" });
    await expect(clips.updateClip(clip.id, { color: "red" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(clips.updateClip(clip.id, {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual(["update_clip"]);
  });

  it("deletes clips all-or-nothing in one undo step", async () => {
    const a = await fake.createMidiClip("t1", "s1", 4, []);
    await expect(clips.deleteClips([a.id, "c9"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fake.undoSteps).toEqual([]);
    await clips.deleteClips([a.id]);
    expect(fake.undoSteps).toEqual(["delete_clips"]);
    await expect(clips.deleteClips([])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
