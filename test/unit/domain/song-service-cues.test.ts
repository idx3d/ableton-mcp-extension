import { describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { SongService } from "../../../src/domain/song-service.js";

describe("SongService cue validation", () => {
  it("rejects negative timeBeats before touching the set", async () => {
    const fake = new FakeLive();
    const service = new SongService(fake);
    await expect(
      service.updateSong({ addCues: [{ timeBeats: -1 }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.undoSteps).toEqual([]);
  });

  it("rejects empty rename names", async () => {
    const service = new SongService(new FakeLive());
    await expect(
      service.updateSong({ renameCues: [{ id: "q1", name: "  " }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("adds cues inside one update_song undo step and returns minted refs", async () => {
    const fake = new FakeLive();
    const service = new SongService(fake);
    const { addedCues } = await service.updateSong({
      tempo: 100,
      addCues: [{ timeBeats: 4, name: "Verse" }],
    });
    expect(addedCues).toEqual([{ id: "q1", name: "Verse", timeBeats: 4 }]);
    expect(fake.undoSteps).toEqual(["update_song"]);
  });
});
