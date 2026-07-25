/**
 * LivePort adapter over @ableton-extensions/sdk 1.0 — the ONLY file in the
 * codebase that imports the SDK (enforced by scripts/check-boundaries.mjs).
 * Excluded from the CI typecheck (tsconfig.json); typechecked locally via
 * `npm run typecheck:sdk` after `npm run setup:sdk`.
 *
 * Behavioral reference: src/adapters/fake/fake-live.ts — error codes,
 * messages, and hints must match it exactly (pinned by the Plan-3 contract
 * self-tests). Signatures follow docs/sdk-notes.md (verified against the
 * vendored 1.0.0-beta.0 declarations).
 *
 * ID strategy (ADR 0003): session-stable IDs are minted on sight during reads
 * by walking context.application.song. Resolution re-walks the current graph;
 * a registered object that is no longer reachable is forgotten and reported
 * as NOT_FOUND. The SDK caches objects by handle ID (same Live object → same
 * SDK instance), so referential equality is a valid liveness check.
 */
import {
  AudioClip,
  AudioTrack,
  MidiClip,
  MidiTrack,
  Simpler,
  WarpMode as SdkWarpMode,
  type Clip,
  type ClipSlot,
  type CuePoint,
  type Device,
  type DeviceParameter,
  type ExtensionContext,
  type Sample,
  type Scene,
  type Song,
  type Track,
} from "@ableton-extensions/sdk";

import { PortError, type PortErrorCode } from "../../port/errors.js";
import type { LivePort } from "../../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  ClipKind,
  ClipPatch,
  ClipSummary,
  CueId,
  CueRef,
  DeviceDetail,
  DeviceId,
  DeviceParam,
  MixerPatch,
  MixerState,
  Note,
  SceneId,
  ScenePatch,
  SceneSummary,
  SendLevel,
  SetSnapshot,
  SongPatch,
  TrackDetail,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
  UpdateSongResult,
  WarpMode,
} from "../../port/types.js";
import { colorFromHex, colorToHex, noteFromSdk, noteToSdk, toNumber } from "./codec.js";
import { IdRegistry } from "./id-registry.js";

type V = "1.0.0";

/**
 * The SDK WarpMode enum is not contiguous (ComplexPro = 6), so the mapping to
 * the port's string union is an explicit table rather than an index.
 */
const WARP_MODE_PAIRS: ReadonlyArray<readonly [SdkWarpMode, WarpMode]> = [
  [SdkWarpMode.Beats, "beats"],
  [SdkWarpMode.Tones, "tones"],
  [SdkWarpMode.Texture, "texture"],
  [SdkWarpMode.Repitch, "repitch"],
  [SdkWarpMode.Complex, "complex"],
  [SdkWarpMode.ComplexPro, "complexPro"],
];

/**
 * Reads must be TOTAL: Live's LOM defines `warp_mode 5 = REX` (for `.rx2`
 * files), a value the SDK enum leaves unassigned, and other modes may appear in
 * future Live versions. An unmapped mode yields `undefined` so the caller can
 * omit `warpMode` (keeping `warping`) instead of making the whole clip
 * unreadable. The write path (`warpModeToSdk`) still rejects unknown modes.
 */
function warpModeFromSdk(mode: number): WarpMode | undefined {
  return WARP_MODE_PAIRS.find(([sdk]) => sdk === mode)?.[1];
}

function warpModeToSdk(mode: WarpMode): SdkWarpMode {
  const found = WARP_MODE_PAIRS.find(([, port]) => port === mode);
  if (!found) throw new PortError("INTERNAL", `unknown warp mode ${mode}`);
  return found[0];
}

/**
 * Wraps a Live write whose rejection is foreseeable, so a host refusal reaches
 * the model as a coded, actionable failure instead of a bare INTERNAL ("this is
 * a bug in the extension") that also discards Live's own message — the same
 * idiom `insertDevice` and `setSimplerSample` use inline. FakeLive never throws
 * on these paths, so these mappings are real-Live-only and CI cannot cover them.
 */
async function liveRefusal<T>(
  fn: () => Promise<T>,
  code: PortErrorCode,
  fallbackMessage: string,
  hint: string,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PortError) throw err;
    const message = err instanceof Error && err.message ? err.message : fallbackMessage;
    throw new PortError(code, message, hint);
  }
}

interface ResolvedClip {
  track: Track<V>;
  slot: ClipSlot<V>;
  sceneIndex: number;
  clip: Clip<V>;
}

export class SdkAdapter implements LivePort {
  private readonly trackIds = new IdRegistry<Track<V>>("t");
  private readonly sceneIds = new IdRegistry<Scene<V>>("s");
  private readonly clipIds = new IdRegistry<Clip<V>>("c");
  private readonly deviceIds = new IdRegistry<Device<V>>("d");
  private readonly returnIds = new IdRegistry<Track<V>>("r");
  private readonly cueIds = new IdRegistry<CuePoint<V>>("q");

  constructor(private readonly context: ExtensionContext<V>) {}

  // -- reads ----------------------------------------------------------------

  async getSet(): Promise<SetSnapshot> {
    const song = this.song;
    const cuePoints = song.cuePoints;
    return {
      tempo: toNumber(song.tempo),
      scaleName: song.scaleName,
      rootNote: toNumber(song.rootNote),
      tracks: song.tracks.map((t) => this.summarizeTrack(t)),
      scenes: song.scenes.map((s) => this.summarizeScene(s)),
      returnTracks: song.returnTracks.map((r) => ({
        id: this.returnIds.idFor(r),
        name: r.name,
      })),
      // Token economy: cues only when the set has any, sorted by time to match
      // how Live presents locators (and FakeLive's ordering).
      ...(cuePoints.length > 0
        ? {
            cues: [...cuePoints]
              .sort((a, b) => toNumber(a.time) - toNumber(b.time))
              .map((cp) => this.cueRef(cp)),
          }
        : {}),
    };
  }

  async getTrack(id: TrackId): Promise<TrackDetail> {
    const track = this.resolveTrack(id);
    const scenes = this.song.scenes;
    const slots = track.clipSlots;
    return {
      ...this.summarizeTrack(track),
      // clipSlots is an array parallel to song.scenes (docs/sdk-notes.md §5).
      slots: scenes.map((scene, i) => {
        const clip = slots[i]?.clip ?? null;
        return {
          sceneId: this.sceneIds.idFor(scene),
          clip: clip ? this.summarizeClip(clip) : null,
        };
      }),
      devices: track.devices.map((d) => ({
        id: this.deviceIds.idFor(d),
        name: d.name,
      })),
      mixer: await this.mixerState(track),
    };
  }

  async getClip(id: ClipId): Promise<ClipDetail> {
    const { track, sceneIndex, clip } = this.resolveClip(id);
    const scene = this.song.scenes[sceneIndex];
    if (!scene) {
      throw new PortError("INTERNAL", `clip ${id} scene index out of range`);
    }
    const filePath = this.clipFilePath(clip);
    // Warp state is audio-only; omitted on MIDI clips (matches FakeLive).
    // warpMode is additionally omitted when Live reports a mode this SDK
    // version does not name (e.g. REX) — the clip stays readable either way.
    const warpMode =
      clip instanceof AudioClip ? warpModeFromSdk(toNumber(clip.warpMode)) : undefined;
    return {
      ...this.summarizeClip(clip),
      trackId: this.trackIds.idFor(track),
      sceneId: this.sceneIds.idFor(scene),
      notes: clip instanceof MidiClip ? clip.notes.map(noteFromSdk) : [],
      ...(filePath !== undefined ? { filePath } : {}),
      ...(clip instanceof AudioClip ? { warping: clip.warping } : {}),
      ...(warpMode !== undefined ? { warpMode } : {}),
    };
  }

  async getDevice(id: DeviceId): Promise<DeviceDetail> {
    const { track, device } = this.resolveDevice(id);
    return await this.deviceDetail(track, device);
  }

  // -- writes ---------------------------------------------------------------

  async createTracks(specs: TrackSpec[]): Promise<TrackSummary[]> {
    // Resolve every duplicate source before creating anything (all-or-nothing),
    // mirroring FakeLive.
    const sources = new Map<TrackSpec, Track<V>>();
    for (const spec of specs) {
      if (spec.duplicateOf !== undefined) {
        sources.set(spec, this.resolveTrack(spec.duplicateOf));
      }
    }
    const created: TrackSummary[] = [];
    for (const spec of specs) {
      const source = sources.get(spec);
      let track: Track<V>;
      if (source) {
        // Live inserts the duplicate immediately after the ORIGINAL, so N
        // duplicates of one source land in reverse order (FakeLive matches).
        track = await liveRefusal(
          () => this.song.duplicateTrack(source),
          "UNSUPPORTED",
          `could not duplicate track ${spec.duplicateOf}`,
          "Live refused the duplicate. Create a new track with type instead, or duplicate a different track.",
        );
      } else if (spec.type === "midi") {
        track = await this.song.createMidiTrack();
      } else if (spec.type === "audio") {
        track = await this.song.createAudioTrack();
      } else {
        throw new PortError(
          "INVALID_INPUT",
          "each track spec needs exactly one of type or duplicateOf",
        );
      }
      // Unlike FakeLive, Live assigns its own default track name; we only
      // override when the caller supplied one.
      if (spec.name !== undefined) track.name = spec.name;
      created.push(this.summarizeTrack(track));
    }
    return created;
  }

  async updateTrack(id: TrackId, patch: TrackPatch): Promise<void> {
    const track = this.resolveTrack(id);
    if (patch.name !== undefined) track.name = patch.name;
    if (patch.muted !== undefined) track.mute = patch.muted;
    if (patch.soloed !== undefined) track.solo = patch.soloed;
    if (patch.armed !== undefined) track.arm = patch.armed;
  }

  async deleteTracks(ids: TrackId[]): Promise<void> {
    // Resolve everything (NOT_FOUND) before the first mutation; dedupe so
    // repeated IDs behave like FakeLive's filter-based delete.
    const tracks = [...new Set(ids.map((id) => this.resolveTrack(id)))];
    for (const track of tracks) {
      await this.song.deleteTrack(track);
      this.trackIds.forget(track);
    }
  }

  async createScenes(count: number, duplicateOf?: SceneId): Promise<SceneSummary[]> {
    const created: SceneSummary[] = [];
    if (duplicateOf !== undefined) {
      const { scene: source } = this.resolveScene(duplicateOf);
      for (let i = 0; i < count; i++) {
        // Live inserts the duplicate immediately after the ORIGINAL, so N
        // duplicates of one source land in reverse order (FakeLive matches).
        const copy = await liveRefusal(
          () => this.song.duplicateScene(source),
          "UNSUPPORTED",
          `could not duplicate scene ${duplicateOf}`,
          "Live refused the duplicate. Append empty scenes with count instead, or duplicate a different scene.",
        );
        created.push(this.summarizeScene(copy));
      }
      return created;
    }
    for (let i = 0; i < count; i++) {
      // -1 appends at the end (docs/sdk-notes.md §3), matching FakeLive.
      const scene = await this.song.createScene(-1);
      created.push(this.summarizeScene(scene));
    }
    return created;
  }

  async updateScene(id: SceneId, patch: ScenePatch): Promise<void> {
    const { scene } = this.resolveScene(id);
    if (patch.name !== undefined) scene.name = patch.name;
  }

  async deleteScenes(ids: SceneId[]): Promise<void> {
    const scenes = [...new Set(ids.map((id) => this.resolveScene(id).scene))];
    for (const scene of scenes) {
      await this.song.deleteScene(scene);
      this.sceneIds.forget(scene);
    }
  }

  async createMidiClip(
    trackId: TrackId,
    sceneId: SceneId,
    lengthBeats: number,
    notes: Note[],
    name?: string,
  ): Promise<ClipDetail> {
    const track = this.resolveTrack(trackId);
    const { index: sceneIndex } = this.resolveScene(sceneId);
    if (!(track instanceof MidiTrack)) {
      throw new PortError(
        "INVALID_INPUT",
        `track ${trackId} is an audio track`,
        "MIDI clips can only be created on MIDI tracks.",
      );
    }
    const slot = this.slotAt(track, sceneIndex);
    if (slot.clip !== null) {
      throw new PortError(
        "CONFLICT",
        `slot ${trackId}/${sceneId} already has a clip`,
        "Delete the existing clip first, or pick an empty slot (see get_track).",
      );
    }
    const clip = await slot.createMidiClip(lengthBeats);
    if (notes.length > 0) clip.notes = notes.map(noteToSdk);
    if (name !== undefined) clip.name = name;
    return await this.getClip(this.clipIds.idFor(clip));
  }

  async createAudioClip(
    trackId: TrackId,
    sceneId: SceneId,
    filePath: string,
    name?: string,
  ): Promise<ClipDetail> {
    const track = this.resolveTrack(trackId);
    const { index: sceneIndex } = this.resolveScene(sceneId);
    if (!(track instanceof AudioTrack)) {
      throw new PortError(
        "INVALID_INPUT",
        `track ${trackId} is a MIDI track`,
        "Audio clips can only be created on audio tracks.",
      );
    }
    const slot = this.slotAt(track, sceneIndex);
    if (slot.clip !== null) {
      throw new PortError(
        "CONFLICT",
        `slot ${trackId}/${sceneId} already has a clip`,
        "Delete the existing clip first, or pick an empty slot (see get_track).",
      );
    }
    const clip = await slot.createAudioClip({ filePath });
    if (name !== undefined) clip.name = name;
    return await this.getClip(this.clipIds.idFor(clip));
  }

  async updateClip(id: ClipId, patch: ClipPatch): Promise<void> {
    const { clip } = this.resolveClip(id);
    // Reject warp writes on MIDI clips BEFORE any mutation, so a rejected
    // patch never lands half of its fields.
    if (
      (patch.warping !== undefined || patch.warpMode !== undefined) &&
      !(clip instanceof AudioClip)
    ) {
      throw new PortError(
        "UNSUPPORTED",
        `clip ${id} is a MIDI clip`,
        "warping and warpMode apply to audio clips only.",
      );
    }
    if (patch.name !== undefined) clip.name = patch.name;
    if (patch.looping !== undefined) clip.looping = patch.looping;
    if (patch.color !== undefined) clip.color = colorFromHex(patch.color);
    if (clip instanceof AudioClip) {
      if (patch.warping !== undefined) clip.warping = patch.warping;
      if (patch.warpMode !== undefined) clip.warpMode = warpModeToSdk(patch.warpMode);
    }
  }

  async deleteClips(ids: ClipId[]): Promise<void> {
    // Resolve everything before the first mutation; dedupe by resolved clip
    // so duplicate IDs succeed like they do in FakeLive.
    const resolved = ids.map((id) => this.resolveClip(id));
    const seen = new Set<Clip<V>>();
    for (const { slot, clip } of resolved) {
      if (seen.has(clip)) continue;
      seen.add(clip);
      await slot.deleteClip();
      this.clipIds.forget(clip);
    }
  }

  async replaceClipNotes(id: ClipId, notes: Note[]): Promise<void> {
    const { clip } = this.resolveClip(id);
    if (!(clip instanceof MidiClip)) {
      throw new PortError(
        "INVALID_INPUT",
        `clip ${id} is an audio clip`,
        "Only MIDI clips have notes.",
      );
    }
    clip.notes = notes.map(noteToSdk);
  }

  async insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail> {
    const track = this.resolveTrack(trackId);
    // Validate the insert position before touching Live so a bad index never
    // opens an empty undo step; message mirrors FakeLive.
    const at = index ?? track.devices.length;
    if (!Number.isInteger(at) || at < 0 || at > track.devices.length) {
      throw new PortError(
        "INVALID_INPUT",
        `device index ${index} out of range 0..${track.devices.length}`,
      );
    }
    // The SDK has no device catalog; unknown names throw at insert time. Wrap
    // any non-PortError throw as INVALID_INPUT (the SDK only accepts exact
    // built-in Live device names).
    let device: Device<V>;
    try {
      device = await track.insertDevice(deviceName, at);
    } catch (err) {
      if (err instanceof PortError) throw err;
      const message =
        err instanceof Error && err.message
          ? err.message
          : `could not insert device "${deviceName}"`;
      throw new PortError(
        "INVALID_INPUT",
        message,
        "Use exact built-in Live device names, e.g. Reverb, Auto Filter.",
      );
    }
    return await this.deviceDetail(track, device);
  }

  async duplicateDevice(id: DeviceId): Promise<DeviceDetail> {
    const { track, device } = this.resolveDevice(id);
    // The copy lands directly after the original in the device chain.
    const copy = await liveRefusal(
      () => track.duplicateDevice(device),
      "UNSUPPORTED",
      `could not duplicate device ${id}`,
      "Live refused the duplicate. Insert a fresh device with trackId + device instead.",
    );
    return await this.deviceDetail(track, copy);
  }

  async setSimplerSample(
    id: DeviceId,
    filePath: string,
  ): Promise<{ samplePath: string }> {
    const { device } = this.resolveDevice(id);
    if (!(device instanceof Simpler)) {
      throw new PortError(
        "UNSUPPORTED",
        `device ${id} is a ${device.name}, not a Simpler`,
        "set_simpler_sample only works on Simpler devices (see get_track for names).",
      );
    }
    // Live throws when the path is missing or not a readable audio file;
    // FakeLive cannot check, so this NOT_FOUND mapping is real-Live-only.
    let sample: Sample<V>;
    try {
      sample = await device.replaceSample(filePath);
    } catch (err) {
      if (err instanceof PortError) throw err;
      const message =
        err instanceof Error && err.message
          ? err.message
          : `could not load sample "${filePath}"`;
      throw new PortError(
        "NOT_FOUND",
        message,
        `Check that ${filePath} exists and is an audio file readable by Live.`,
      );
    }
    return { samplePath: sample.filePath };
  }

  async setDeviceParams(id: DeviceId, params: Record<string, number>): Promise<void> {
    const { device } = this.resolveDevice(id);
    // Validate every entry against sync metadata BEFORE any setValue, so a bad
    // entry never leaves a partial write (all-or-nothing). Messages match
    // FakeLive verbatim.
    const updates: Array<{ param: DeviceParameter<V>; value: number }> = [];
    for (const [name, value] of Object.entries(params)) {
      const param = device.parameters.find((p) => p.name === name);
      if (!param) {
        throw new PortError(
          "INVALID_INPUT",
          `device ${id} has no parameter "${name}"`,
          `Valid parameters: ${device.parameters.map((p) => p.name).join(", ")}.`,
        );
      }
      const min = toNumber(param.min);
      const max = toNumber(param.max);
      if (value < min || value > max) {
        throw new PortError(
          "INVALID_INPUT",
          `parameter "${name}" value ${value} outside [${min}, ${max}]`,
        );
      }
      if (param.isQuantized && !Number.isInteger(value)) {
        throw new PortError(
          "INVALID_INPUT",
          `parameter "${name}" is quantized; value must be an integer`,
        );
      }
      updates.push({ param, value });
    }
    // DeviceParameter values are async-only (docs/sdk-notes.md §7); the caller
    // wraps this in transact for a single undo step.
    await Promise.all(updates.map((u) => u.param.setValue(u.value)));
  }

  async deleteDevice(id: DeviceId): Promise<void> {
    const { track, device } = this.resolveDevice(id);
    await track.deleteDevice(device);
    this.deviceIds.forget(device);
  }

  async setMixer(trackId: TrackId, patch: MixerPatch): Promise<void> {
    const track = this.resolveTrack(trackId);
    const mixer = track.mixer;
    const returns = this.song.returnTracks;
    // Resolve all send targets first (NOT_FOUND before any write). Sends are
    // addressed by song.returnTracks index order, matching mixerState().
    const sendWrites: Array<{ param: DeviceParameter<V>; value: number }> = [];
    for (const send of patch.sends ?? []) {
      const returnTrack = this.returnIds.resolve(send.returnId);
      const index = returnTrack ? returns.indexOf(returnTrack) : -1;
      const param = index === -1 ? undefined : mixer.sends[index];
      if (!param) {
        if (returnTrack) this.returnIds.forget(returnTrack);
        throw PortError.notFound("return track", send.returnId);
      }
      sendWrites.push({ param, value: send.value });
    }
    const writes: Array<Promise<void>> = [];
    if (patch.volume !== undefined) writes.push(mixer.volume.setValue(patch.volume));
    if (patch.pan !== undefined) writes.push(mixer.panning.setValue(patch.pan));
    for (const { param, value } of sendWrites) writes.push(param.setValue(value));
    await Promise.all(writes);
  }

  async updateSong(patch: SongPatch): Promise<UpdateSongResult> {
    // Resolve every referenced cue before any mutation (all-or-nothing),
    // mirroring FakeLive.
    const renames = (patch.renameCues ?? []).map((r) => ({
      cue: this.resolveCue(r.id),
      name: r.name,
    }));
    // Dedupe so repeated IDs behave like FakeLive's filter-based delete
    // (deleting the same cue twice would fail in Live).
    const deletes = [
      ...new Set((patch.deleteCueIds ?? []).map((id) => this.resolveCue(id))),
    ];

    if (patch.tempo !== undefined) this.song.tempo = patch.tempo;
    for (const { cue, name } of renames) cue.name = name;
    for (const cue of deletes) {
      await liveRefusal(
        () => this.song.deleteCuePoint(cue),
        "NOT_FOUND",
        `could not delete cue point ${this.cueIds.idFor(cue)}`,
        "The locator may have been removed in Live since the last read. Call get_set to refresh the cue list.",
      );
      this.cueIds.forget(cue);
    }
    const addedCues: CueRef[] = [];
    for (const add of patch.addCues ?? []) {
      // Live refuses a second locator at an arrangement position that already
      // has one — very reachable from a model, and FakeLive allows it, so this
      // mapping exists only here.
      const cue = await liveRefusal(
        () => this.song.createCuePoint(add.timeBeats),
        "CONFLICT",
        `could not create a cue point at beat ${add.timeBeats}`,
        `Live allows one locator per arrangement position: pick a different beat, or delete the existing locator at beat ${add.timeBeats} first (see get_set cues).`,
      );
      // Live derives a default locator name from the position; only override
      // when the caller supplied one.
      if (add.name !== undefined) cue.name = add.name;
      addedCues.push(this.cueRef(cue));
    }
    return { addedCues };
  }

  async transact<T>(_undoLabel: string, fn: () => Promise<T>): Promise<T> {
    // The SDK has no undo-step naming, so the label is ignored here (the
    // shell's audit log records it instead). withinTransaction requires a
    // synchronous callback; it awaits the returned promise before closing
    // the undo step (docs/sdk-notes.md §1/§9).
    return this.context.withinTransaction(() => fn());
  }

  // -- resolution -----------------------------------------------------------

  private get song(): Song<V> {
    return this.context.application.song;
  }

  /** Re-walks the current graph; forgets and throws if the track is gone. */
  private resolveTrack(id: TrackId): Track<V> {
    const track = this.trackIds.resolve(id);
    if (track) {
      if (this.song.tracks.includes(track)) return track;
      this.trackIds.forget(track);
    }
    throw PortError.notFound("track", id);
  }

  /** Resolves a scene plus its current index in song.scenes. */
  private resolveScene(id: SceneId): { scene: Scene<V>; index: number } {
    const scene = this.sceneIds.resolve(id);
    if (scene) {
      const index = this.song.scenes.indexOf(scene);
      if (index !== -1) return { scene, index };
      this.sceneIds.forget(scene);
    }
    throw PortError.notFound("scene", id);
  }

  /** Re-walks all session slots to locate the clip; forgets it if gone. */
  private resolveClip(id: ClipId): ResolvedClip {
    const clip = this.clipIds.resolve(id);
    if (clip) {
      for (const track of this.song.tracks) {
        const slots = track.clipSlots;
        for (let i = 0; i < slots.length; i++) {
          if (slots[i].clip === clip) {
            return { track, slot: slots[i], sceneIndex: i, clip };
          }
        }
      }
      this.clipIds.forget(clip);
    }
    throw PortError.notFound("clip", id);
  }

  /**
   * Re-walks the tracks' top-level device chains to locate the device and its
   * owning track (the DeviceDetail needs a trackId); forgets it if gone.
   * Matches how getTrack surfaces device IDs (top-level track.devices only).
   */
  private resolveDevice(id: DeviceId): { track: Track<V>; device: Device<V> } {
    const device = this.deviceIds.resolve(id);
    if (device) {
      for (const track of this.song.tracks) {
        if (track.devices.includes(device)) return { track, device };
      }
      this.deviceIds.forget(device);
    }
    throw PortError.notFound("device", id);
  }

  /** Re-walks song.cuePoints; forgets and throws if the cue point is gone. */
  private resolveCue(id: CueId): CuePoint<V> {
    const cue = this.cueIds.resolve(id);
    if (cue) {
      if (this.song.cuePoints.includes(cue)) return cue;
      this.cueIds.forget(cue);
    }
    throw PortError.notFound("cue point", id);
  }

  private slotAt(track: Track<V>, sceneIndex: number): ClipSlot<V> {
    const slot = track.clipSlots[sceneIndex];
    if (!slot) {
      // clipSlots should always be parallel to song.scenes; if not, that is
      // an adapter/SDK invariant violation, not caller error.
      throw new PortError(
        "INTERNAL",
        `track has no clip slot at scene index ${sceneIndex}`,
      );
    }
    return slot;
  }

  // -- snapshots ------------------------------------------------------------

  private summarizeTrack(track: Track<V>): TrackSummary {
    return {
      id: this.trackIds.idFor(track),
      name: track.name,
      type: this.trackType(track),
      muted: track.mute,
      soloed: track.solo,
      armed: track.arm,
      deviceNames: track.devices.map((d) => d.name),
      // Session clips only, matching FakeLive's session-view model.
      clipCount: track.clipSlots.filter((s) => s.clip !== null).length,
    };
  }

  private cueRef(cue: CuePoint<V>): CueRef {
    return {
      id: this.cueIds.idFor(cue),
      name: cue.name,
      timeBeats: toNumber(cue.time),
    };
  }

  private summarizeScene(scene: Scene<V>): SceneSummary {
    return { id: this.sceneIds.idFor(scene), name: scene.name };
  }

  private summarizeClip(clip: Clip<V>): ClipSummary {
    // Mirror Live's session-clip "length": loop length while looping,
    // otherwise the start/end-marker span. Pinned by the Plan-3 contract
    // self-tests against real Live.
    const lengthBeats = clip.looping
      ? toNumber(clip.loopEnd) - toNumber(clip.loopStart)
      : toNumber(clip.endMarker) - toNumber(clip.startMarker);
    return {
      id: this.clipIds.idFor(clip),
      kind: this.clipKind(clip),
      name: clip.name,
      lengthBeats,
      looping: clip.looping,
      noteCount: clip instanceof MidiClip ? clip.notes.length : 0,
      // SDK clip color is always a plain number with no "unset" state, so
      // color is always present here — a documented divergence from FakeLive,
      // which omits it until explicitly set.
      color: colorToHex(clip.color),
    };
  }

  private trackType(track: Track<V>): "midi" | "audio" {
    // Group tracks (neither MidiTrack nor AudioTrack) are reported as
    // "audio", matching their audio-signal role in Live. Verify in-Live.
    return track instanceof MidiTrack ? "midi" : "audio";
  }

  private clipKind(clip: Clip<V>): ClipKind {
    return clip instanceof MidiClip ? "midi" : "audio";
  }

  private clipFilePath(clip: Clip<V>): string | undefined {
    return clip instanceof AudioClip ? clip.filePath : undefined;
  }

  private async deviceDetail(track: Track<V>, device: Device<V>): Promise<DeviceDetail> {
    // Parameter metadata is sync; only the VALUES require an async round trip
    // (docs/sdk-notes.md §7) — fetch them all in parallel.
    const params = device.parameters;
    const values = await Promise.all(params.map((p) => p.getValue()));
    // Simpler devices only; a Simpler with no sample loaded reports null.
    const sample = device instanceof Simpler ? device.sample : null;
    return {
      id: this.deviceIds.idFor(device),
      name: device.name,
      trackId: this.trackIds.idFor(track),
      params: params.map((param, i) => this.deviceParam(param, values[i])),
      ...(sample ? { samplePath: sample.filePath } : {}),
    };
  }

  private deviceParam(param: DeviceParameter<V>, value: number): DeviceParam {
    const valueItems = param.valueItems;
    return {
      name: param.name,
      value: toNumber(value),
      min: toNumber(param.min),
      max: toNumber(param.max),
      quantized: param.isQuantized,
      // valueItems are the discrete labels of quantized params; omit for
      // continuous params (empty array), matching FakeLive's shape.
      ...(valueItems.length > 0
        ? { valueItems: valueItems.map((item) => item.name) }
        : {}),
    };
  }

  private async mixerState(track: Track<V>): Promise<MixerState> {
    const mixer = track.mixer;
    const returns = this.song.returnTracks;
    // Mixer levels live inside DeviceParameter objects whose values are
    // async-only (docs/sdk-notes.md §7/§8) — the one async read in the SDK.
    const [volume, pan, ...sendValues] = await Promise.all([
      mixer.volume.getValue(),
      mixer.panning.getValue(),
      ...mixer.sends.map((send) => send.getValue()),
    ]);
    // Assumes mixer.sends is parallel to song.returnTracks (verify in-Live —
    // the SDK does not document the ordering).
    const sends: SendLevel[] = [];
    for (let i = 0; i < returns.length && i < sendValues.length; i++) {
      sends.push({
        returnId: this.returnIds.idFor(returns[i]),
        value: toNumber(sendValues[i]),
      });
    }
    return { volume: toNumber(volume), pan: toNumber(pan), sends };
  }
}
