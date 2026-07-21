import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive scene update/delete", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }]);
    await fake.createScenes(3);
  });

  it("renames a scene and rejects stale IDs", async () => {
    await fake.updateScene("s2", { name: "Drop" });
    expect((await fake.getSet()).scenes[1]).toEqual({ id: "s2", name: "Drop" });
    await expect(fake.updateScene("s9", { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes scenes with their clips, all-or-nothing", async () => {
    const clip = await fake.createMidiClip("t1", "s2", 4, [[60, 0, 1, 100]]);
    await expect(fake.deleteScenes(["s1", "s9"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await fake.getSet()).scenes).toHaveLength(3); // nothing deleted
    await fake.deleteScenes(["s1", "s2"]);
    expect((await fake.getSet()).scenes.map((s) => s.id)).toEqual(["s3"]);
    await expect(fake.getClip(clip.id)).rejects.toThrow(); // clip went with its scene
    expect((await fake.getTrack("t1")).slots).toHaveLength(1);
    const [s4] = await fake.createScenes(1);
    expect(s4.id).toBe("s4"); // IDs never reused
  });
});
