# ADR 0006: All LivePort reads are async

**Date:** 2026-07-21 · **Status:** Accepted · Supersedes the sync-reads note in
[[0001-ports-and-adapters]]

## Context

Plan 1 made `LivePort` reads synchronous getters (FakeLive holds everything in
memory). The real SDK breaks that: `DeviceParameter.getValue()` is async (a host
round-trip), and mixer volume/pan/sends are exposed only as `DeviceParameter`s. So
`getDevice`/`getTrack` (which include mixer + param values) cannot be synchronous
against real Live.

## Decision

`getSet`, `getTrack`, `getClip`, `getDevice` all return `Promise<...>` on `LivePort`,
`FakeLive`, and `SetInspector`. The change was purely mechanical — no assertion
values changed, only `async`/`await` plumbing and sync-throw→rejects test rewrites.

## Consequences

- The port models the real host honestly; FakeLive pays a trivial `async` cost.
- Domain fail-fast reads and tool handlers `await` reads; ordering (read-before-
  transact) is unchanged, so the one-undo-step and all-or-nothing guarantees hold.
