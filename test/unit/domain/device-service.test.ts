import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { DeviceService } from "../../../src/domain/device-service.js";

describe("DeviceService", () => {
  let fake: FakeLive;
  let devices: DeviceService;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }]);
    devices = new DeviceService(fake);
  });

  it("insert, set params, delete - one named undo step each", async () => {
    const device = await devices.insertDevice("t1", "Reverb");
    const updated = await devices.setParams(device.id, { "Dry/Wet": 0.4 });
    expect(updated.params.find((p) => p.name === "Dry/Wet")?.value).toBe(0.4);
    await devices.deleteDevice(device.id);
    expect(fake.undoSteps).toEqual([
      "insert_device",
      "set_device_params",
      "delete_device",
    ]);
  });

  it("rejects empty param records without touching the port", async () => {
    await devices.insertDevice("t1", "Reverb");
    await expect(devices.setParams("d1", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual(["insert_device"]);
  });

  it("fails fast on stale device IDs before mutating", async () => {
    await expect(devices.setParams("d9", { X: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(devices.deleteDevice("d9")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fake.undoSteps).toEqual([]);
  });

  it("invalid param values leave no undo step behind", async () => {
    await devices.insertDevice("t1", "Reverb");
    await expect(devices.setParams("d1", { "Dry/Wet": 9 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual(["insert_device"]);
  });
});
