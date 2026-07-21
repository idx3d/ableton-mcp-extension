import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { TrackService } from "../../../src/domain/track-service.js";

describe("TrackService scenes", () => {
  let fake: FakeLive;
  let tracks: TrackService;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createScenes(2);
    tracks = new TrackService(fake);
  });

  it("renames a scene in one undo step and returns the fresh summary", async () => {
    const scene = await tracks.updateScene("s1", { name: "Intro" });
    expect(scene).toEqual({ id: "s1", name: "Intro" });
    expect(fake.undoSteps).toEqual(["update_scene"]);
    await expect(tracks.updateScene("s1", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(tracks.updateScene("s9", { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes scenes all-or-nothing in one undo step", async () => {
    await expect(tracks.deleteScenes(["s1", "s9"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await fake.getSet()).scenes).toHaveLength(2);
    await tracks.deleteScenes(["s1", "s2"]);
    expect((await fake.getSet()).scenes).toEqual([]);
    expect(fake.undoSteps).toEqual(["delete_scenes"]);
    await expect(tracks.deleteScenes([])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
