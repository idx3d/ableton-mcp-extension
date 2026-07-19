import { PortError } from "../port/errors.js";
import type { Note } from "../port/types.js";

const HINT =
  "Notes are [pitch 0-127, startBeat >= 0, durationBeats > 0, velocity 1-127, extras?].";

export function validateNotes(notes: Note[]): void {
  notes.forEach((note, i) => {
    const [pitch, start, duration, velocity] = note;
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
      throw new PortError("INVALID_INPUT", `note ${i}: pitch ${pitch} out of range`, HINT);
    }
    if (!(start >= 0)) {
      throw new PortError("INVALID_INPUT", `note ${i}: start ${start} must be >= 0`, HINT);
    }
    if (!(duration > 0)) {
      throw new PortError("INVALID_INPUT", `note ${i}: duration ${duration} must be > 0`, HINT);
    }
    if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
      throw new PortError("INVALID_INPUT", `note ${i}: velocity ${velocity} out of range`, HINT);
    }
  });
}
