import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import type { Note } from "../../../src/port/types.js";

const KICK: Note[] = [
  [36, 0, 0.5, 100],
  [36, 1, 0.5, 100],
  [36, 2, 0.5, 100],
  [36, 3, 0.5, 100, { prob: 0.8 }],
];

describe("FakeLive MIDI clips", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }, { type: "audio" }]);
    await fake.createScenes(2);
  });

  it("creates a MIDI clip with notes in a session slot", async () => {
    const clip = await fake.createMidiClip("t1", "s1", 4, KICK, "Kick");
    expect(clip).toMatchObject({
      id: "c1",
      trackId: "t1",
      sceneId: "s1",
      name: "Kick",
      lengthBeats: 4,
      looping: true,
      noteCount: 4,
    });
    expect(fake.getClip("c1").notes).toEqual(KICK);
    expect(fake.getTrack("t1").slots[0].clip?.id).toBe("c1");
    expect(fake.getSet().tracks[0].clipCount).toBe(1);
  });

  it("rejects a clip in an occupied slot with CONFLICT", async () => {
    await fake.createMidiClip("t1", "s1", 4, []);
    await expect(fake.createMidiClip("t1", "s1", 4, [])).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects MIDI clips on audio tracks", async () => {
    await expect(fake.createMidiClip("t2", "s1", 4, [])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects unknown track and scene IDs", async () => {
    await expect(fake.createMidiClip("t9", "s1", 4, [])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(fake.createMidiClip("t1", "s9", 4, [])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("replaces notes wholesale", async () => {
    await fake.createMidiClip("t1", "s1", 4, KICK);
    const hats: Note[] = [[42, 0.5, 0.25, 70]];
    await fake.replaceClipNotes("c1", hats);
    expect(fake.getClip("c1").notes).toEqual(hats);
    await expect(fake.replaceClipNotes("c9", hats)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleting a track removes its clips", async () => {
    await fake.createMidiClip("t1", "s1", 4, KICK);
    await fake.deleteTracks(["t1"]);
    expect(() => fake.getClip("c1")).toThrow();
  });
});
