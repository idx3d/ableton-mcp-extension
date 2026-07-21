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

Node ≥ 24 required. This is exactly what CI runs — no Ableton Live install, no SDK,
no macOS/Windows requirement.

## Extension development (Ableton Live + SDK required)

Building, running inside Live, and packaging the installable `.ablx` needs the
Ableton Extensions SDK and CLI. These ship as tarballs through Ableton's extensions
beta program — they are **not** on the npm registry and are **never committed** to
this repo (see the `references/` entry in `.gitignore`). Download them from the beta
program and place them under `references/extensions-sdk-<version>/`, then:

```sh
npm run setup:sdk      # npm install --no-save the two local tarballs
npm run typecheck:sdk  # tsc over src/extension.ts + the adapter/shell files the
                        # CI typecheck excludes (they import @ableton-extensions/sdk)
npm start               # build:dev + `extensions-cli run .` inside Live (Developer Mode)
npm run package         # build + `extensions-cli package .` → dist/<name>-<version>.ablx
```

`setup:sdk` installs with `--no-save`, so `package.json`/`package-lock.json` never
pick up a dependency on a local tarball path — only generic devDependencies (like
`esbuild`) are meant to be committed.

`npm run build` / `build:dev` (invoked by `start` and `package`) run `build.ts`,
which bundles `src/extension.ts` with esbuild into `dist/extension.js` (CJS,
platform `node`) and drops a `dist/package.json` with `{"type": "commonjs"}` next to
it — the root `package.json` says `"type": "module"`, and without that marker
Node's `require()` (which is how the Extension Host loads the bundle) resolves the
bundle's module type from the nearest ancestor `package.json` and silently treats it
as ESM, dropping the `activate` export instead of throwing.

`dist/` is gitignored — build artifacts are never committed; run `npm run build` (or
`start`/`package`, which build first) whenever you need a fresh bundle.

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
