# ADR 0002: MCP Streamable HTTP transport on localhost

**Date:** 2026-07-19 · **Status:** Accepted

## Context

Extensions are spawned by Live's Extension Host, so classic stdio-launched MCP
servers are impossible — the AI client cannot spawn the extension process. Something
must bridge AI clients to code running inside Live.

## Decision

The extension hosts an MCP **Streamable HTTP** server bound to `127.0.0.1` on a
configurable port (default 20808). Claude Code, Claude Desktop, and Codex all support
HTTP transports natively. One moving part; no companion install.

Security hardening (P2): loopback bind only, localhost `Host`/`Origin` validation
(DNS-rebinding defense), mandatory bearer token generated per install and shown in
the status dialog.

## Caveat

The SDK does not document inbound servers, and "persistent background extensions"
are a stated non-goal (we run only while Live is open, which is within the spirit).
Node's `http` module works today, but Ableton could restrict this. Mitigation: the
HTTP listener is one isolated module; swapping transports touches only it.

## Alternatives considered

- **Companion stdio proxy** (`npx ableton-mcp` bridging stdio ↔ local socket): works
  with stdio-only clients but doubles the shipped artifacts. Deferred; the wire
  boundary permits adding it later.
