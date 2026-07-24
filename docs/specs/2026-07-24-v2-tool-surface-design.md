# v2 Tool Surface — Design Spec

**Date:** 2026-07-24
**Status:** Approved
**SDK baseline:** Ableton Extensions SDK 1.0.0-beta.0 (API version `"1.0.0"`)
**Parent spec:** [2026-07-19-ableton-mcp-extension-design.md](2026-07-19-ableton-mcp-extension-design.md)

## 1. Purpose and scope

Expose the eight capabilities the SDK supports but the 21-tool v1 surface does not:
cue points, duplicate (track/scene/device), audio-clip warp, Simpler sample
replacement, take lanes, rack chains, file import, and pre-FX audio render. All are
verified buildable against SDK 1.0.0-beta.0 (signatures re-checked against the
vendored typedoc on 2026-07-24).

The surface grows 21 → 27 tools: **6 new tools**, extensions to **7 existing write
tools**, and richer output on the 4 `get_*` read tools — shaped by the rule *extend an existing tool where the capability is a new
facet of an existing domain; add a tool only for a genuinely new domain*.

**Non-goals:** anything the API cannot do (transport/launch, routing, automation,
song-key write, VST loading, warp-marker editing — see `docs/capability-map.md`);
stdio-bridge in-Live discovery; concurrency hardening. All v1 quality attributes
(P0 token economy, P0 data safety, P1 robustness) apply unchanged.

## 2. Delivery shape

One spec (this document), three plans, three PRs — each independently mergeable,
CI-green, and capability-map-updated:

- **Phase A — quick wins (extend existing tools):** cue points, duplicate, warp,
  Simpler sample.
- **Phase B — new domains:** take lanes, rack chains (introduces arrangement-clip
  and chain modeling in the port).
- **Phase C — file resources:** `import_file`, `render_audio`.

This is the post-v0.1.0 line; the Windows smoke remains the v0.1.0 gate and is
unaffected.

## 3. Phase A — quick wins

### 3.1 Cue points (`update_song` + `get_set`)

SDK: `Song.cuePoints` (read), `Song.createCuePoint(timeBeats)`,
`Song.deleteCuePoint(cp)`, rename via `CuePoint.name` setter. **`CuePoint.time` has
no setter** — a cue cannot be moved.

- `get_set` gains `cues: [{ id, name, timeBeats }]` (compact; omitted when empty).
- `update_song` gains three optional batch fields, processed in one transaction:
  - `addCues: [{ timeBeats, name? }]` — create, then rename when `name` given.
  - `renameCues: [{ id, name }]`
  - `deleteCueIds: [id]`
- All referenced cue IDs are resolved and validated before any mutation
  (all-or-nothing). Result returns minted IDs for created cues and counts for the
  rest — no cue-list dump.
- Attempting to "move" a cue is not expressible in the schema; the tool description
  states time is immutable and the recovery path is delete + re-add.

Cue IDs are minted flat: `q1`, `q2`, … (`c*` is taken by clips).

### 3.2 Duplicate as a create-mode (`create_tracks`, `create_scenes`, `insert_device`)

SDK: `Song.duplicateTrack(track)`, `Song.duplicateScene(scene)`,
`Track.duplicateDevice(device)` / `Chain.duplicateDevice(device)` — duplication is
always performed by the parent, and the copy is inserted immediately after the
original.

- `create_tracks`: a spec may be `{ duplicateOf: trackId, name? }` instead of
  `{ type, name? }` (exactly one of `type` | `duplicateOf`). Mixed batches allowed;
  IDs validated up front; result returns new track summaries.
- `create_scenes`: gains optional `duplicateOf: sceneId` + `count?` (default 1) as an
  alternative to the existing plain `count`. Duplicating N times duplicates the same
  source scene N times.
- `insert_device`: accepts `{ duplicateOf: deviceId }` instead of `deviceName`
  (exactly one of the two). The SDK controls placement (after the original); the
  `index` param is rejected (`INVALID_INPUT`) when combined with `duplicateOf`.
- Duplicates of tracks/scenes/devices carry their nested content (clips, devices,
  chains); results return only the new minted top-level IDs plus a summary, never the
  duplicated content.

### 3.3 Audio-clip warp (`update_clip` + `get_clip`)

SDK: `AudioClip.warping` (get/set), `AudioClip.warpMode` (get/set), enum
`WarpMode { Beats: 0, Tones: 1, Texture: 2, Repitch: 3, Complex: 4, ComplexPro: 6 }`
(note: 5 is unassigned). Warp markers stay read-only in the API.

- `update_clip` patch gains `warping?: boolean` and
  `warpMode?: "beats" | "tones" | "texture" | "repitch" | "complex" | "complexPro"`.
  Applying either to a MIDI clip → `UNSUPPORTED` with a hint naming the clip kind.
- `get_clip` reports `warping` and `warpMode` for audio clips (omitted for MIDI).
- The string↔enum mapping lives in the SDK adapter's codec, including the
  bigint-safe read path (ADR 0009).

### 3.4 Simpler sample (`set_simpler_sample`, new tool)

SDK: `Simpler.sample` (read, `Sample.filePath`), `Simpler.replaceSample(absPath)`.

- New tool `set_simpler_sample(deviceId, filePath)`:
  - `UNSUPPORTED` when the device is not a Simpler (hint names the actual device).
  - `filePath` must be absolute; `INVALID_INPUT` otherwise. `NOT_FOUND` (with the
    path echoed) when Live rejects a missing file.
  - Result: `{ samplePath }` — the newly loaded sample's resolved path.
- `get_device` on a Simpler additionally reports `samplePath` (Phase A adds the
  field opportunistically since the port method exists).
- Description cross-references `import_file` (Phase C) as the recommended way to
  bring foreign files under project management first; an arbitrary absolute path
  still works because the SDK reads it directly.

## 4. Phase B — new domains

Phase B is the structural phase: it introduces **arrangement clips** and **rack
chains** into the port model, which v1 (session-view-only) does not have.

### 4.1 Take lanes

SDK: `Track.takeLanes` (read), `Track.createTakeLane()` (append),
`TakeLane.name` setter, `TakeLane.clips`,
`TakeLane.createMidiClip(startBeats, durationBeats)`,
`TakeLane.createAudioClip({ filePath, startTime, duration?, isWarped?, loopSettings? })`.
Lane clips are **arrangement** clips positioned in beats.

- **IDs:** lanes are minted hierarchically per the existing convention: `t1.l1`,
  `t1.l2`, …
- **Read:** `get_track` gains `takeLanes: [{ id, name, clipIds }]` (omitted when
  the track has none). The lane entry carries only clip IDs, keeping `get_track`
  summary-sized; clip content is drilled per ID via the existing `get_clip` — no
  new list tool.
- **Write:**
  - New tool `create_take_lane(trackId, name?)` — creates (SDK appends to the end)
    and optionally renames in the same transaction; returns `{ id, name }`.
  - New tool `update_take_lane(laneId, { name })` — rename.
  - `create_midi_clip` and `create_audio_clip` accept an alternative target
    `{ laneId, startBeats }` in place of `{ trackId, sceneId }` (exactly one target
    form; `durationBeats` reuses the existing length field). Lane type must match
    clip kind (`UNSUPPORTED` otherwise).
- **Clip model:** `ClipDetail` becomes location-variant: session clips keep
  `{ trackId, sceneId }`; arrangement clips carry `{ trackId, laneId, startBeats }`.
  `update_clip`, `delete_clips`, `replace_clip_notes`, `edit_clip_notes` work on
  lane clips through the same clip IDs with no schema change.

Lane deletion is not in the API (no `deleteTakeLane`) and is listed as such in the
capability map.

### 4.2 Rack chains

SDK: `RackDevice.chains` / `DrumRack.chains` (read),
`RackDevice.insertChain(index)` with `index ∈ [0, chains.length]`,
`Chain.devices` / `Chain.insertDevice(name, index)` / `Chain.deleteDevice(d)` /
`Chain.duplicateDevice(d)`, `DrumChain.receivingNote` (get/set). **There is no
chain delete, move, or rename in the API**, and no device reorder.

- **IDs:** chains are minted hierarchically: `d3.ch1`, `d3.ch2`, … Devices inside
  chains get ordinary flat device IDs (`d*`) usable by every device tool.
- **Read:** `get_device` on a rack gains
  `chains: [{ id, name?, receivingNote?, devices: DeviceRef[] }]`
  (`receivingNote` for drum chains only). Nested racks recurse. Parameter dumps
  stay top-level-device-only — nested devices are drilled via `get_device` on their
  own IDs, keeping the token budget flat.
- **Write:**
  - New tool `insert_chain(rackDeviceId, index?)` — `UNSUPPORTED` when the device
    is not a rack; index defaults to append; returns `{ id }`.
  - `insert_device` accepts `chainId` as an alternative to `trackId` (exactly one),
    composing with both `deviceName` and `duplicateOf` (§3.2).
  - `set_device_params`, `delete_device`, and device-duplicate operate on in-chain
    devices transparently via their device IDs.
- The SDK's asymmetry (insert-only chains) is stated in the `insert_chain`
  description so the model doesn't attempt deletes, and recorded in the capability
  map's "Not possible" column.

## 5. Phase C — file resources

### 5.1 `import_file` (new tool)

SDK: `Resources.importIntoProject(filePath): Promise<string>` — copies the file into
the Live project so Live manages it; **subsequent API calls must use the returned
path**.

- Input: absolute `filePath` (`INVALID_INPUT` otherwise; `NOT_FOUND` when Live
  reports the file missing).
- Result: `{ importedPath }` with the hint "use importedPath (not the original) in
  create_audio_clip / set_simpler_sample".

### 5.2 `render_audio` (new tool)

SDK: `Resources.renderPreFxAudio(track: AudioTrack, startBeats, endBeats):
Promise<string>` — renders a track's **pre-FX arrangement** audio to a WAV in the
extension's temp directory.

- Input: `trackId`, `startBeats`, `endBeats` (`INVALID_INPUT` when
  `endBeats <= startBeats`).
- Constraints surfaced as structured errors: `UNSUPPORTED` for MIDI tracks (the SDK
  accepts only `AudioTrack`); the description states the render is pre-FX and
  arrangement-domain (session clips don't sound here unless present in the
  arrangement).
- Result: `{ path, sizeBytes }` — **file path only, never inline audio** (token
  economy P0; client and Live share a machine over loopback HTTP). The path is in
  the extension temp directory; the hint tells the client to copy the file out
  promptly because temp contents are not guaranteed to persist.

## 6. Port and adapter changes

### 6.1 `LivePort` additions

```ts
// Phase A
duplicateDevice(id: DeviceId): Promise<DeviceDetail>;      // via parent Track/Chain
setSimplerSample(id: DeviceId, filePath: string): Promise<{ samplePath: string }>;
// duplicate-of handling folds into createTracks/createScenes/insertDevice via
// widened spec types; cue ops fold into updateSong via widened SongPatch.

// Phase B
createTakeLane(trackId: TrackId, name?: string): Promise<TakeLaneSummary>;
updateTakeLane(id: TakeLaneId, patch: { name?: string }): Promise<void>;
insertChain(rackId: DeviceId, index?: number): Promise<ChainRef>;
// createMidiClip/createAudioClip gain a ClipTarget union (session slot | lane+start).

// Phase C
importFile(filePath: string): Promise<{ importedPath: string }>;
renderAudio(trackId: TrackId, startBeats: number, endBeats: number):
  Promise<{ path: string; sizeBytes: number }>;
```

DTO extensions: `SetSnapshot.cues`, `TrackDetail.takeLanes`,
`DeviceDetail.chains` + `samplePath?`, `ClipSummary/Detail` warp fields + location
variant, new `CueRef`, `TakeLaneSummary`, `ChainRef` types. `src/port/` keeps zero
imports; everything stays JSON-serializable.

### 6.2 Adapters

- **sdk-1.0:** new handle-registry entries for cue points, take lanes, chains
  (minted IDs ↔ SDK objects, session-stable, stale IDs fail loudly per ADR 0003).
  Warp-mode string↔enum mapping and `toNumber` bigint coercion for
  `receivingNote`/`timeBeats` reads live in `codec.ts` (ADR 0009).
- **fake:** models cues, lanes, chains, warp state, and Simpler samples in memory;
  `renderAudio` writes a small valid stub WAV into a temp dir; `importFile` copies
  into a fake project dir. Fake behavior for each is pinned by new contract tests to
  be verified against real Live at the next smoke.

## 7. Safety and error handling

Unchanged rules, applied to the new surface: every write tool is one
`withinTransaction` undo step with a human-readable label; batch inputs (cues,
mixed create/duplicate specs) resolve and validate **all** IDs before the first
mutation; no tool throws — every failure is `{ code, message, hint }` with
`NOT_FOUND` / `INVALID_INPUT` / `UNSUPPORTED` / `CONFLICT` / `INTERNAL`. Filesystem
touch-points (`import_file` input path, `render_audio` output, Simpler sample path)
go exclusively through SDK-sanctioned APIs — the extension never reads or writes
those paths itself.

## 8. Documentation deliverables

- `docs/capability-map.md`: exposure table rows move `deferred` → per-phase
  `v2 (implemented)`; "Not possible" column gains chain delete/move, lane delete,
  cue move.
- New ADR **0010 — v2 surface shaping**: extend-vs-new tool rule,
  duplicate-as-create-mode, file-path (not payload) exchange for audio, hierarchical
  ID minting for lanes/chains (context → decision → alternatives → consequences).
- `docs/tools.md` regenerated from the zod schemas in each phase (never
  hand-edited).

## 9. Testing

- **Component tests** (the gate): per new/extended tool, real MCP client → server →
  FakeLive, including error paths (MIDI-track render, non-rack `insert_chain`,
  non-Simpler `set_simpler_sample`, mixed-validity batches) and **token-budget
  assertions** — `get_set` with 10 cues, `get_track` with 4 lanes, and `get_device`
  on an 8-chain drum rack must stay within the budgets asserted in the existing
  component-test suite's style.
- **Contract tests:** new FakeLive-pinning checks appended to the in-Live self-test
  (`src/shell/self-test.ts`) so the next real-Live smoke validates cue/lane/chain/
  warp/duplicate/import/render behavior. Render/import checks assert the returned
  paths exist and are non-empty.
- **Smoke:** the build-a-set scenario grows a duplicate-and-warp step; edit-existing
  grows a take-lane read. Run inside real Live before any release that includes
  these phases.

## 10. Acceptance criteria

1. All Phase A–C tools green in CI against FakeLive with token budgets enforced.
2. `npm run lint` boundary check passes — no SDK types outside `src/adapters/sdk-*`.
3. `docs/tools.md`, capability map, and ADR 0010 updated in the same PRs as the
   code they describe.
4. In-Live self-test extended and passing on macOS for each phase before its PR
   merges (Windows tracked separately by the v0.1.0 gate).
