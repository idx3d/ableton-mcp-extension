# ADR 0001: Ports-and-adapters architecture with a first-class FakeLive

**Date:** 2026-07-19 · **Status:** Accepted

## Context

The extension depends on the Ableton Extensions SDK (beta), which will change across
Live releases. Our top quality attributes are maintainability across SDK versions and
testability before packaging — but the SDK ships no test tooling and cannot run
outside Live.

## Decision

Quarantine the SDK behind a narrow `LivePort` interface that we own. Only
`src/adapters/sdk-*` imports `@ableton-extensions/sdk`. `LivePort` speaks plain
JSON-serializable DTOs, never SDK class instances or Handles. Two implementations:

- `adapters/sdk-1.0` — wraps the real SDK, keyed to negotiated API version.
- `adapters/fake` — FakeLive, an in-memory simulator; a first-class implementation
  (lives in `src/`, not `test/`) used by CI component tests and the `dev:fake`
  standalone dev loop.

Domain services and MCP tools depend only on the port.

## Alternatives considered

- **Thin direct mapping** (tools call SDK directly): fastest to demo, but SDK
  version bumps touch every tool, and testing requires mocking getter-heavy SDK
  classes. Fails both P0 attributes.
- **Split-process bridge** (minimal extension + separate MCP server process): maximum
  decoupling, but two shipped artifacts to version/install/pair; contradicts the
  single-artifact HTTP transport decision (ADR 0002).

## Consequences

- SDK API `1.1.0` support = extend port additively + implement in adapter + extend
  FakeLive; tools/services/tests untouched.
- FakeLive is real effort and can drift from real Live behavior → mitigated by the
  contract-test suite verified against real Live (see design spec §8.3).
