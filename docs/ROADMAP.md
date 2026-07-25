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

## The v0.1.0 release gate — in-Live smoke

**macOS: PASSED for the v1 surface** (Live 12.4.5b8, 2026-07-24 — self-test **20/20, 0
failed**). That run predates the Plan-4a v2a checks: the self-test has since grown from 20
to 35 checks and the 15 new ones (cue points, duplicate, warp, Simpler sample) have **not
run in Live** — they are green in CI against FakeLive only. Getting
there surfaced and fixed three real bugs no CI could catch — the Extension Host is a
stripped Node `vm`-context, not full Node (see
[`decisions/0009-real-extension-host-runtime.md`](decisions/0009-real-extension-host-runtime.md)):
`global`→`globalThis`; a custom `node:http` transport replacing the SDK's hono-based one
plus a host-globals prelude; and `toNumber` coercion for bigint-marshalled SDK getters.
The fixes are on branch `fix/extension-host-global` (→ PR).

**Remaining before tagging v0.1.0:**

1. Land the `fix/extension-host-global` PR on main.
2. **macOS self-test re-run** covering the v2a checks (the 20/20 run predates them).
3. **Windows self-test** — same procedure on a Windows Live beta (still pending; not yet
   run). Nothing in CI can cover this (no Live host in CI).
4. Then tag v0.1.0.

To run the smoke on a fresh machine, follow **`docs/smoke-runbook.md`**: install the
Extensions-capable Live beta + enable Developer Mode; drop the SDK tarballs into
`references/`; `npm ci && npm run setup:sdk`; `npm run package` and install the `.ablx`
(or `npm run start` for the dev build); then Scene context-menu → **Run self-test**. The
runbook's "Deferred in-Live verifications" checklist records what the macOS run
validated and what still wants an eyeball.

## Candidate next slices (after v0.1.0)

Not planned yet — each would follow the same brainstorm → spec → plan → subagent-driven
execution flow. See `docs/capability-map.md` for what the SDK does/doesn't allow.

- **stdio proxy transport** — a tiny `npx ableton-mcp` bridge for stdio-only MCP
  clients (the HTTP wire boundary was designed to allow this; out of scope for v1).
- **v2 in progress**: Plan 4a (this PR — cue points, duplicate track/scene/device,
  audio-clip warp, Simpler sample replace; spec
  `docs/specs/2026-07-24-v2-tool-surface-design.md`, ADR
  [0010](decisions/0010-v2-surface-shaping.md)) → Plan 4b (take lanes, rack chains)
  → Plan 4c (file import, audio render) to follow — tracked as `deferred` in the
  capability map until each phase lands.
- **Concurrency hardening** — revision counters / conflict detection for
  producer-and-AI-edit-simultaneously (v1 relies on fail-loud stale IDs).
- **SDK version bump** — when Ableton ships API 1.1.0, follow the upgrade playbook in
  the design spec §9 and revisit ADR 0005 (SDK may become a normal npm dependency).

## How work is run here

Brainstorm (superpowers) → written spec in `docs/specs/` → plan in `docs/plans/` →
subagent-driven execution (one implementer + adversarial review per task, final
whole-branch review) → one PR per plan → CI green → merge. Changes to `src/port/` or
`src/adapters/` require a capability-map and/or ADR update (see CLAUDE.md).
