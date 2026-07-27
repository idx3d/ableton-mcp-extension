import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { SongPatch, UpdateSongResult } from "../port/types.js";

export class SongService {
  constructor(private readonly live: LivePort) {}

  async updateSong(patch: SongPatch): Promise<UpdateSongResult> {
    if (patch.tempo !== undefined && (patch.tempo < 20 || patch.tempo > 999)) {
      throw new PortError("INVALID_INPUT", `tempo ${patch.tempo} must be 20-999 BPM`);
    }
    for (const add of patch.addCues ?? []) {
      if (add.timeBeats < 0) {
        throw new PortError(
          "INVALID_INPUT",
          `cue timeBeats ${add.timeBeats} must be >= 0`,
        );
      }
    }
    for (const rename of patch.renameCues ?? []) {
      if (rename.name.trim() === "") {
        throw new PortError("INVALID_INPUT", "cue name must not be empty");
      }
    }
    return this.live.transact("update_song", () => this.live.updateSong(patch));
  }
}
