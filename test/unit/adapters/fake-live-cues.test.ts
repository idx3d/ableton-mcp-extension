import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive cue points", () => {
  let fake: FakeLive;
  beforeEach(() => {
    fake = new FakeLive();
  });

  it("getSet omits cues when there are none", async () => {
    expect("cues" in (await fake.getSet())).toBe(false);
  });

  it("addCues mints q-IDs, defaults names, and keeps cues time-sorted", async () => {
    const { addedCues } = await fake.updateSong({
      addCues: [{ timeBeats: 16, name: "Drop" }, { timeBeats: 0 }],
    });
    expect(addedCues).toEqual([
      { id: "q1", name: "Drop", timeBeats: 16 },
      { id: "q2", name: "Cue 2", timeBeats: 0 },
    ]);
    expect((await fake.getSet()).cues).toEqual([
      { id: "q2", name: "Cue 2", timeBeats: 0 },
      { id: "q1", name: "Drop", timeBeats: 16 },
    ]);
  });

  it("renames and deletes by ID", async () => {
    await fake.updateSong({ addCues: [{ timeBeats: 0 }, { timeBeats: 8 }] });
    await fake.updateSong({
      renameCues: [{ id: "q1", name: "Intro" }],
      deleteCueIds: ["q2"],
    });
    expect((await fake.getSet()).cues).toEqual([
      { id: "q1", name: "Intro", timeBeats: 0 },
    ]);
  });

  it("validates all cue IDs before mutating (all-or-nothing)", async () => {
    await fake.updateSong({ addCues: [{ timeBeats: 0, name: "Keep" }] });
    await expect(
      fake.updateSong({
        renameCues: [{ id: "q1", name: "Changed" }],
        deleteCueIds: ["q99"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fake.getSet()).cues).toEqual([
      { id: "q1", name: "Keep", timeBeats: 0 },
    ]);
  });
});
