export type TrackId = string; // "t1", "t2", ... minted per session
export type SceneId = string; // "s1", ...
export type ClipId = string; // "c1", ...

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
  | [number, number, number, number]
  | [number, number, number, number, NoteExtras];

export interface TrackSpec {
  type: TrackType;
  name?: string;
}

export interface TrackPatch {
  name?: string;
  muted?: boolean;
  soloed?: boolean;
  armed?: boolean;
}

export interface SongPatch {
  tempo?: number;
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
}

export interface ClipSummary {
  id: ClipId;
  name: string;
  lengthBeats: number;
  looping: boolean;
  noteCount: number;
}

export interface ClipSlot {
  sceneId: SceneId;
  clip: ClipSummary | null;
}

export interface TrackDetail extends TrackSummary {
  slots: ClipSlot[];
}

export interface ClipDetail extends ClipSummary {
  trackId: TrackId;
  sceneId: SceneId;
  notes: Note[];
}
