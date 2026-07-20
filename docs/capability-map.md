# Capability Map — Ableton Extensions SDK

**SDK version:** 1.0.0-beta.0 · **API version:** `"1.0.0"` · **Last verified:** 2026-07-19

Bird's-eye view of what the Live API exposes, what we surface over MCP, and what is
impossible in the current API version. This file is the reasoning surface for every
"can we do X?" question. **Update on every SDK version bump** (see the upgrade
playbook in the design spec).

| Domain | Read | Write | Not possible in 1.0.0 |
|---|---|---|---|
| **Song/Set** | tempo, scale, root note, grid, cue points | tempo, cue point create/delete/rename | time signature write, transport (play/stop/record/position), arrangement loop |
| **Tracks** | name, mute/solo/arm, group, type | create/delete/duplicate MIDI+audio tracks, rename, mute/solo/arm | routing, track color, freeze |
| **Scenes** | name, tempo, time sig | create/delete/duplicate, rename | scene launch, scene tempo write |
| **Clips (session + arrangement)** | name, color, loop settings, markers, mute | create/delete MIDI+audio clips, all writable clip props | clip launch/playback |
| **MIDI notes** | full read (`MidiClip.notes`) | full write — wholesale replace per clip | per-note streaming/incremental updates |
| **Audio clips** | file path, warp mode/flag, warp markers | create from file, warp mode/flag | warp-marker editing/creation |
| **Devices** | device tree, all parameters (name/min/max/value/quantized items), racks/chains, Simpler sample | insert built-in devices by name, delete/duplicate, set params, rack chains, replace Simpler sample | third-party VST/AU loading, preset browsing |
| **Mixer** | volume/pan/sends as DeviceParameters | set volume/pan/sends | metering, crossfader |
| **Take lanes** | lanes, clips, names | create lanes, create clips in lanes, rename | — |
| **Utility** | — | render pre-FX arrangement audio to WAV, import file into project | Live browser access, automation envelopes, change events/observers |

## Cross-cutting facts

- **No event/observer API** — all reads are synchronous getters (poll to detect
  changes); all mutations are async Promises.
- **Undo**: each mutation individually undoable; `withinTransaction` groups into one
  undo step (synchronous callback; batch async via `Promise.all`).
- **Handles**: opaque bigint IDs, session-stable, resolvable via
  `getObjectFromHandle`; throw when the entity is deleted.
- **Filesystem**: restricted to `storageDirectory` + `tempDirectory`; external files
  enter via `resources.importIntoProject`.
- **Runtime**: full Node.js ≥ 24.14.1, single bundled CJS entry file; outbound
  `fetch` supported; inbound servers undocumented (works, not endorsed — see
  ADR 0002).
- **Explicit SDK non-goals**: real-time audio, MIDI routing, drawing into Live's UI,
  background/persistent extensions, control surfaces.

## MCP exposure status

| Capability | MCP tool(s) | Status |
|---|---|---|
| Set overview / drill-down | `get_set`, `get_track`, `get_clip` | v1 (implemented) |
| Track CRUD | `create_tracks`, `update_track`, `delete_tracks` | v1 (implemented) |
| Scene create | `create_scenes` | v1 (implemented) |
| Scene update/delete | `update_scene`, `delete_scenes` | v1 (planned — Plan 2) |
| Clip create MIDI | `create_midi_clip` | v1 (implemented) |
| Clip create/update/delete audio | `create_audio_clip`, `update_clip`, `delete_clips` | v1 (planned — Plan 2) |
| Note editing (replace) | `replace_clip_notes` | v1 (implemented) |
| Note editing (edit) | `edit_clip_notes` | v1 (planned — Plan 2) |
| Devices | `get_device`, `insert_device`, `set_device_params`, `delete_device` | v1 (planned — Plan 2) |
| Mixer | `set_mixer` | v1 (planned — Plan 2) |
| Song | `update_song` | v1 (implemented) |
| Audio render / file import | `render_audio`, `import_file` | deferred |
| Take lanes, Simpler sample, rack chains | — | deferred |
