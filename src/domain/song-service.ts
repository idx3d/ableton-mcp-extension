import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { SongPatch } from "../port/types.js";

export class SongService {
  constructor(private readonly live: LivePort) {}

  async updateSong(patch: SongPatch): Promise<void> {
    if (patch.tempo !== undefined && (patch.tempo < 20 || patch.tempo > 999)) {
      throw new PortError("INVALID_INPUT", `tempo ${patch.tempo} must be 20-999 BPM`);
    }
    return this.live.transact("update_song", () => this.live.updateSong(patch));
  }
}
