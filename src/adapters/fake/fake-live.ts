import { PortError } from "../../port/errors.js";
import type { LivePort } from "../../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  Note,
  SceneId,
  SceneSummary,
  SetSnapshot,
  SongPatch,
  TrackDetail,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
} from "../../port/types.js";

interface FakeClip {
  id: ClipId;
  name: string;
  lengthBeats: number;
  looping: boolean;
  notes: Note[];
}

interface FakeTrack {
  id: TrackId;
  name: string;
  type: "midi" | "audio";
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  /** session clip per scene */
  clips: Map<SceneId, FakeClip>;
}

interface FakeScene {
  id: SceneId;
  name: string;
}

/**
 * In-memory stand-in for Ableton Live. First-class LivePort implementation
 * used by component tests and the dev:fake loop. Mimics real-Live semantics
 * pinned by the contract tests (Plan 3). No rollback on mid-transact failure —
 * services enforce all-or-nothing by validating before mutating.
 */
export class FakeLive implements LivePort {
  private tracks: FakeTrack[] = [];
  private scenes: FakeScene[] = [];
  private tempo = 120;
  private scaleName = "Major";
  private rootNote = 0;
  private counters = { track: 0, scene: 0, clip: 0 };
  readonly undoSteps: string[] = [];

  // -- reads ----------------------------------------------------------------

  getSet(): SetSnapshot {
    return {
      tempo: this.tempo,
      scaleName: this.scaleName,
      rootNote: this.rootNote,
      tracks: this.tracks.map((t) => this.summarize(t)),
      scenes: this.scenes.map((s) => ({ ...s })),
    };
  }

  getTrack(id: TrackId): TrackDetail {
    const track = this.requireTrack(id);
    return {
      ...this.summarize(track),
      slots: this.scenes.map((scene) => {
        const clip = track.clips.get(scene.id);
        return { sceneId: scene.id, clip: clip ? this.summarizeClip(clip) : null };
      }),
    };
  }

  getClip(id: ClipId): ClipDetail {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    const { track, sceneId, clip } = found;
    return {
      ...this.summarizeClip(clip),
      trackId: track.id,
      sceneId,
      notes: this.cloneNotes(clip.notes),
    };
  }

  // -- writes ---------------------------------------------------------------

  async createTracks(specs: TrackSpec[]): Promise<TrackSummary[]> {
    return specs.map((spec) => {
      const id = `t${++this.counters.track}`;
      const defaultName =
        spec.type === "midi"
          ? `MIDI ${this.counters.track}`
          : `Audio ${this.counters.track}`;
      const track: FakeTrack = {
        id,
        name: spec.name ?? defaultName,
        type: spec.type,
        muted: false,
        soloed: false,
        armed: false,
        clips: new Map(),
      };
      this.tracks.push(track);
      return this.summarize(track);
    });
  }

  async updateTrack(id: TrackId, patch: TrackPatch): Promise<void> {
    const track = this.requireTrack(id);
    if (patch.name !== undefined) track.name = patch.name;
    if (patch.muted !== undefined) track.muted = patch.muted;
    if (patch.soloed !== undefined) track.soloed = patch.soloed;
    if (patch.armed !== undefined) track.armed = patch.armed;
  }

  async deleteTracks(ids: TrackId[]): Promise<void> {
    for (const id of ids) this.requireTrack(id);
    this.tracks = this.tracks.filter((t) => !ids.includes(t.id));
  }

  async createScenes(count: number): Promise<SceneSummary[]> {
    const created: SceneSummary[] = [];
    for (let i = 0; i < count; i++) {
      const id = `s${++this.counters.scene}`;
      const scene = { id, name: `Scene ${this.counters.scene}` };
      this.scenes.push(scene);
      created.push({ ...scene });
    }
    return created;
  }

  async createMidiClip(
    trackId: TrackId,
    sceneId: SceneId,
    lengthBeats: number,
    notes: Note[],
    name?: string,
  ): Promise<ClipDetail> {
    const track = this.requireTrack(trackId);
    this.requireScene(sceneId);
    if (track.type !== "midi") {
      throw new PortError(
        "INVALID_INPUT",
        `track ${trackId} is an audio track`,
        "MIDI clips can only be created on MIDI tracks.",
      );
    }
    if (track.clips.has(sceneId)) {
      throw new PortError(
        "CONFLICT",
        `slot ${trackId}/${sceneId} already has a clip`,
        "Delete the existing clip first, or pick an empty slot (see get_track).",
      );
    }
    const clip: FakeClip = {
      id: this.mintClipId(),
      name: name ?? "",
      lengthBeats,
      looping: true,
      notes: this.cloneNotes(notes),
    };
    track.clips.set(sceneId, clip);
    return this.getClip(clip.id);
  }

  async replaceClipNotes(id: ClipId, notes: Note[]): Promise<void> {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    found.clip.notes = this.cloneNotes(notes);
  }

  async updateSong(patch: SongPatch): Promise<void> {
    if (patch.tempo !== undefined) this.tempo = patch.tempo;
  }

  async transact<T>(undoLabel: string, fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    this.undoSteps.push(undoLabel);
    return result;
  }

  // -- internals ------------------------------------------------------------

  private cloneNotes(notes: Note[]): Note[] {
    return notes.map(
      (n) => (n.length === 5 ? [n[0], n[1], n[2], n[3], { ...n[4] }] : [...n]) as Note,
    );
  }

  private summarize(track: FakeTrack): TrackSummary {
    return {
      id: track.id,
      name: track.name,
      type: track.type,
      muted: track.muted,
      soloed: track.soloed,
      armed: track.armed,
      deviceNames: [],
      clipCount: track.clips.size,
    };
  }

  private summarizeClip(clip: FakeClip) {
    return {
      id: clip.id,
      name: clip.name,
      lengthBeats: clip.lengthBeats,
      looping: clip.looping,
      noteCount: clip.notes.length,
    };
  }

  protected requireTrack(id: TrackId): FakeTrack {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) throw PortError.notFound("track", id);
    return track;
  }

  protected requireScene(id: SceneId): FakeScene {
    const scene = this.scenes.find((s) => s.id === id);
    if (!scene) throw PortError.notFound("scene", id);
    return scene;
  }

  protected findClip(
    id: ClipId,
  ): { track: FakeTrack; sceneId: SceneId; clip: FakeClip } | undefined {
    for (const track of this.tracks) {
      for (const [sceneId, clip] of track.clips) {
        if (clip.id === id) return { track, sceneId, clip };
      }
    }
    return undefined;
  }

  protected mintClipId(): ClipId {
    return `c${++this.counters.clip}`;
  }
}
