import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { DeviceDetail, DeviceId, TrackId } from "../port/types.js";

const ABSOLUTE_PATH_RE = /^(\/|[A-Za-z]:[\\/])/;

export class DeviceService {
  constructor(private readonly live: LivePort) {}

  async insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail> {
    await this.live.getTrack(trackId); // fail fast on stale ID
    return this.live.transact("insert_device", () =>
      this.live.insertDevice(trackId, deviceName, index),
    );
  }

  async duplicateDevice(deviceId: DeviceId): Promise<DeviceDetail> {
    await this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("insert_device", () => this.live.duplicateDevice(deviceId));
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
    await this.live.getDevice(deviceId); // fail fast on stale ID
    await this.live.transact("set_device_params", () =>
      this.live.setDeviceParams(deviceId, params),
    );
    return this.live.getDevice(deviceId);
  }

  async deleteDevice(deviceId: DeviceId): Promise<void> {
    await this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("delete_device", () => this.live.deleteDevice(deviceId));
  }

  async setSimplerSample(
    deviceId: DeviceId,
    filePath: string,
  ): Promise<{ samplePath: string }> {
    if (!ABSOLUTE_PATH_RE.test(filePath)) {
      throw new PortError(
        "INVALID_INPUT",
        `filePath "${filePath}" must be absolute`,
        "Provide the full path to an audio file on the machine running Live.",
      );
    }
    await this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("set_simpler_sample", () =>
      this.live.setSimplerSample(deviceId, filePath),
    );
  }
}
