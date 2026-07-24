import type {
  ClipDetail,
  ClipId,
  ClipPatch,
  DeviceDetail,
  DeviceId,
  MixerPatch,
  Note,
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
} from "./types.js";

/**
 * Everything the MCP server needs from Ableton Live.
 * Implemented by adapters/sdk-* (real Live, Plan 3) and adapters/fake (tests/dev).
 * Reads are async because some SDK values (device parameters) require async
 * host calls; implementations must not mutate state in reads.
 * Writes are async; callers group them into one undo step via transact().
 */
export interface LivePort {
  getSet(): Promise<SetSnapshot>;
  getTrack(id: TrackId): Promise<TrackDetail>;
  getClip(id: ClipId): Promise<ClipDetail>;
  getDevice(id: DeviceId): Promise<DeviceDetail>;

  createTracks(specs: TrackSpec[]): Promise<TrackSummary[]>;
  updateTrack(id: TrackId, patch: TrackPatch): Promise<void>;
  deleteTracks(ids: TrackId[]): Promise<void>;
  createScenes(count: number): Promise<SceneSummary[]>;
  updateScene(id: SceneId, patch: ScenePatch): Promise<void>;
  deleteScenes(ids: SceneId[]): Promise<void>;
  createMidiClip(
    trackId: TrackId,
    sceneId: SceneId,
    lengthBeats: number,
    notes: Note[],
    name?: string,
  ): Promise<ClipDetail>;
  createAudioClip(
    trackId: TrackId,
    sceneId: SceneId,
    filePath: string,
    name?: string,
  ): Promise<ClipDetail>;
  updateClip(id: ClipId, patch: ClipPatch): Promise<void>;
  deleteClips(ids: ClipId[]): Promise<void>;
  replaceClipNotes(id: ClipId, notes: Note[]): Promise<void>;
  insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail>;
  setDeviceParams(id: DeviceId, params: Record<string, number>): Promise<void>;
  deleteDevice(id: DeviceId): Promise<void>;
  setMixer(trackId: TrackId, patch: MixerPatch): Promise<void>;
  updateSong(patch: SongPatch): Promise<UpdateSongResult>;

  /** Group all writes inside fn into one undo step named undoLabel. */
  transact<T>(undoLabel: string, fn: () => Promise<T>): Promise<T>;
}
