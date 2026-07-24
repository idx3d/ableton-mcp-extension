import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { DeviceService } from "../../../src/domain/device-service.js";
import { TrackService } from "../../../src/domain/track-service.js";

describe("duplicate via services", () => {
  let fake: FakeLive;
  let tracks: TrackService;
  let devices: DeviceService;
  beforeEach(async () => {
    fake = new FakeLive();
    tracks = new TrackService(fake);
    devices = new DeviceService(fake);
    await tracks.createTracks([{ type: "midi", name: "Drums" }]);
    await tracks.createScenes(1);
    await fake.insertDevice("t1", "Reverb");
  });

  it("rejects a spec with both type and duplicateOf", async () => {
    await expect(
      tracks.createTracks([{ type: "midi", duplicateOf: "t1" }]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a spec with neither type nor duplicateOf", async () => {
    await expect(tracks.createTracks([{ name: "x" }])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("createScenes with duplicateOf defaults count to 1 and fails fast on stale IDs", async () => {
    const created = await tracks.createScenes(undefined, "s1");
    expect(created).toHaveLength(1);
    await expect(tracks.createScenes(undefined, "s99")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("createScenes without count or duplicateOf is INVALID_INPUT", async () => {
    await expect(tracks.createScenes(undefined)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("duplicateDevice records an insert_device undo step", async () => {
    const copy = await devices.duplicateDevice("d1");
    expect(copy.name).toBe("Reverb");
    expect(fake.undoSteps).toContain("insert_device");
  });
});
