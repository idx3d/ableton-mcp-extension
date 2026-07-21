import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive audio clips and clip update/delete", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([
      { type: "midi", name: "Keys" },
      { type: "audio", name: "Vox" },
    ]);
    await fake.createScenes(2);
  });

  it("creates an audio clip on an audio track", async () => {
    const clip = await fake.createAudioClip("t2", "s1", "/samples/loop.wav", "Loop");
    expect(clip).toMatchObject({
      id: "c1",
      kind: "audio",
      trackId: "t2",
      sceneId: "s1",
      name: "Loop",
      filePath: "/samples/loop.wav",
      lengthBeats: 4,
      looping: true,
      noteCount: 0,
    });
    expect(clip.notes).toEqual([]);
  });

  it("rejects audio clips on MIDI tracks and occupied slots", async () => {
    await expect(fake.createAudioClip("t1", "s1", "/x.wav")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await fake.createAudioClip("t2", "s1", "/x.wav");
    await expect(fake.createAudioClip("t2", "s1", "/y.wav")).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("MIDI clips report kind midi; audio clips reject note replacement", async () => {
    const midi = await fake.createMidiClip("t1", "s1", 4, [[60, 0, 1, 100]]);
    expect(midi.kind).toBe("midi");
    const audio = await fake.createAudioClip("t2", "s1", "/x.wav");
    await expect(
      fake.replaceClipNotes(audio.id, [[60, 0, 1, 100]]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("updates clip name, looping, color", async () => {
    const clip = await fake.createMidiClip("t1", "s1", 4, []);
    await fake.updateClip(clip.id, { name: "Theme", looping: false, color: "#FF5500" });
    const updated = await fake.getClip(clip.id);
    expect(updated).toMatchObject({ name: "Theme", looping: false, color: "#FF5500" });
    await expect(fake.updateClip("c9", { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("color is absent from summaries until set", async () => {
    const clip = await fake.createMidiClip("t1", "s1", 4, []);
    expect("color" in (await fake.getClip(clip.id))).toBe(false);
    await fake.updateClip(clip.id, { color: "#00AA33" });
    expect((await fake.getClip(clip.id)).color).toBe("#00AA33");
  });

  it("deletes clips across tracks all-or-nothing", async () => {
    const a = await fake.createMidiClip("t1", "s1", 4, []);
    const b = await fake.createAudioClip("t2", "s1", "/x.wav");
    await expect(fake.deleteClips([a.id, "c9"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await fake.getClip(a.id)).id).toBe(a.id); // nothing deleted
    await fake.deleteClips([a.id, b.id]);
    await expect(fake.getClip(a.id)).rejects.toThrow();
    expect((await fake.getTrack("t2")).slots[0].clip).toBeNull();
  });
});
