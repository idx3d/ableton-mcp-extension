# 0008 — stdio proxy transport bridge

## Context

The extension serves MCP over a stateless, loopback-bound Streamable HTTP
endpoint (ADR 0002). Some MCP clients (e.g. Claude Desktop) speak only stdio.
The server's `{port, token}` live in `storageDirectory/config.json`, but
`storageDirectory` is a host-assigned path (`--storage-directory <path>`) with no
documented OS convention, so an external process cannot locate it.

## Decision

Ship an in-repo `ableton-mcp` bin (`dist/bridge.cjs`) that splices the official
`StdioServerTransport` ⇄ `StreamableHTTPClientTransport` at the message level.
The extension publishes the effective URL + token to a fixed, OS-conventional
`connection.json` (`connection-file.ts`, shared by both sides); the bridge reads
it, with `ABLETON_MCP_URL`/`ABLETON_MCP_PORT` + `ABLETON_MCP_TOKEN` env overrides.

## Alternatives

- **Raw HTTP pump** — hand-parse newline-delimited JSON-RPC and POST each request.
  Rejected: re-implements framing, Accept headers, notification handling, and SSE
  by hand.
- **Full Client + Server proxy** — instantiate an MCP `Client` and `Server` and
  forward tool semantics. Rejected: heaviest; re-declares capabilities the splice
  passes through transparently.
- **npm-published `npx ableton-mcp`** — deferred; the in-repo bin ships now, publish
  is a later step.

## Consequences

- stdio-only clients can connect via `node <repo>/dist/bridge.cjs` with zero token
  copying (connection file auto-discovered).
- New `src/bridge/` layer stays SDK-free (auto-enforced) and is covered by the
  normal CI typecheck, unlike the SDK-only `extension.ts`.
- The connection file carries the bearer token; it is written `0600`.
