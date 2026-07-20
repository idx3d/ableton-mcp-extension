# Contributing

Thanks for your interest! This project is an MCP server that runs inside an Ableton
Live extension. The good news for contributors: **you don't need Ableton Live to
develop most of it.**

## Getting started (no Ableton required)

```sh
npm ci
npm test              # unit + component tests (~1s)
npm run dev:fake      # real MCP server against an in-memory fake Live set
```

`dev:fake` prints a ready-to-paste `claude mcp add` command — connect Claude Code (or
any MCP client) and drive the fake set with all the tools.

Node ≥ 24 required.

## Before you open a PR

```sh
npm run lint          # eslint + architecture boundary check
npm run format        # prettier
npm run typecheck
npm test
```

CI runs the same checks; PRs need them green.

## Architecture in 30 seconds

Ports-and-adapters (see `docs/specs/` for the full design, `docs/decisions/` for the
why):

- `src/port/` — `LivePort` interface + DTOs. Imports **nothing**.
- `src/adapters/sdk-*` — the **only** place `@ableton-extensions/sdk` may be imported.
- `src/adapters/fake/` — FakeLive, the in-memory simulator used by tests and dev:fake.
- `src/domain/` — services owning validation and the one-undo-step-per-write policy.
- `src/mcp/` — tool registry, error envelope, Streamable HTTP transport.

These rules are enforced by `scripts/check-boundaries.mjs` (part of `npm run lint`).

Behavioral contracts every change must keep:

- Write tools: one named undo step per call; batches validate all IDs before mutating.
- Tools never throw to the client — failures are `{ok: false, code, message, hint}`.
- Tool output is token-frugal: summaries by default, budgets asserted in
  `test/component/token-budget.test.ts`.

## Docs are part of the change

- Touching `src/port/` or `src/adapters/` requires updating `docs/capability-map.md`
  and/or adding an ADR in `docs/decisions/` (numbered, append-only — supersede, don't
  rewrite).
- `docs/tools.md` is generated — never hand-edit.

## SDK version upgrades

Follow the playbook in the design spec (§9): diff the new SDK's `.d.ts`, update the
capability map, extend `LivePort` additively, implement in a version-keyed adapter,
extend FakeLive + contract tests, re-run the smoke suite in real Live.

## Testing philosophy

- Component tests are the gate: real MCP client → real HTTP → real services → FakeLive.
- FakeLive's behavior is pinned by contract tests verified against real Live. If the
  fake and a contract test disagree, fix the fake — never the test — unless you
  re-verified the behavior in real Live.
