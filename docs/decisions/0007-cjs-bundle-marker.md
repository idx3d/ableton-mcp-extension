# ADR 0007: Emit `dist/package.json` CJS marker in the bundle

**Date:** 2026-07-21 · **Status:** Accepted

## Context

The root `package.json` has `"type": "module"`. esbuild bundles the extension as CJS
to `dist/extension.js` (the Extension Host loads it via `require`). Node resolves a
file's module system from the nearest ancestor `package.json` — so under the root's
`"type":"module"`, `require("dist/extension.js")` **silently drops the `activate`
export** instead of erroring. This would also affect the real host's `require`-based
loader.

## Decision

`build.ts` writes `dist/package.json` containing `{"type":"commonjs"}` alongside the
bundle, and `scripts/package-ablx.mjs` includes it in the `.ablx` (via `-i`). Packaging
runs through a cross-platform Node helper (no shell substitution) that names the
artifact `Ableton-MCP-<version>.ablx` (whitespace hyphenated, matching the CLI's own
convention).

## Consequences

- Both `npm start` (dev host) and the shipped `.ablx` load `activate` correctly.
- The `dist/` marker is generated, never committed (`dist/` is gitignored).
