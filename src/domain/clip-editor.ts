import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  ClipPatch,
  Note,
  SceneId,
  TrackId,
} from "../port/types.js";
import { validateNotes } from "./notes.js";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface CreateMidiClipInput {
  trackId: TrackId;
  sceneId: SceneId;
  lengthBeats: number;
  notes: Note[];
  name?: string;
}

export interface CreateAudioClipInput {
  trackId: TrackId;
  sceneId: SceneId;
  filePath: string;
  name?: string;
}

export class ClipEditor {
  constructor(private readonly live: LivePort) {}

  async createMidiClip(input: CreateMidiClipInput): Promise<ClipDetail> {
    if (!(input.lengthBeats > 0)) {
      throw new PortError(
        "INVALID_INPUT",
        `lengthBeats ${input.lengthBeats} must be > 0`,
      );
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

  async createAudioClip(input: CreateAudioClipInput): Promise<ClipDetail> {
    if (input.filePath.trim() === "") {
      throw new PortError("INVALID_INPUT", "filePath must not be empty");
    }
    return this.live.transact("create_audio_clip", () =>
      this.live.createAudioClip(input.trackId, input.sceneId, input.filePath, input.name),
    );
  }

  async updateClip(clipId: ClipId, patch: ClipPatch): Promise<ClipDetail> {
    if (Object.keys(patch).length === 0) {
      throw new PortError(
        "INVALID_INPUT",
        "patch must not be empty",
        "Provide at least one of: name, looping, color.",
      );
    }
    if (patch.color !== undefined && !COLOR_RE.test(patch.color)) {
      throw new PortError(
        "INVALID_INPUT",
        `color "${patch.color}" is not a hex color`,
        'Use "#RRGGBB", e.g. "#FF5500".',
      );
    }
    this.live.getClip(clipId); // fail fast on stale ID
    await this.live.transact("update_clip", () => this.live.updateClip(clipId, patch));
    return this.live.getClip(clipId);
  }

  async deleteClips(ids: ClipId[]): Promise<void> {
    if (ids.length === 0) {
      throw new PortError("INVALID_INPUT", "ids must not be empty");
    }
    for (const id of ids) this.live.getClip(id); // all-or-nothing
    return this.live.transact("delete_clips", () => this.live.deleteClips(ids));
  }
}
