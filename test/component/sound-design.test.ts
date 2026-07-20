import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

describe("scenario: sound design on an existing set", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack();
    const { client } = stack;
    await callTool(client, "create_tracks", {
      tracks: [
        { type: "midi", name: "Pad" },
        { type: "midi", name: "Bass" },
      ],
    });
  });
  afterEach(async () => {
    await stack.close();
  });

  it("insert reverb, dial it in, balance the mix", async () => {
    const { client, fake } = stack;

    const set = await callTool(client, "get_set");
    expect(set.payload.set.returnTracks).toEqual([
      { id: "r1", name: "A-Reverb" },
      { id: "r2", name: "B-Delay" },
    ]);

    const inserted = await callTool(client, "insert_device", {
      trackId: "t1",
      device: "Reverb",
    });
    const deviceId = inserted.payload.device.id;

    await callTool(client, "set_device_params", {
      deviceId,
      params: { "Dry/Wet": 0.3, "Decay Time": 0.8 },
    });

    await callTool(client, "set_mixer", {
      updates: [
        {
          trackId: "t1",
          volume: 0.7,
          pan: -0.15,
          sends: [{ returnId: "r2", value: 0.25 }],
        },
        { trackId: "t2", volume: 0.9 },
      ],
    });

    const track = await callTool(client, "get_track", { trackId: "t1" });
    expect(track.payload.track.deviceNames).toEqual(["Reverb"]);
    expect(track.payload.track.mixer).toMatchObject({ volume: 0.7, pan: -0.15 });

    const device = await callTool(client, "get_device", { deviceId });
    const byName = Object.fromEntries(
      device.payload.device.params.map((p: { name: string; value: number }) => [
        p.name,
        p.value,
      ]),
    );
    expect(byName["Dry/Wet"]).toBe(0.3);
    expect(byName["Decay Time"]).toBe(0.8);

    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "insert_device",
      "set_device_params",
      "set_mixer",
    ]);
  });

  it("recovers from a stale device ID with a structured hint", async () => {
    const { client } = stack;
    const inserted = await callTool(client, "insert_device", {
      trackId: "t1",
      device: "Compressor",
    });
    await callTool(client, "delete_device", { deviceId: inserted.payload.device.id });

    const stale = await callTool(client, "set_device_params", {
      deviceId: inserted.payload.device.id,
      params: { Ratio: 0.5 },
    });
    expect(stale.isError).toBe(true);
    expect(stale.payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(stale.payload.hint).toContain("get_set");
  });

  it("unknown device name comes back with the catalog hint", async () => {
    const { client } = stack;
    const bad = await callTool(client, "insert_device", {
      trackId: "t1",
      device: "Sylenth1",
    });
    expect(bad.payload).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(bad.payload.hint).toContain("Reverb");
  });
});
