export type TrackId = string; // "t1", "t2", ... minted per session
export type SceneId = string; // "s1", ...
export type ClipId = string; // "c1", ...
export type DeviceId = string; // "d1", ... minted per session
export type ReturnTrackId = string; // "r1", ...
export type CueId = string; // "q1", ... minted per session ("c" is taken by clips)

export type TrackType = "midi" | "audio";

/** Optional per-note extras; present only when non-default (ADR 0004). */
export interface NoteExtras {
  /** probability 0..1 (default 1) */
  prob?: number;
  /** velocity deviation (default 0) */
  velDev?: number;
  /** default false */
  muted?: boolean;
  /** release velocity 0..127 (default 64) */
  relVel?: number;
}

/** [pitch 0-127, startBeat >= 0, durationBeats > 0, velocity 1-127, extras?] */
export type Note =
  [number, number, number, number] | [number, number, number, number, NoteExtras];

export interface TrackSpec {
  /** Exactly one of type | duplicateOf (validated in TrackService). */
  type?: TrackType;
  name?: string;
  /** Duplicate this track (with its clips/devices); inserted after it. */
  duplicateOf?: TrackId;
}

export interface TrackPatch {
  name?: string;
  muted?: boolean;
  soloed?: boolean;
  armed?: boolean;
}

/** An arrangement cue point (locator). time is immutable in API 1.0.0. */
export interface CueRef {
  id: CueId;
  name: string;
  timeBeats: number;
}

export interface UpdateSongResult {
  /** Minted refs for cues created by addCues; empty when none were added. */
  addedCues: CueRef[];
}

export interface SongPatch {
  tempo?: number;
  addCues?: Array<{ timeBeats: number; name?: string }>;
  renameCues?: Array<{ id: CueId; name: string }>;
  deleteCueIds?: CueId[];
}

/** A single device parameter with its current Live-internal raw value. */
export interface DeviceParam {
  name: string;
  value: number;
  min: number;
  max: number;
  quantized: boolean;
  /** For quantized params: display labels indexed by integer value. */
  valueItems?: string[];
}

export interface DeviceRef {
  id: DeviceId;
  name: string;
}

export interface DeviceDetail extends DeviceRef {
  trackId: TrackId;
  params: DeviceParam[];
}

export interface ReturnTrackSummary {
  id: ReturnTrackId;
  name: string;
}

export interface SendLevel {
  returnId: ReturnTrackId;
  /** 0..1 Live-internal raw value */
  value: number;
}

export interface MixerState {
  /** 0..1 Live-internal raw value (0.85 = 0 dB) */
  volume: number;
  /** -1..1 */
  pan: number;
  sends: SendLevel[];
}

export interface MixerPatch {
  volume?: number;
  pan?: number;
  sends?: SendLevel[];
}

export interface TrackSummary {
  id: TrackId;
  name: string;
  type: TrackType;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  deviceNames: string[];
  clipCount: number;
}

export interface SceneSummary {
  id: SceneId;
  name: string;
}

export interface SetSnapshot {
  tempo: number;
  scaleName: string;
  rootNote: number;
  tracks: TrackSummary[];
  scenes: SceneSummary[];
  returnTracks: ReturnTrackSummary[];
  /** Present only when the set has cue points; sorted by timeBeats. */
  cues?: CueRef[];
}

export type ClipKind = "midi" | "audio";

/** Live's warp algorithms (audio clips). Mirrors the SDK WarpMode enum. */
export type WarpMode =
  "beats" | "tones" | "texture" | "repitch" | "complex" | "complexPro";

export interface ClipPatch {
  name?: string;
  looping?: boolean;
  /** Hex "#RRGGBB" */
  color?: string;
  /** Audio clips only — UNSUPPORTED on MIDI clips. */
  warping?: boolean;
  warpMode?: WarpMode;
}

export interface ScenePatch {
  name?: string;
}

export interface ClipSummary {
  id: ClipId;
  kind: ClipKind;
  name: string;
  lengthBeats: number;
  looping: boolean;
  noteCount: number;
  /** Hex "#RRGGBB"; absent until explicitly set. */
  color?: string;
}

export interface ClipSlot {
  sceneId: SceneId;
  clip: ClipSummary | null;
}

export interface TrackDetail extends TrackSummary {
  slots: ClipSlot[];
  devices: DeviceRef[];
  mixer: MixerState;
}

export interface ClipDetail extends ClipSummary {
  trackId: TrackId;
  sceneId: SceneId;
  notes: Note[];
  /** Audio clips only. */
  filePath?: string;
  /** Audio clips only. */
  warping?: boolean;
  warpMode?: WarpMode;
}
