import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { SendLevel, TrackId } from "../port/types.js";

export interface MixerUpdate {
  trackId: TrackId;
  volume?: number;
  pan?: number;
  sends?: SendLevel[];
}

export class MixerService {
  constructor(private readonly live: LivePort) {}

  async setMixer(updates: MixerUpdate[]): Promise<void> {
    if (updates.length === 0) {
      throw new PortError("INVALID_INPUT", "updates must not be empty");
    }
    const returnIds = new Set((await this.live.getSet()).returnTracks.map((r) => r.id));
    for (const update of updates) {
      await this.live.getTrack(update.trackId); // fail fast on stale ID
      if (update.volume !== undefined && (update.volume < 0 || update.volume > 1)) {
        throw new PortError(
          "INVALID_INPUT",
          `track ${update.trackId}: volume ${update.volume} outside [0, 1]`,
        );
      }
      if (update.pan !== undefined && (update.pan < -1 || update.pan > 1)) {
        throw new PortError(
          "INVALID_INPUT",
          `track ${update.trackId}: pan ${update.pan} outside [-1, 1]`,
        );
      }
      for (const send of update.sends ?? []) {
        if (!returnIds.has(send.returnId)) {
          throw PortError.notFound("return track", send.returnId);
        }
        if (send.value < 0 || send.value > 1) {
          throw new PortError(
            "INVALID_INPUT",
            `track ${update.trackId}: send ${send.returnId} value ${send.value} outside [0, 1]`,
          );
        }
      }
    }
    await this.live.transact("set_mixer", async () => {
      for (const update of updates) {
        await this.live.setMixer(update.trackId, update);
      }
    });
  }
}
