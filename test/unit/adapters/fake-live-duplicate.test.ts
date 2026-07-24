import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive duplicate", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([
      { type: "midi", name: "Drums" },
      { type: "audio", name: "Vox" },
    ]);
    await fake.createScenes(2);
    await fake.createMidiClip("t1", "s1", 4, [[60, 0, 1, 100]], "Beat");
    await fake.insertDevice("t1", "Reverb");
  });

  it("duplicates a track with clips and devices, inserted after the source", async () => {
    const [copy] = await fake.createTracks([{ duplicateOf: "t1" }]);
    expect(copy.id).toBe("t3");
    expect(copy.name).toBe("Drums");
    expect(copy.deviceNames).toEqual(["Reverb"]);
    expect(copy.clipCount).toBe(1);
    expect((await fake.getSet()).tracks.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);
    // Cloned clip has a fresh ID and the same notes.
    const slot = (await fake.getTrack("t3")).slots.find((s) => s.clip !== null);
    expect(slot?.clip?.id).not.toBe((await fake.getTrack("t1")).slots[0].clip?.id);
  });

  it("validates every duplicateOf before creating anything", async () => {
    await expect(
      fake.createTracks([{ type: "midi" }, { duplicateOf: "t99" }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fake.getSet()).tracks).toHaveLength(2);
  });

  it("duplicates a scene with its clips, inserted after the source", async () => {
    const [copy] = await fake.createScenes(1, "s1");
    expect(copy).toEqual({ id: "s3", name: "Scene 1" });
    expect((await fake.getSet()).scenes.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    const slot = (await fake.getTrack("t1")).slots.find((s) => s.sceneId === "s3");
    expect(slot?.clip?.name).toBe("Beat");
  });

  it("duplicates a device after the original", async () => {
    const copy = await fake.duplicateDevice("d1");
    expect(copy.name).toBe("Reverb");
    expect(copy.id).toBe("d2");
    expect((await fake.getTrack("t1")).devices.map((d) => d.id)).toEqual(["d1", "d2"]);
  });
});
