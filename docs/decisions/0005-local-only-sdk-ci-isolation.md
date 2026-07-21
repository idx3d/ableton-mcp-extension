# ADR 0005: Local-only Ableton SDK with CI isolation

**Date:** 2026-07-21 · **Status:** Accepted

## Context

The Ableton Extensions SDK ships only as beta tarballs (not on npm), and the beta
terms preclude redistribution. The repository is going public soon. CI, and any
contributor without the beta, must still build, test, typecheck, and lint the
project — but the real SDK adapter can only typecheck with the SDK present.

## Decision

The SDK stays local-only and never enters git:

- Tarballs live in gitignored `references/`; `npm run setup:sdk` installs them with
  `--no-save`, so `package.json`/`package-lock.json` never reference them.
- `docs/sdk-notes.md` (the extracted API reference) is gitignored too.
- The adapter is split: pure modules (`codec.ts`, `id-registry.ts`) import only port
  types and stay in CI; `sdk-adapter.ts` is the sole SDK importer and is **excluded
  from the CI `typecheck`** (`tsconfig.json`), covered instead by `typecheck:sdk`
  (`tsconfig.sdk.json`, run locally by extension developers).
- `scripts/check-boundaries.mjs` permits `@ableton-extensions/*` imports only from
  `adapters/sdk-*`, `shell/`, and `extension.ts`.

Two-tier workflow: contributors without Ableton run `npm ci && npm test`
(+ `dev:fake`); extension developers additionally run `setup:sdk`, `typecheck:sdk`,
`start`, `package`.

## Consequences

- CI is green with zero SDK packages present (verified by `rm -rf node_modules &&
npm ci` in the release checklist); publishing the repo leaks nothing Ableton-owned.
- The real adapter's correctness is guarded by `typecheck:sdk` + review against
  `docs/sdk-notes.md`, not by CI — so the in-Live smoke suite is the real gate
  (see `docs/smoke-runbook.md`).
- When Ableton publishes the SDK to a registry, revisit: swap `setup:sdk` for a normal
  dependency and fold `sdk-adapter.ts` back into CI typecheck.
