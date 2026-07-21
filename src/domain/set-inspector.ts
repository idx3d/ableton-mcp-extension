import type { LivePort } from "../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  DeviceDetail,
  DeviceId,
  SetSnapshot,
  TrackDetail,
  TrackId,
} from "../port/types.js";

export class SetInspector {
  constructor(private readonly live: LivePort) {}

  async getSet(): Promise<SetSnapshot> {
    return this.live.getSet();
  }

  async getTrack(id: TrackId): Promise<TrackDetail> {
    return this.live.getTrack(id);
  }

  async getClip(id: ClipId): Promise<ClipDetail> {
    return this.live.getClip(id);
  }

  async getDevice(id: DeviceId): Promise<DeviceDetail> {
    return this.live.getDevice(id);
  }
}
