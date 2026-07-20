# ADR 0003: Minted session-stable string IDs across the port boundary

**Date:** 2026-07-19 · **Status:** Accepted

## Context

SDK object identity is an opaque `Handle` (`{id: bigint}`), valid for the session.
Handles are not JSON-friendly, are meaningless to an LLM, and leak the SDK type into
every layer. The obvious alternative — positional indexes — breaks as soon as the
producer deletes or reorders anything.

## Decision

The adapter mints short, session-stable string IDs (`t1`, `t1.s2`, `c14`) and
privately maps them to SDK handles. IDs are what cross the port boundary and reach
the AI client. They are compact (token economy), stable within a session, and fail
loudly: resolving an ID whose entity was deleted returns `NOT_FOUND` with a
"re-read the set" hint _before_ any mutation runs.

IDs are meaningless across sessions — acceptable because each AI conversation
re-reads the set (`get_set`) before working.

## Consequences

- FakeLive mints IDs through the same scheme, so tests exercise identical identity
  semantics.
- Concurrency mitigation (P2): writes re-resolve all IDs at execution time; batch
  writes validate all IDs before mutating (all-or-nothing per call).
