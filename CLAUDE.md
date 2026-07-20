# CLAUDE.md

MCP server hosted inside an Ableton Live extension (Ableton Extensions SDK, Node.js).
Design spec: `docs/specs/2026-07-19-ableton-mcp-extension-design.md`. Read it before
structural changes.

## Hard rules

- **SDK quarantine:** only `src/adapters/sdk-*` may import `@ableton-extensions/sdk`.
  Everything else depends on `src/port/` (LivePort interface + DTOs). `src/port/` has
  zero imports. No SDK class instances or `Handle`s cross the port boundary — only
  plain JSON-serializable DTOs and minted string IDs (`t1`, `t1.s2`, `c14`).
- **Data safety (P0):** every write tool runs inside one `withinTransaction` → one
  named undo step per tool call. Batch writes resolve and validate all IDs first,
  then mutate — all-or-nothing. No filesystem access outside `storageDirectory` /
  `tempDirectory` / `resources.importIntoProject`.
- **Token economy (P0):** reads are summary-by-default with drill-down tools; write
  results return minimal deltas, never set dumps. MIDI notes use the compact tuple
  format (ADR 0004). New/changed tools must respect the token budgets asserted in
  component tests.
- **Robustness (P1):** tools never throw to the client. Every failure is a structured
  result with a code (`NOT_FOUND`, `INVALID_INPUT`, `UNSUPPORTED`, `CONFLICT`,
  `INTERNAL`) and a recovery hint the model can act on.

## Commands

- `npm test` / `npm run typecheck` — must be green before any commit.
- `npm run lint` — ESLint + `scripts/check-boundaries.mjs`, which machine-enforces
  the SDK-quarantine and layer-direction rules above. If the boundary check fails,
  fix the import direction — never the script.
- `npm run format` (Prettier) — CI runs `format:check`.

## Documentation policy

`docs/` is a maintained deliverable:

- Any change to `src/port/` or `src/adapters/` requires updating
  `docs/capability-map.md` and/or an ADR in `docs/decisions/`.
- New architectural decisions get a new numbered ADR (context → decision →
  alternatives → consequences).
- `docs/tools.md` is generated from zod schemas — never hand-edit.

## Testing

- vitest. Component tests are the gate: real MCP client → real server → FakeLive
  (`src/adapters/fake/`). They must pass before packaging.
- FakeLive behavior is pinned by contract tests verified against real Live. When the
  fake and a contract test disagree, fix the fake — never the test — unless real Live
  behavior was re-verified.
- Smoke scenarios (build-a-set, edit-existing-set) run inside real Live before any
  release.

## SDK reference

`references/` (gitignored) holds the vendored Ableton Extensions SDK — tarballs,
`.d.ts` API surface, docs, examples. Consult it rather than guessing SDK behavior.
On SDK version bumps follow the upgrade playbook in the design spec (§9).
