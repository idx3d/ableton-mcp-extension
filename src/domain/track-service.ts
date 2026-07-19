import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type {
  SceneSummary,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
} from "../port/types.js";

export class TrackService {
  constructor(private readonly live: LivePort) {}

  // All write methods are async so validation throws surface as rejected
  // promises, matching how callers and tests consume them.
  async createTracks(specs: TrackSpec[]): Promise<TrackSummary[]> {
    if (specs.length === 0) {
      throw new PortError("INVALID_INPUT", "specs must not be empty");
    }
    return this.live.transact("create_tracks", () => this.live.createTracks(specs));
  }

  async updateTrack(id: TrackId, patch: TrackPatch): Promise<TrackSummary> {
    this.live.getTrack(id); // fail fast on stale ID before mutating
    await this.live.transact("update_track", () => this.live.updateTrack(id, patch));
    return this.live.getTrack(id);
  }

  async deleteTracks(ids: TrackId[]): Promise<void> {
    if (ids.length === 0) {
      throw new PortError("INVALID_INPUT", "ids must not be empty");
    }
    for (const id of ids) this.live.getTrack(id); // all-or-nothing
    return this.live.transact("delete_tracks", () => this.live.deleteTracks(ids));
  }

  async createScenes(count: number): Promise<SceneSummary[]> {
    if (!Number.isInteger(count) || count < 1 || count > 64) {
      throw new PortError("INVALID_INPUT", `count ${count} must be an integer 1-64`);
    }
    return this.live.transact("create_scenes", () => this.live.createScenes(count));
  }
}
