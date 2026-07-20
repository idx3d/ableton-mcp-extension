# Ableton MCP Extension — Design Spec

**Date:** 2026-07-19
**Status:** Approved
**SDK baseline:** Ableton Extensions SDK 1.0.0-beta.0 (API version `"1.0.0"`)

## 1. Purpose

An Ableton Live extension that hosts an MCP (Model Context Protocol) server inside
Live's Extension Host, so AI clients (Claude Code, Claude Desktop, Codex) can connect
to a producer's open live set and work on it: inspect the set, compose MIDI, manage
tracks/scenes/clips, control devices and the mixer.

**End user:** music producers/artists using Ableton Live who want an AI collaborator
operating directly on their session.

## 2. Quality attributes (priority order)

| Priority | Attribute                           | What it means here                                                                                                                      |
| -------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | **Maintainability / upgradability** | Ableton will ship new SDK/API versions; adapting must be localized, cheap, and safe.                                                    |
| P0       | **Testability**                     | A component-test harness validates full server behavior in CI before any `.ablx` is packaged.                                           |
| P0       | **Token economy**                   | Tool outputs are compact, summary-by-default with drill-down; a large set must not blow up the AI client's context.                     |
| P0       | **Data safety**                     | The producer's set is sacred: every write is one clean undo step; no partial writes; no filesystem access outside SDK-sanctioned flows. |
| P1       | **Robustness**                      | Invalid/stale AI input never crashes anything and always yields a structured, self-correcting error.                                    |
| P2       | **Concurrency/staleness**           | Producer and AI edit concurrently; stale references fail loudly before mutating.                                                        |
| P2       | **Local security**                  | The localhost HTTP server is not an open door: loopback-only, origin checks, bearer token.                                              |
| P2       | **Observability**                   | Every tool call is audit-logged; "what did the AI just do?" is answerable inside Live.                                                  |

Guidelines (not pillars): performance (chunk large reads), portability (macOS +
Windows), releasability (reproducible CI pipeline).

## 3. Acceptance scenarios (definition of done)

Both run as smoke scenarios in real Live before release:

1. **Build a set:** from an empty set, an AI client creates tracks, loads built-in
   instruments, writes MIDI clips (drums, bass, chords), names everything, sets tempo.
2. **Edit an existing set:** against a prepared fixture set, the AI describes the set
   accurately, then performs targeted edits (note edits, mixer changes, add a device)
   without collateral damage; each edit is undoable as a single step.

## 4. Constraints from the SDK (facts the design rests on)

- Extensions run in **full Node.js (≥ 24.14.1)** in a separate Extension Host process;
  npm packages and Node APIs available. Bundled to a **single CJS file** (esbuild);
  the host does not resolve `node_modules`.
- **No inbound-server support is documented.** Node `http`/`net` exist and work, but
  hosting a server goes beyond the SDK's stated design intent. Mitigation: the HTTP
  listener is an isolated module behind our own boundary so a future transport change
  (or Ableton restriction) touches one file.
- **No event/observer API.** All reads are synchronous getters; changes from Live must
  be polled or re-read. All mutations are async Promises.
- Filesystem restricted to `environment.storageDirectory` and `tempDirectory`.
- API versioning is a discrete negotiated list (`initialize(activation, "1.0.0")`);
  the host reports `hostApiVersion`. SDK types are generic over the API version.
- Lifecycle: `activate(activation)` only; no deactivate hook.
- UI surfaces: context-menu actions, modal webview dialogs, progress dialogs. No
  persistent panels.
- Undo: each mutation is individually undoable; `withinTransaction(fn)` groups
  mutations into one undo step (callback synchronous; batch async ops via
  `Promise.all`).
- Not possible in API 1.0.0: transport control (play/stop), automation envelopes,
  Live browser access, third-party plugin loading, change notifications, scene/clip
  launch. See `docs/capability-map.md` (maintained per SDK version).

## 5. Architecture — ports and adapters

Decision record: `docs/decisions/0001-ports-and-adapters.md`.

Dependency rule: arrows point inward; **only `adapters/sdk-*` imports the Ableton SDK**.

```
┌─ Extension shell ──────────────────────────────────────────────┐
│  activate() · server lifecycle · status dialog · context menu  │
│  ┌─ MCP layer ─────────────────────────────────────────────┐   │
│  │  Streamable HTTP transport (127.0.0.1 only)             │   │
│  │  Tool registry · zod schemas · MCP resources            │   │
│  │  ┌─ Domain services ────────────────────────────────┐   │   │
│  │  │  SetInspector · ClipEditor · TrackService        │   │   │
│  │  │  DeviceService · MixerService                    │   │   │
│  │  │  ┌─ LivePort (interface + DTOs, zero deps) ─┐    │   │   │
│  │  │  └──────────────────────────────────────────┘    │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│  adapters/sdk-1.0 — the ONLY module importing the SDK          │
│  adapters/fake    — FakeLive in-memory simulator               │
└────────────────────────────────────────────────────────────────┘
```

### Layers

1. **`port/` — LivePort + DTOs.** Our narrow contract for everything the server needs
   from Live. Speaks plain JSON-serializable DTOs — never SDK class instances or
   `Handle`s. Entity identity crosses the boundary as opaque string IDs
   (`t1`, `t1.s2`, `c14`) minted per session by the adapter
   (`docs/decisions/0003-minted-session-ids.md`). Zero imports.
2. **`domain/` — services.** Producer-level operations composed from port calls:
   `SetInspector` (compact set snapshots), `ClipEditor` (musical note editing),
   `TrackService`, `DeviceService`, `MixerService`. Owns validation, undo grouping
   policy, and re-read-before-write.
3. **`mcp/` — tool surface.** Server assembly with `@modelcontextprotocol/sdk`:
   tool definitions (zod schemas) grouped by domain, MCP resources for read-heavy
   context, Streamable HTTP transport bound to `127.0.0.1`.
4. **`shell/` — extension skin.** `activate()` as composition root; status/config
   dialog (server state, port, copy-paste client config, recent tool calls);
   context-menu registration.

### Repo layout

```
src/
  extension.ts        # activate(): composition root
  shell/
  mcp/
    tools/            # set.ts, tracks.ts, clips.ts, devices.ts, mixer.ts
  domain/
  port/               # NO SDK imports
  adapters/
    sdk-1.0/
    fake/             # FakeLive — first-class implementation, used by tests & dev
test/
  unit/  component/  smoke/
docs/
  capability-map.md  decisions/  specs/  tools.md (generated)
manifest.json  build.ts  package.json
```

## 6. MCP tool surface

Shaped by token economy (P0) and data safety (P0). ~21 tools. Full generated
reference lives in `docs/tools.md`; capability reasoning in `docs/capability-map.md`.

**Reads — summary-by-default, drill-down on demand:**

| Tool         | Returns                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_set`    | Compact overview: tempo/scale + one line per track (id, name, type, device names, clip count) + scenes. Budget: 50-track set ≲ 2k tokens.                                            |
| `get_track`  | One track in depth: clip slots, arrangement clips, device chain with key params.                                                                                                     |
| `get_clip`   | Full clip detail; MIDI notes in compact tuple format `[pitch, startBeat, durBeats, velocity]`, optional fields only when non-default (`docs/decisions/0004-compact-note-format.md`). |
| `get_device` | Full parameter list (name, value, min, max, quantized items).                                                                                                                        |

**Writes — batch-first, intent-shaped:**

- Tracks/scenes: `create_tracks` (N at once, optional device + name), `update_track`,
  `delete_tracks`, `create_scenes`, `update_scene`, `delete_scenes`
- Clips: `create_midi_clip` (notes inline), `create_audio_clip`, `update_clip`,
  `delete_clips`
- Notes: `replace_clip_notes`; `edit_clip_notes` (add/remove/transform by filter —
  pitch range, time range — so one hi-hat tweak doesn't resend every note)
- Devices: `insert_device`, `set_device_params` (batch name→value), `delete_device`
- Mixer: `set_mixer` (batch volume/pan/sends across tracks)
- Song: `update_song` (tempo, cue points)

**Data-safety rules (every write):**

- Wrapped in one `withinTransaction` → exactly one named undo step per tool call.
- Batch calls resolve and validate **all** IDs first, then mutate — all-or-nothing.
- Results echo a minimal delta ("created clip c12 on t3 slot 2"), never a set dump.
- File access only through SDK-sanctioned flows (`importIntoProject`).

## 7. Runtime behavior

### Data flow of one tool call

```
AI client → HTTP POST (127.0.0.1) → MCP transport → zod validation
  → tool handler → domain service → LivePort → SdkAdapter
      → resolve minted IDs → SDK handles (fail fast if stale)
      → withinTransaction( mutations )        ← one undo step
  ← DTO delta ← structured {ok:...} result ← compact JSON to model
```

- Reads walk SDK getters on demand — no cache layer in v1; every read reflects
  Live's truth at call time.
- Writes re-resolve every ID at execution time; stale IDs fail before any mutation.

### Error taxonomy (P1)

Every failure maps to a code with a recovery hint for the model:

| Code            | Meaning                               | Hint pattern                                                 |
| --------------- | ------------------------------------- | ------------------------------------------------------------ |
| `NOT_FOUND`     | Stale/unknown ID                      | "Entity may have been deleted; call get_set to refresh IDs." |
| `INVALID_INPUT` | Schema violation                      | zod issue details.                                           |
| `UNSUPPORTED`   | Capability absent in this API version | Names the capability and host version.                       |
| `CONFLICT`      | State changed mid-operation           | "Re-read and retry."                                         |
| `INTERNAL`      | Bug                                   | Correlation ID; details in audit log, safe message out.      |

A top-level boundary converts unexpected throws into `INTERNAL`; the server never
stops serving because one handler failed.

### Local security (P2)

- Bind `127.0.0.1` only; reject non-localhost `Host`/`Origin` (DNS-rebinding defense).
- Auto-generated bearer token persisted in `storageDirectory`, required on every
  request, surfaced in the status dialog inside ready-to-paste client config.

### Observability (P2)

- JSONL audit log in `storageDirectory/logs/`: timestamp, tool, truncated args,
  ok/code, duration, undo-step name.
- Status dialog shows the last N tool calls. Console output also lands in Live's
  `ExtensionHost.txt`.

### Server lifecycle

- Server starts in `activate()`; status dialog via context-menu action.
- Port from config in `storageDirectory` (default `20808`), fallback scan if
  occupied; actual port always visible in the dialog.

## 8. Testing strategy

vitest throughout.

1. **Unit:** domain services against a stubbed port; adapter ID mapping; zod schemas
   with known-bad AI inputs asserting error codes/hints.
2. **Component (CI heart):** real MCP client → real HTTP transport → real handlers →
   real services → **FakeLive**. Scenario-style tests mirroring the acceptance
   scenarios. Token-economy budgets asserted here (e.g. `get_set` on the 50-track
   fixture < 8 KB).
3. **FakeLive contract tests:** behavior assertions verified once against real Live
   (e.g. "createMidiClip on occupied slot throws"), tagged; on SDK updates re-verify
   against real Live and fix the fake, never the tests.
4. **Smoke (real Live, pre-release):** the two acceptance scenarios as scripted
   self-test commands in the dev build, triggered from a context menu, reporting
   pass/fail per step via progress dialog + JSONL log.

Dev loops: `npm run dev:fake` (server standalone against FakeLive — no Ableton
needed) and `npm start` (dev build + `extensions-cli run --inspect` into real Live).

## 9. SDK version-upgrade playbook

Maintained as a runbook in `docs/`. When Ableton ships API `1.1.0`:

1. Diff new SDK `.d.ts` against the vendored copy.
2. Update `docs/capability-map.md` (+ ADR if a decision changes).
3. Extend `LivePort` additively.
4. Implement in adapter; select adapter/features at runtime via negotiated
   `hostApiVersion`.
5. Extend FakeLive + contract tests; re-verify contract suite against the new Live.
6. Run smoke suite in the new Live beta.

Clients on older hosts get `UNSUPPORTED` errors naming the missing capability.

## 10. Release pipeline

CI: lint + typecheck → unit + component tests → esbuild bundle →
`extensions-cli package` → versioned `.ablx` artifact. `docs/tools.md` regenerated in
the build. Release checklist requires the smoke suite passed on macOS (and Windows
when available) before tagging.

## 11. Documentation policy

`docs/` is a maintained deliverable:

- `capability-map.md` — updated on every SDK version bump.
- `decisions/` — ADRs; any change to `port/` or `adapters/` requires a matching
  capability-map or ADR update (review-checklist enforced).
- `tools.md` — generated from zod schemas in CI; cannot drift.
- `specs/` — design specs like this one.

## 12. Out of scope for v1

- stdio proxy transport (wire boundary designed so it can be added later).
- Revision counters / full conflict detection (port design must not preclude).
- Automation envelopes, transport control, browser access, third-party plugins —
  blocked by SDK 1.0.0, tracked in the capability map.
- Audio rendering / file import tools (`render_audio`, `import_file`) — deferred,
  port shape allows adding them.
