# Roadmap

Status as of 2026-07-21. This file is the durable entry point for resuming work.

## Done — v1 feature-complete

| Plan     | Scope                                                                                                           | PR  |
| -------- | --------------------------------------------------------------------------------------------------------------- | --- |
| 1        | Foundation: port + FakeLive + MCP server over Streamable HTTP (10 tools)                                        | #1  |
| baseline | CI, ESLint/Prettier, architecture boundary check, Dependabot, community files                                   | #2  |
| 2a       | Device control + batch mixer (→ 15 tools)                                                                       | #7  |
| 2b       | Audio clips, clip update/delete, `edit_clip_notes`, scene rename/delete, generated `docs/tools.md` (→ 21 tools) | #8  |
| 3        | Real SDK adapter, extension shell, `.ablx` packaging, in-Live self-test + runbook                               | #10 |

The 21-tool MCP server builds and packages to an installable `.ablx`. Architecture,
decisions, and tool reference are in `docs/` (specs, decisions/ ADRs 0001–0007,
capability-map, tools.md, plans/).

## The v0.1.0 release gate — in-Live smoke (NOT yet done)

The only thing between here and tagging v0.1.0 is running the extension inside a real
Ableton Live beta. Nothing in CI can cover this (no Live host in CI).

Follow **`docs/smoke-runbook.md`**:

1. Install the Extensions-capable Ableton Live beta; enable Developer Mode.
2. Obtain the SDK tarballs from Ableton's beta program into `references/` (gitignored).
3. `npm ci && npm run setup:sdk`, then `npm run start` to load the dev build into Live.
4. Open the status dialog (Scene context-menu → the registered action), click
   **Run self-test**, confirm all checks PASS — on **macOS and Windows**.
5. Tick every item in the runbook's "Deferred in-Live verifications" checklist (SDK
   behaviors flagged inline in `src/adapters/sdk-1.0/sdk-adapter.ts`): clip color
   `0xRRGGBB` packing, session-clip `lengthBeats` formula, `mixer.sends[i]` ↔
   `returnTracks[i]` ordering, group tracks reported as type `"audio"`,
   `insertDevice` unknown-name throw behavior, `valueItems` quantized-only,
   `withinTransaction` empty-undo-step + sequential-await undo grouping, handle-cache
   referential liveness across a session.
6. Fix any parity failures the self-test surfaces (FakeLive is the behavioral
   reference), then tag v0.1.0.

## Candidate next slices (after v0.1.0)

Not planned yet — each would follow the same brainstorm → spec → plan → subagent-driven
execution flow. See `docs/capability-map.md` for what the SDK does/doesn't allow.

- **stdio proxy transport** — a tiny `npx ableton-mcp` bridge for stdio-only MCP
  clients (the HTTP wire boundary was designed to allow this; out of scope for v1).
- **Deferred v2 tools** (SDK-permitting): audio render / file import, take lanes,
  Simpler sample replacement, rack chains — tracked as `deferred` in the capability map.
- **Concurrency hardening** — revision counters / conflict detection for
  producer-and-AI-edit-simultaneously (v1 relies on fail-loud stale IDs).
- **SDK version bump** — when Ableton ships API 1.1.0, follow the upgrade playbook in
  the design spec §9 and revisit ADR 0005 (SDK may become a normal npm dependency).

## How work is run here

Brainstorm (superpowers) → written spec in `docs/specs/` → plan in `docs/plans/` →
subagent-driven execution (one implementer + adversarial review per task, final
whole-branch review) → one PR per plan → CI green → merge. Changes to `src/port/` or
`src/adapters/` require a capability-map and/or ADR update (see CLAUDE.md).
