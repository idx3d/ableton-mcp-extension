import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { MixerService } from "../../../src/domain/mixer-service.js";

describe("MixerService", () => {
  let fake: FakeLive;
  let mixer: MixerService;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }, { type: "audio" }]);
    mixer = new MixerService(fake);
  });

  it("updates several tracks in ONE undo step", async () => {
    await mixer.setMixer([
      { trackId: "t1", volume: 0.6, sends: [{ returnId: "r1", value: 0.3 }] },
      { trackId: "t2", pan: 0.5 },
    ]);
    expect(fake.getTrack("t1").mixer.volume).toBe(0.6);
    expect(fake.getTrack("t2").mixer.pan).toBe(0.5);
    expect(fake.undoSteps).toEqual(["set_mixer"]);
  });

  it("is all-or-nothing: one bad track ID mutates nothing", async () => {
    await expect(
      mixer.setMixer([
        { trackId: "t1", volume: 0.1 },
        { trackId: "t99", volume: 0.1 },
      ]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.getTrack("t1").mixer.volume).toBe(0.85);
    expect(fake.undoSteps).toEqual([]);
  });

  it("validates ranges and return IDs before mutating", async () => {
    await expect(mixer.setMixer([{ trackId: "t1", volume: 1.5 }])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(mixer.setMixer([{ trackId: "t1", pan: -2 }])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      mixer.setMixer([{ trackId: "t1", sends: [{ returnId: "r9", value: 0.2 }] }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      mixer.setMixer([{ trackId: "t1", sends: [{ returnId: "r1", value: 3 }] }]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.undoSteps).toEqual([]);
  });

  it("rejects empty batches", async () => {
    await expect(mixer.setMixer([])).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
