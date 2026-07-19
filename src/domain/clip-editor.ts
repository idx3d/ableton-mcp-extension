import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { ClipDetail, ClipId, Note, SceneId, TrackId } from "../port/types.js";
import { validateNotes } from "./notes.js";

export interface CreateMidiClipInput {
  trackId: TrackId;
  sceneId: SceneId;
  lengthBeats: number;
  notes: Note[];
  name?: string;
}

export class ClipEditor {
  constructor(private readonly live: LivePort) {}

  async createMidiClip(input: CreateMidiClipInput): Promise<ClipDetail> {
    if (!(input.lengthBeats > 0)) {
      throw new PortError("INVALID_INPUT", `lengthBeats ${input.lengthBeats} must be > 0`);
    }
    validateNotes(input.notes);
    return this.live.transact("create_midi_clip", () =>
      this.live.createMidiClip(
        input.trackId,
        input.sceneId,
        input.lengthBeats,
        input.notes,
        input.name,
      ),
    );
  }

  async replaceClipNotes(clipId: ClipId, notes: Note[]): Promise<ClipDetail> {
    this.live.getClip(clipId); // fail fast on stale ID
    validateNotes(notes);
    await this.live.transact("replace_clip_notes", () =>
      this.live.replaceClipNotes(clipId, notes),
    );
    return this.live.getClip(clipId);
  }
}
