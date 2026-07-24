import { PortError } from "../../port/errors.js";
import type { LivePort } from "../../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  ClipKind,
  ClipPatch,
  CueId,
  CueRef,
  DeviceDetail,
  DeviceId,
  DeviceParam,
  MixerPatch,
  MixerState,
  Note,
  ReturnTrackId,
  ReturnTrackSummary,
  SceneId,
  ScenePatch,
  SceneSummary,
  SetSnapshot,
  SongPatch,
  TrackDetail,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
  UpdateSongResult,
} from "../../port/types.js";

interface FakeClip {
  id: ClipId;
  kind: ClipKind;
  name: string;
  lengthBeats: number;
  looping: boolean;
  color?: string;
  /** audio clips only */
  filePath?: string;
  notes: Note[];
}

interface FakeDevice {
  id: DeviceId;
  name: string;
  params: DeviceParam[];
}

interface FakeMixer {
  volume: number;
  pan: number;
  sends: Map<ReturnTrackId, number>;
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
  devices: FakeDevice[];
  mixer: FakeMixer;
}

interface FakeScene {
  id: SceneId;
  name: string;
}

interface FakeCue {
  id: CueId;
  name: string;
  timeBeats: number;
}

/**
 * Deliberately tiny stand-in for Live's built-in device library — enough
 * surface for realistic tests. Real-Live name acceptance is pinned by the
 * Plan-3 contract tests; the SDK adapter passes names straight through.
 */
const onOff: DeviceParam = {
  name: "Device On",
  value: 1,
  min: 0,
  max: 1,
  quantized: true,
  valueItems: ["Off", "On"],
};

function knob(name: string, value: number, min = 0, max = 1): DeviceParam {
  return { name, value, min, max, quantized: false };
}

const CATALOG: Record<string, DeviceParam[]> = {
  Reverb: [onOff, knob("Dry/Wet", 1), knob("Decay Time", 0.6), knob("Room Size", 0.5)],
  "Auto Filter": [onOff, knob("Frequency", 1), knob("Resonance", 0)],
  Compressor: [onOff, knob("Threshold", 0.85), knob("Ratio", 0.3), knob("Attack", 0.2)],
  Operator: [onOff, knob("Volume", 0.85), knob("Filter Freq", 1)],
  Wavetable: [onOff, knob("Volume", 0.85), knob("Osc 1 Pos", 0)],
  "Drum Rack": [onOff, knob("Volume", 0.85)],
};

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
  private counters = { track: 0, scene: 0, clip: 0, device: 0, cue: 0 };
  private returnTracks: ReturnTrackSummary[] = [
    { id: "r1", name: "A-Reverb" },
    { id: "r2", name: "B-Delay" },
  ];
  private cues: FakeCue[] = [];
  readonly undoSteps: string[] = [];

  // -- reads ----------------------------------------------------------------

  async getSet(): Promise<SetSnapshot> {
    return {
      tempo: this.tempo,
      scaleName: this.scaleName,
      rootNote: this.rootNote,
      tracks: this.tracks.map((t) => this.summarize(t)),
      scenes: this.scenes.map((s) => ({ ...s })),
      returnTracks: this.returnTracks.map((r) => ({ ...r })),
      ...(this.cues.length > 0 ? { cues: this.cues.map((c) => ({ ...c })) } : {}),
    };
  }

  async getTrack(id: TrackId): Promise<TrackDetail> {
    const track = this.requireTrack(id);
    return {
      ...this.summarize(track),
      slots: this.scenes.map((scene) => {
        const clip = track.clips.get(scene.id);
        return { sceneId: scene.id, clip: clip ? this.summarizeClip(clip) : null };
      }),
      devices: track.devices.map((d) => ({ id: d.id, name: d.name })),
      mixer: this.mixerState(track),
    };
  }

  async getClip(id: ClipId): Promise<ClipDetail> {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    const { track, sceneId, clip } = found;
    return {
      ...this.summarizeClip(clip),
      trackId: track.id,
      sceneId,
      notes: this.cloneNotes(clip.notes),
      ...(clip.filePath !== undefined ? { filePath: clip.filePath } : {}),
    };
  }

  async getDevice(id: DeviceId): Promise<DeviceDetail> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    return {
      id: found.device.id,
      name: found.device.name,
      trackId: found.track.id,
      params: found.device.params.map((p) => ({
        ...p,
        valueItems: p.valueItems ? [...p.valueItems] : undefined,
      })),
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
        devices: [],
        mixer: this.defaultMixer(),
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
      kind: "midi",
      name: name ?? "",
      lengthBeats,
      looping: true,
      notes: this.cloneNotes(notes),
    };
    track.clips.set(sceneId, clip);
    return await this.getClip(clip.id);
  }

  async replaceClipNotes(id: ClipId, notes: Note[]): Promise<void> {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    if (found.clip.kind !== "midi") {
      throw new PortError(
        "INVALID_INPUT",
        `clip ${id} is an audio clip`,
        "Only MIDI clips have notes.",
      );
    }
    found.clip.notes = this.cloneNotes(notes);
  }

  async insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail> {
    const track = this.requireTrack(trackId);
    const template = CATALOG[deviceName];
    if (!template) {
      throw new PortError(
        "INVALID_INPUT",
        `unknown built-in device "${deviceName}"`,
        `FakeLive knows: ${Object.keys(CATALOG).join(", ")}.`,
      );
    }
    const at = index ?? track.devices.length;
    if (!Number.isInteger(at) || at < 0 || at > track.devices.length) {
      throw new PortError(
        "INVALID_INPUT",
        `device index ${index} out of range 0..${track.devices.length}`,
      );
    }
    const device: FakeDevice = {
      id: `d${++this.counters.device}`,
      name: deviceName,
      params: template.map((p) => ({
        ...p,
        valueItems: p.valueItems ? [...p.valueItems] : undefined,
      })),
    };
    track.devices.splice(at, 0, device);
    return await this.getDevice(device.id);
  }

  async setDeviceParams(id: DeviceId, params: Record<string, number>): Promise<void> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    const updates: Array<{ param: DeviceParam; value: number }> = [];
    for (const [name, value] of Object.entries(params)) {
      const param = found.device.params.find((p) => p.name === name);
      if (!param) {
        throw new PortError(
          "INVALID_INPUT",
          `device ${id} has no parameter "${name}"`,
          `Valid parameters: ${found.device.params.map((p) => p.name).join(", ")}.`,
        );
      }
      if (value < param.min || value > param.max) {
        throw new PortError(
          "INVALID_INPUT",
          `parameter "${name}" value ${value} outside [${param.min}, ${param.max}]`,
        );
      }
      if (param.quantized && !Number.isInteger(value)) {
        throw new PortError(
          "INVALID_INPUT",
          `parameter "${name}" is quantized; value must be an integer`,
        );
      }
      updates.push({ param, value });
    }
    for (const { param, value } of updates) param.value = value;
  }

  async deleteDevice(id: DeviceId): Promise<void> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    found.track.devices = found.track.devices.filter((d) => d.id !== id);
  }

  async setMixer(trackId: TrackId, patch: MixerPatch): Promise<void> {
    const track = this.requireTrack(trackId);
    for (const send of patch.sends ?? []) {
      if (!this.returnTracks.some((r) => r.id === send.returnId)) {
        throw PortError.notFound("return track", send.returnId);
      }
    }
    if (patch.volume !== undefined) track.mixer.volume = patch.volume;
    if (patch.pan !== undefined) track.mixer.pan = patch.pan;
    for (const send of patch.sends ?? []) {
      track.mixer.sends.set(send.returnId, send.value);
    }
  }

  async updateSong(patch: SongPatch): Promise<UpdateSongResult> {
    // Validate every referenced cue before any mutation (all-or-nothing).
    const requireCue = (id: CueId): FakeCue => {
      const cue = this.cues.find((c) => c.id === id);
      if (!cue) throw PortError.notFound("cue point", id);
      return cue;
    };
    const renames = (patch.renameCues ?? []).map((r) => ({
      cue: requireCue(r.id),
      name: r.name,
    }));
    const deletes = patch.deleteCueIds ?? [];
    for (const id of deletes) requireCue(id);

    if (patch.tempo !== undefined) this.tempo = patch.tempo;
    for (const { cue, name } of renames) cue.name = name;
    if (deletes.length > 0) this.cues = this.cues.filter((c) => !deletes.includes(c.id));
    const addedCues: CueRef[] = (patch.addCues ?? []).map((add) => {
      const cue: FakeCue = {
        id: `q${++this.counters.cue}`,
        // Real Live derives a default locator name from the position; the
        // fake's placeholder is pinned by the self-test contract checks.
        name: add.name ?? `Cue ${this.counters.cue}`,
        timeBeats: add.timeBeats,
      };
      this.cues.push(cue);
      return { ...cue };
    });
    // Live presents cue points in time order (verify in-Live via self-test).
    this.cues.sort((a, b) => a.timeBeats - b.timeBeats);
    return { addedCues };
  }

  async createAudioClip(
    trackId: TrackId,
    sceneId: SceneId,
    filePath: string,
    name?: string,
  ): Promise<ClipDetail> {
    const track = this.requireTrack(trackId);
    this.requireScene(sceneId);
    if (track.type !== "audio") {
      throw new PortError(
        "INVALID_INPUT",
        `track ${trackId} is a MIDI track`,
        "Audio clips can only be created on audio tracks.",
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
      kind: "audio",
      name: name ?? "",
      // FakeLive cannot inspect audio files; fixed placeholder length.
      // Real length semantics are pinned by the Plan-3 contract tests.
      lengthBeats: 4,
      looping: true,
      filePath,
      notes: [],
    };
    track.clips.set(sceneId, clip);
    return await this.getClip(clip.id);
  }

  async updateClip(id: ClipId, patch: ClipPatch): Promise<void> {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    if (patch.name !== undefined) found.clip.name = patch.name;
    if (patch.looping !== undefined) found.clip.looping = patch.looping;
    if (patch.color !== undefined) found.clip.color = patch.color;
  }

  async deleteClips(ids: ClipId[]): Promise<void> {
    for (const id of ids) {
      if (!this.findClip(id)) throw PortError.notFound("clip", id);
    }
    for (const id of ids) {
      const found = this.findClip(id);
      if (found) found.track.clips.delete(found.sceneId);
    }
  }

  async updateScene(id: SceneId, patch: ScenePatch): Promise<void> {
    const scene = this.requireScene(id);
    if (patch.name !== undefined) scene.name = patch.name;
  }

  async deleteScenes(ids: SceneId[]): Promise<void> {
    for (const id of ids) this.requireScene(id);
    this.scenes = this.scenes.filter((s) => !ids.includes(s.id));
    for (const track of this.tracks) {
      for (const id of ids) track.clips.delete(id);
    }
  }

  async transact<T>(undoLabel: string, fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    this.undoSteps.push(undoLabel);
    return result;
  }

  // -- internals ------------------------------------------------------------

  private defaultMixer(): FakeMixer {
    return {
      volume: 0.85,
      pan: 0,
      sends: new Map(this.returnTracks.map((r) => [r.id, 0])),
    };
  }

  private mixerState(track: FakeTrack): MixerState {
    return {
      volume: track.mixer.volume,
      pan: track.mixer.pan,
      sends: this.returnTracks.map((r) => ({
        returnId: r.id,
        value: track.mixer.sends.get(r.id) ?? 0,
      })),
    };
  }

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
      deviceNames: track.devices.map((d) => d.name),
      clipCount: track.clips.size,
    };
  }

  private summarizeClip(clip: FakeClip) {
    return {
      id: clip.id,
      kind: clip.kind,
      name: clip.name,
      lengthBeats: clip.lengthBeats,
      looping: clip.looping,
      noteCount: clip.notes.length,
      ...(clip.color !== undefined ? { color: clip.color } : {}),
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

  protected findDevice(
    id: DeviceId,
  ): { track: FakeTrack; device: FakeDevice } | undefined {
    for (const track of this.tracks) {
      const device = track.devices.find((d) => d.id === id);
      if (device) return { track, device };
    }
    return undefined;
  }

  protected mintClipId(): ClipId {
    return `c${++this.counters.clip}`;
  }
}
