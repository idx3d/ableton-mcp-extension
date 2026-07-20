import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { DeviceDetail, DeviceId, TrackId } from "../port/types.js";

export class DeviceService {
  constructor(private readonly live: LivePort) {}

  async insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail> {
    this.live.getTrack(trackId); // fail fast on stale ID
    return this.live.transact("insert_device", () =>
      this.live.insertDevice(trackId, deviceName, index),
    );
  }

  async setParams(
    deviceId: DeviceId,
    params: Record<string, number>,
  ): Promise<DeviceDetail> {
    if (Object.keys(params).length === 0) {
      throw new PortError(
        "INVALID_INPUT",
        "params must not be empty",
        "Provide at least one parameter name/value pair (see get_device for names).",
      );
    }
    this.live.getDevice(deviceId); // fail fast on stale ID
    await this.live.transact("set_device_params", () =>
      this.live.setDeviceParams(deviceId, params),
    );
    return this.live.getDevice(deviceId);
  }

  async deleteDevice(deviceId: DeviceId): Promise<void> {
    this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("delete_device", () => this.live.deleteDevice(deviceId));
  }
}
