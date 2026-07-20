import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive device/mixer reads", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }]);
  });

  it("seeds two default return tracks", () => {
    expect(fake.getSet().returnTracks).toEqual([
      { id: "r1", name: "A-Reverb" },
      { id: "r2", name: "B-Delay" },
    ]);
  });

  it("tracks start with an empty device chain and default mixer", () => {
    const track = fake.getTrack("t1");
    expect(track.devices).toEqual([]);
    expect(track.deviceNames).toEqual([]);
    expect(track.mixer).toEqual({
      volume: 0.85,
      pan: 0,
      sends: [
        { returnId: "r1", value: 0 },
        { returnId: "r2", value: 0 },
      ],
    });
  });

  it("getDevice on an unknown ID throws NOT_FOUND", () => {
    expect(() => fake.getDevice("d1")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});
