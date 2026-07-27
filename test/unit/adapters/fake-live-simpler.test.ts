import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive Simpler sample", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Sampler" }]);
    await fake.insertDevice("t1", "Simpler");
    await fake.insertDevice("t1", "Reverb");
  });

  it("a fresh Simpler has no samplePath", async () => {
    expect("samplePath" in (await fake.getDevice("d1"))).toBe(false);
  });

  it("replaces the sample and reports it in get_device", async () => {
    const result = await fake.setSimplerSample("d1", "/samples/kick.wav");
    expect(result).toEqual({ samplePath: "/samples/kick.wav" });
    expect((await fake.getDevice("d1")).samplePath).toBe("/samples/kick.wav");
  });

  it("is UNSUPPORTED on non-Simpler devices", async () => {
    await expect(fake.setSimplerSample("d2", "/samples/kick.wav")).rejects.toMatchObject({
      code: "UNSUPPORTED",
      message: "device d2 is a Reverb, not a Simpler",
    });
  });

  it("is NOT_FOUND on stale device IDs", async () => {
    await expect(fake.setSimplerSample("d9", "/x.wav")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
