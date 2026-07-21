import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import { validateNotes } from "../../../src/domain/notes.js";
import { SongService } from "../../../src/domain/song-service.js";
import { TrackService } from "../../../src/domain/track-service.js";
import type { Note } from "../../../src/port/types.js";

describe("validateNotes", () => {
  it("accepts valid notes with extras", () => {
    expect(() =>
      validateNotes([
        [60, 0, 1, 100],
        [61, 0.5, 0.25, 1, { prob: 0.5 }],
      ]),
    ).not.toThrow();
  });

  it.each([
    [[[-1, 0, 1, 100]] as Note[], "pitch"],
    [[[128, 0, 1, 100]] as Note[], "pitch"],
    [[[60, -0.5, 1, 100]] as Note[], "start"],
    [[[60, 0, 0, 100]] as Note[], "duration"],
    [[[60, 0, 1, 0]] as Note[], "velocity"],
    [[[60, 0, 1, 128]] as Note[], "velocity"],
  ])("rejects %j mentioning %s and the note index", (notes, field) => {
    expect(() => validateNotes(notes)).toThrowError(
      expect.objectContaining({
        code: "INVALID_INPUT",
        message: expect.stringContaining("note 0"),
      }),
    );
    expect(() => validateNotes(notes)).toThrowError(
      expect.objectContaining({ message: expect.stringContaining(field) }),
    );
  });
});

describe("services undo policy", () => {
  let fake: FakeLive;
  let tracks: TrackService;
  let clips: ClipEditor;
  let song: SongService;

  beforeEach(() => {
    fake = new FakeLive();
    tracks = new TrackService(fake);
    clips = new ClipEditor(fake);
    song = new SongService(fake);
  });

  it("each write is exactly one named undo step", async () => {
    await tracks.createTracks([{ type: "midi" }]);
    await tracks.createScenes(1);
    await clips.createMidiClip({
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [[60, 0, 1, 100]],
    });
    await clips.replaceClipNotes("c1", [[62, 0, 1, 90]]);
    await song.updateSong({ tempo: 130 });
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "create_scenes",
      "create_midi_clip",
      "replace_clip_notes",
      "update_song",
    ]);
  });

  it("deleteTracks is all-or-nothing: one stale ID mutates nothing", async () => {
    await tracks.createTracks([{ type: "midi" }, { type: "midi" }]);
    await expect(tracks.deleteTracks(["t1", "t99"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await fake.getSet()).tracks).toHaveLength(2);
    expect(fake.undoSteps).toEqual(["create_tracks"]);
  });

  it("rejects empty batches and bad counts without touching the port", async () => {
    await expect(tracks.createTracks([])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(tracks.createScenes(0)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual([]);
  });

  it("validates notes before creating a clip (no half-created clip)", async () => {
    await tracks.createTracks([{ type: "midi" }]);
    await tracks.createScenes(1);
    await expect(
      clips.createMidiClip({
        trackId: "t1",
        sceneId: "s1",
        lengthBeats: 4,
        notes: [[200, 0, 1, 100]],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await fake.getTrack("t1")).slots[0].clip).toBeNull();
  });

  it("rejects out-of-range tempo", async () => {
    await expect(song.updateSong({ tempo: 5 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("updateTrack returns the fresh summary", async () => {
    await tracks.createTracks([{ type: "midi" }]);
    const t = await tracks.updateTrack("t1", { name: "Lead" });
    expect(t.name).toBe("Lead");
  });
});
