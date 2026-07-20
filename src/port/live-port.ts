import type {
  ClipDetail,
  ClipId,
  DeviceDetail,
  DeviceId,
  MixerPatch,
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
} from "./types.js";

/**
 * Everything the MCP server needs from Ableton Live.
 * Implemented by adapters/sdk-* (real Live, Plan 3) and adapters/fake (tests/dev).
 * Reads are synchronous and reflect Live's current state at call time.
 * Writes are async; callers group them into one undo step via transact().
 */
export interface LivePort {
  getSet(): SetSnapshot;
  getTrack(id: TrackId): TrackDetail;
  getClip(id: ClipId): ClipDetail;
  getDevice(id: DeviceId): DeviceDetail;

  createTracks(specs: TrackSpec[]): Promise<TrackSummary[]>;
  updateTrack(id: TrackId, patch: TrackPatch): Promise<void>;
  deleteTracks(ids: TrackId[]): Promise<void>;
  createScenes(count: number): Promise<SceneSummary[]>;
  createMidiClip(
    trackId: TrackId,
    sceneId: SceneId,
    lengthBeats: number,
    notes: Note[],
    name?: string,
  ): Promise<ClipDetail>;
  replaceClipNotes(id: ClipId, notes: Note[]): Promise<void>;
  insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail>;
  setDeviceParams(id: DeviceId, params: Record<string, number>): Promise<void>;
  deleteDevice(id: DeviceId): Promise<void>;
  setMixer(trackId: TrackId, patch: MixerPatch): Promise<void>;
  updateSong(patch: SongPatch): Promise<void>;

  /** Group all writes inside fn into one undo step named undoLabel. */
  transact<T>(undoLabel: string, fn: () => Promise<T>): Promise<T>;
}
