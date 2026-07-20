import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive device writes", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }]);
  });

  it("inserts a catalog device with minted ID and default params", async () => {
    const device = await fake.insertDevice("t1", "Reverb");
    expect(device.id).toBe("d1");
    expect(device.trackId).toBe("t1");
    expect(device.params.map((p) => p.name)).toEqual([
      "Device On",
      "Dry/Wet",
      "Decay Time",
      "Room Size",
    ]);
    expect((await fake.getTrack("t1")).deviceNames).toEqual(["Reverb"]);
  });

  it("inserts at an index and rejects out-of-range indexes", async () => {
    await fake.insertDevice("t1", "Reverb");
    await fake.insertDevice("t1", "Compressor", 0);
    expect((await fake.getTrack("t1")).deviceNames).toEqual(["Compressor", "Reverb"]);
    await expect(fake.insertDevice("t1", "Reverb", 5)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects unknown device names, hinting the catalog", async () => {
    await expect(fake.insertDevice("t1", "MegaSynth 9000")).rejects.toMatchObject({
      code: "INVALID_INPUT",
      hint: expect.stringContaining("Reverb"),
    });
  });

  it("sets params by name and validates name, range, quantization", async () => {
    await fake.insertDevice("t1", "Reverb");
    await fake.setDeviceParams("d1", { "Dry/Wet": 0.35 });
    expect(
      (await fake.getDevice("d1")).params.find((p) => p.name === "Dry/Wet")?.value,
    ).toBe(0.35);
    await expect(fake.setDeviceParams("d1", { Nope: 1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      hint: expect.stringContaining("Dry/Wet"),
    });
    await expect(fake.setDeviceParams("d1", { "Dry/Wet": 2 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(fake.setDeviceParams("d1", { "Device On": 0.5 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("deletes devices; stale IDs then 404", async () => {
    await fake.insertDevice("t1", "Reverb");
    await fake.deleteDevice("d1");
    expect((await fake.getTrack("t1")).devices).toEqual([]);
    await expect(fake.getDevice("d1")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const d2 = await fake.insertDevice("t1", "Reverb");
    expect(d2.id).toBe("d2"); // IDs never reused
  });

  it("sets mixer volume/pan/sends and rejects unknown returnId", async () => {
    await fake.setMixer("t1", {
      volume: 0.7,
      pan: -0.25,
      sends: [{ returnId: "r1", value: 0.4 }],
    });
    expect((await fake.getTrack("t1")).mixer).toEqual({
      volume: 0.7,
      pan: -0.25,
      sends: [
        { returnId: "r1", value: 0.4 },
        { returnId: "r2", value: 0 },
      ],
    });
    await expect(
      fake.setMixer("t1", { sends: [{ returnId: "r9", value: 0.1 }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not share valueItems arrays between inserted devices", async () => {
    const d1 = await fake.insertDevice("t1", "Reverb");
    const d2 = await fake.insertDevice("t1", "Reverb");
    const items1 = d1.params[0].valueItems!;
    const items2 = d2.params[0].valueItems!;
    expect(items1).toEqual(["Off", "On"]);
    items1[0] = "MUTATED";
    expect(items2).toEqual(["Off", "On"]);
    expect((await fake.getDevice(d2.id)).params[0].valueItems).toEqual(["Off", "On"]);
  });
});
