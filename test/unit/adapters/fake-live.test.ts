import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { PortError } from "../../../src/port/errors.js";

describe("FakeLive tracks & scenes", () => {
  let fake: FakeLive;
  beforeEach(() => {
    fake = new FakeLive();
  });

  it("starts as an empty set", async () => {
    const set = await fake.getSet();
    expect(set.tempo).toBe(120);
    expect(set.tracks).toEqual([]);
    expect(set.scenes).toEqual([]);
  });

  it("creates tracks with minted sequential IDs and defaults", async () => {
    const created = await fake.createTracks([
      { type: "midi", name: "Drums" },
      { type: "audio" },
    ]);
    expect(created.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(created[0]).toMatchObject({
      name: "Drums",
      type: "midi",
      muted: false,
      soloed: false,
      armed: false,
      deviceNames: [],
      clipCount: 0,
    });
    expect(created[1].name).toBe("Audio 2"); // default name: "<Type> <n>"
    expect((await fake.getSet()).tracks).toHaveLength(2);
  });

  it("updates a track and rejects stale IDs", async () => {
    await fake.createTracks([{ type: "midi" }]);
    await fake.updateTrack("t1", { name: "Bass", muted: true });
    const t = await fake.getTrack("t1");
    expect(t.name).toBe("Bass");
    expect(t.muted).toBe(true);

    await expect(fake.updateTrack("t99", { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes tracks; deleted IDs are never reused", async () => {
    await fake.createTracks([{ type: "midi" }, { type: "midi" }]);
    await fake.deleteTracks(["t1"]);
    expect((await fake.getSet()).tracks.map((t) => t.id)).toEqual(["t2"]);
    await expect(fake.getTrack("t1")).rejects.toThrow(PortError);
    const [t3] = await fake.createTracks([{ type: "midi" }]);
    expect(t3.id).toBe("t3");
  });

  it("creates scenes and updates tempo", async () => {
    const scenes = await fake.createScenes(2);
    expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    await fake.updateSong({ tempo: 91.5 });
    expect((await fake.getSet()).tempo).toBe(91.5);
  });

  it("records one undo step per transact call", async () => {
    await fake.transact("create_tracks", () =>
      fake.createTracks([{ type: "midi" }, { type: "audio" }]),
    );
    expect(fake.undoSteps).toEqual(["create_tracks"]);
  });
});
