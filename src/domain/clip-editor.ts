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

export interface NoteSelect {
  pitchMin?: number;
  pitchMax?: number;
  /** inclusive */
  startBeat?: number;
  /** exclusive */
  endBeat?: number;
}

export interface NoteTransform {
  transpose?: number;
  shiftBeats?: number;
  velocityDelta?: number;
}

export interface ClipNotesEdit {
  select?: NoteSelect;
  remove?: boolean;
  transform?: NoteTransform;
  add?: Note[];
}

function matches(note: Note, sel: NoteSelect): boolean {
  const [pitch, start] = note;
  if (sel.pitchMin !== undefined && pitch < sel.pitchMin) return false;
  if (sel.pitchMax !== undefined && pitch > sel.pitchMax) return false;
  if (sel.startBeat !== undefined && start < sel.startBeat) return false;
  if (sel.endBeat !== undefined && start >= sel.endBeat) return false;
  return true;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function applyTransform(note: Note, t: NoteTransform): Note {
  const [pitch, start, duration, velocity] = note;
  const extras = note.length === 5 ? { ...note[4] } : undefined;
  const next: Note = [
    clamp(pitch + (t.transpose ?? 0), 0, 127),
    Math.max(0, start + (t.shiftBeats ?? 0)),
    duration,
    clamp(velocity + (t.velocityDelta ?? 0), 1, 127),
  ];
  return extras ? ([...next, extras] as Note) : next;
}

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

  async editClipNotes(clipId: ClipId, edit: ClipNotesEdit): Promise<ClipDetail> {
    const clip = this.live.getClip(clipId); // fail fast on stale ID
    if (clip.kind !== "midi") {
      throw new PortError(
        "INVALID_INPUT",
        `clip ${clipId} is an audio clip`,
        "Only MIDI clips have notes.",
      );
    }
    if (edit.remove && edit.transform) {
      throw new PortError(
        "INVALID_INPUT",
        "remove and transform are mutually exclusive",
        "Use one edit_clip_notes call per operation.",
      );
    }
    const hasAdd = (edit.add?.length ?? 0) > 0;
    if (!edit.remove && !edit.transform && !hasAdd) {
      throw new PortError(
        "INVALID_INPUT",
        "nothing to do",
        "Provide remove, transform, and/or add.",
      );
    }
    if (edit.add) validateNotes(edit.add);

    const sel = edit.select ?? {};
    let notes: Note[];
    if (edit.remove) {
      notes = clip.notes.filter((n) => !matches(n, sel));
    } else if (edit.transform) {
      const t = edit.transform;
      notes = clip.notes.map((n) => (matches(n, sel) ? applyTransform(n, t) : n));
    } else {
      notes = [...clip.notes];
    }
    if (edit.add) notes.push(...edit.add);
    validateNotes(notes); // guards direct callers from e.g. fractional transpose

    await this.live.transact("edit_clip_notes", () =>
      this.live.replaceClipNotes(clipId, notes),
    );
    return this.live.getClip(clipId);
  }
}
