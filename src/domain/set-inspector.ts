import type { LivePort } from "../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  SetSnapshot,
  TrackDetail,
  TrackId,
} from "../port/types.js";

export class SetInspector {
  constructor(private readonly live: LivePort) {}

  getSet(): SetSnapshot {
    return this.live.getSet();
  }

  getTrack(id: TrackId): TrackDetail {
    return this.live.getTrack(id);
  }

  getClip(id: ClipId): ClipDetail {
    return this.live.getClip(id);
  }
}
