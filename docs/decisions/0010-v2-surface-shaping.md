# 0010 — v2 surface shaping: extend before adding

## Context

The [v2 tool surface design spec](../specs/2026-07-24-v2-tool-surface-design.md)
exposes eight SDK capabilities the v1 surface left out: cue points, duplicate
(track/scene/device), audio-clip warp, Simpler sample replacement, take lanes,
rack chains, file import, and pre-FX audio render. Each capability could become
its own MCP tool, but tool count is not free — every tool adds a schema to the
client's context on every turn, and CLAUDE.md's token-economy rule (P0) treats
that growth as a cost to be justified, not a default. The spec needed a
consistent rule for when a capability gets a new tool versus an extension to an
existing one, applied across all three delivery phases (4a/4b/4c) so the surface
doesn't grow ad hoc.

## Decision

Extend an existing tool when the capability is a new facet of a domain the tool
already owns; add a new tool only when the capability is a genuinely new domain
with no existing owner.

- **Cues → `update_song` / `get_set`.** Cues are a song-level concept `update_song`
  already writes and `get_set` already summarizes; `addCues`/`renameCues`/
  `deleteCueIds` are new optional batch fields, not a new tool.
- **Warp → `update_clip` / `get_clip`.** Warp fields (`warping`, `warpMode`) are
  clip properties alongside the loop/marker fields `update_clip` and `get_clip`
  already own.
- **Duplicate → create-mode, not a tool.** `create_tracks`, `create_scenes`, and
  `insert_device` gain a `duplicateOf` alternative to their existing
  create-from-scratch inputs (exactly one of `type`/`duplicateOf`,
  `device`/`duplicateOf`, etc.). Duplication is semantically "create a track /
  scene / device" with a different source, not a new action needing its own tool
  and its own result shape.
- **New domains get new tools.** `set_simpler_sample` (Phase A, this PR) has no
  existing owner — no tool touches Simpler-specific state. The same reasoning
  will apply in later phases: `create_take_lane`/`update_take_lane` and
  `insert_chain` (Plan 4b) introduce take lanes and rack chains, domains v1's
  session-view-only port model has no representation for; `import_file` and
  `render_audio` (Plan 4c) introduce file-resource exchange, which no existing
  tool models either.
- **ID minting follows the same "new facet vs. new domain" split.** Cues are a
  flat, song-level collection like clips, so they get a flat namespace: `q1`,
  `q2`, … (`c*` is already taken by clips). Take lanes and rack chains are
  _subordinate_ to an existing minted object (a track, a device) and only make
  sense in that context, so Plan 4b mints them hierarchically: `t1.l1`, `t1.l2`,
  … for lanes; `d3.ch1`, `d3.ch2`, … for chains. Devices inside a chain keep
  ordinary flat `d*` IDs so every existing device tool (`get_device`,
  `set_device_params`, `delete_device`, duplicate) works on them unmodified.
- **File-resource results exchange paths, never payloads.** `import_file` and
  `render_audio` (Plan 4c) return a file path (plus size, for renders), not
  inline audio — consistent with the token-economy rule and with the client and
  Live sharing a machine over loopback HTTP, so a shared path is cheap and a
  payload copy is not.

## Alternatives

- **A dedicated tool per capability** (`add_cue`, `move_cue`, `set_warp`,
  `duplicate_track`, `duplicate_scene`, `duplicate_device`, …). Rejected: this is
  the schema-token-bloat failure mode the token-economy rule exists to prevent —
  eight capabilities would become eight-plus tools whose schemas the client pays
  for on every turn, most of them thin wrappers around one or two fields already
  adjacent to an existing tool's domain.
- **One polymorphic `duplicate` tool** taking a `kind` discriminator
  (`"track" | "scene" | "device"`) plus a source ID. Rejected: it would need
  its own result shape per kind (a track summary vs. a scene summary vs. a
  device summary), giving no schema savings over extending the three existing
  create tools, while adding a fourth ID namespace question ("is the returned
  ID a track ID, a device ID, …?") and murkier error messages (a
  duplicate-shaped error path separate from create's).

## Consequences

- Tool count: 21 (v1) → 22 in Phase A (this PR) — one new tool
  (`set_simpler_sample`), the rest folded into existing tools. The spec projects
  27 after Phase C (4b adds `create_take_lane`, `update_take_lane`,
  `insert_chain`; 4c adds `import_file`, `render_audio`).
- Extended tools' schemas grow unions and optionals — `type` vs. `duplicateOf`
  on `create_tracks`, `{ trackId, sceneId }` vs. `{ laneId, startBeats }` on
  clip creation, `device` vs. `duplicateOf` on `insert_device`, `trackId` vs.
  `chainId` also on `insert_device`. "Exactly one of" is not a single uniform
  rule — each tool's real constraint, and where it lives, differs: `create_tracks`
  requires exactly one of `type`/`duplicateOf` per spec, enforced in
  `TrackService.createTracks` (`INVALID_INPUT` otherwise); `create_scenes`
  requires only _at least_ one of `count`/`duplicateOf` — combining them is
  valid and means "duplicate the source `count` times" — also enforced in
  `TrackService`; `insert_device`'s `device`/`duplicateOf` exclusivity is
  enforced in the MCP tool handler itself (`src/mcp/tools/devices.ts`), not in
  `DeviceService`, which only exposes separate `insertDevice`/`duplicateDevice`
  port calls. Each tool's own description and error message state its actual
  rule rather than a schema comment implying one uniform pattern.
- API asymmetries this decision surfaces as structured errors rather than
  silently-absent features: cue time has no setter (`update_song` describes
  delete-and-re-add as the recovery path for "moving" a cue); chains will have
  no delete/move/rename and lanes no delete (Plan 4b — both to be stated in the
  relevant tool's description and recorded in the capability map's "Not
  possible" column, so the model sees the constraint before attempting the call
  and gets `UNSUPPORTED` with a hint if it tries anyway).
- Every future v2 capability gets evaluated against this same rule before Plans
  4b/4c are written: a facet of an existing domain extends that domain's tool; a
  new domain earns a new tool.
