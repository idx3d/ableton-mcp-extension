import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

async function bigFixture(): Promise<FakeLive> {
  const fake = new FakeLive();
  await fake.createScenes(8);
  for (let i = 0; i < 50; i++) {
    const [track] = await fake.createTracks([
      { type: "midi", name: `Track ${i + 1} Synth Layer` },
    ]);
    for (let s = 1; s <= 4; s++) {
      await fake.createMidiClip(track.id, `s${s}`, 4, [
        [60, 0, 1, 100],
        [64, 1, 1, 100],
        [67, 2, 1, 100],
      ]);
    }
  }
  return fake;
}

describe("token economy budgets (P0)", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack(await bigFixture());
  });
  afterEach(async () => {
    await stack.close();
  });

  it("get_set on a 50-track / 8-scene / 200-clip set stays under 8 KB", async () => {
    const { bytes, payload } = await callTool(stack.client, "get_set");
    expect(payload.set.tracks).toHaveLength(50);
    expect(bytes).toBeLessThan(8192);
  });

  it("get_track stays under 4 KB and does not inline note data", async () => {
    const { bytes, payload } = await callTool(stack.client, "get_track", {
      trackId: "t1",
    });
    expect(payload.track.slots).toHaveLength(8);
    expect(bytes).toBeLessThan(4096);
    expect(JSON.stringify(payload)).not.toContain('"notes"');
  });

  it("get_device stays under 1.5 KB", async () => {
    await stack.fake.insertDevice("t1", "Reverb");
    const inserted = stack.fake.getTrack("t1").devices[0];
    const { bytes, payload } = await callTool(stack.client, "get_device", {
      deviceId: inserted.id,
    });
    expect(payload.device.params.length).toBeGreaterThan(2);
    expect(bytes).toBeLessThan(1536);
  });
});
