# stdio proxy transport — design

**Status:** approved (brainstorm) · **Date:** 2026-07-23 · **Slice:** post-v0.1.0
candidate "stdio proxy transport" (see `docs/ROADMAP.md`).

## Problem

The extension hosts a **stateless Streamable HTTP** MCP endpoint at
`http://127.0.0.1:<port>/mcp` (loopback-bound, Host/Origin-checked, `Bearer <token>`
— see `src/mcp/http.ts`). MCP clients that only speak **stdio** (e.g. Claude Desktop)
cannot reach it. We want a tiny bridge that a stdio client spawns, which forwards MCP
traffic to the running extension's HTTP endpoint.

Two constraints shape the design:

1. **The token/port live in an SDK-opaque location.** The extension writes
   `config.json` into `environment.storageDirectory`, a path the host assigns via a
   `--storage-directory <path>` flag (verified in the vendored SDK docs). There is **no
   documented OS convention** for reconstructing it from outside Live, so the bridge
   cannot find `storageDir/config.json`.
2. **stdout is the MCP channel.** The bridge must never print diagnostics to stdout;
   all human/error output goes to stderr.

## Decisions (locked during brainstorm)

- **Config discovery:** auto-read a **connection file** at a fixed, bridge-computable
  path; environment variables override.
- **Distribution:** an **in-repo bundled bin** (`dist/bridge.cjs`) with a `bin` entry.
  No npm publish yet — `node dist/bridge.cjs` works today; `npx ableton-mcp` is a later
  publish step.
- **Forwarding:** a **transport splice** — wire the official SDK `StdioServerTransport`
  ⇄ `StreamableHTTPClientTransport` at the message level, reusing all SDK framing / HTTP
  / handshake correctness.

## Components

### 1. `src/shell/connection-file.ts` — the discovery contract

SDK-free (`node:os`/`node:path`/`node:fs` only). Shared by the writer (extension shell)
and the reader (bridge); the connection file *is* the shell↔bridge contract.

```ts
export interface ConnectionInfo { url: string; token: string; updatedAt?: string }

/** Fixed, OS-conventional path both sides agree on. */
export function connectionFilePath(): string
export function writeConnectionFile(info: { url: string; token: string }): void
export function readConnectionFile(): ConnectionInfo | undefined
```

Path resolution:

| OS          | Path                                                                 |
| ----------- | -------------------------------------------------------------------- |
| macOS       | `~/Library/Application Support/ableton-mcp/connection.json`           |
| Windows     | `%APPDATA%\ableton-mcp\connection.json`                              |
| Linux/other | `${XDG_CONFIG_HOME:-~/.config}/ableton-mcp/connection.json`           |

- File shape: `{ "url": "http://127.0.0.1:20808/mcp", "token": "…", "updatedAt": "<iso>" }`.
- Directory created recursively; file written with mode `0600` (it carries the bearer
  token). A corrupt/unreadable file → `readConnectionFile()` returns `undefined`
  (never throws).
- This file is **separate from** `storageDir/config.json`. `config.json` remains the
  in-Live source of truth for `{port, token}`; the connection file is a derived,
  externally-locatable copy of the *effective* URL + token.

### 2. `src/bridge/` — the bridge

**`bridge.ts`**

```ts
export interface Connection { url: string; token: string }

/** env overrides connection file; throws a structured error if neither resolves. */
export function resolveConnection(env = process.env): Connection

/** Splices stdio ⇄ HTTP. Streams are injected for testability. */
export async function runBridge(opts: {
  url: string; token: string; stdin: Readable; stdout: Writable;
}): Promise<{ close(): Promise<void> }>
```

- `resolveConnection` precedence:
  1. `ABLETON_MCP_URL` + `ABLETON_MCP_TOKEN` (both required together), OR
  2. `ABLETON_MCP_PORT` + `ABLETON_MCP_TOKEN` → `http://127.0.0.1:<port>/mcp`, OR
  3. `readConnectionFile()`.
  - None → throw a structured error carrying a recovery hint: *"No Ableton MCP
    connection found. Open Ableton Live → Session view → Scene right-click → 'Ableton
    MCP: Status…' to confirm the extension is running, or set ABLETON_MCP_URL /
    ABLETON_MCP_TOKEN."*
- `runBridge` wiring:
  ```ts
  const stdio = new StdioServerTransport(stdin, stdout);
  const http  = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  stdio.onmessage = (m) => void http.send(m);
  http.onmessage  = (m) => void stdio.send(m);
  stdio.onclose = () => void http.close();
  http.onclose  = () => void stdio.close();
  stdio.onerror = http.onerror = (e) => console.error("[ableton-mcp bridge]", e);
  await http.start();
  await stdio.start();
  ```
  Both transports are transparent `JSONRPCMessage` pipes — no `Client`/`Server` objects,
  so capabilities, tool lists, and future stateful sessions pass through untouched.

**`main.ts`** — CLI entry (`#!/usr/bin/env node` via esbuild banner):

```ts
try {
  const { url, token } = resolveConnection();
  await runBridge({ url, token, stdin: process.stdin, stdout: process.stdout });
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err)); // stderr only
  process.exit(1);
}
```

### 3. Build & packaging

- **`build.ts`:** add a second esbuild target → `dist/bridge.cjs`
  (`entryPoints: ["src/bridge/main.ts"]`, `format: "cjs"`, `platform: "node"`,
  `bundle: true`, `banner: { js: "#!/usr/bin/env node" }`, minify in prod like the
  extension bundle). `dist/package.json` already pins `{ "type": "commonjs" }`.
- **`package.json`:** add `"bin": { "ableton-mcp": "dist/bridge.cjs" }`. Repo stays
  `private: true`; publishing is deferred.
- **`src/extension.ts`:** after `startHttpServer(...)`, call
  `writeConnectionFile({ url: server.url, token: config.token })`. Best-effort — wrap in
  try/catch and log to stderr; a write failure must not crash activation.

## Boundaries

`src/bridge/` is a new outer-ring layer:

- Rule 1 in `scripts/check-boundaries.mjs` already forbids any non-(sdk-adapter/shell/
  extension.ts) file from importing `@ableton-extensions/*`, so the bridge is
  **automatically prevented** from importing the Ableton SDK — correct, since it runs
  outside Live. No boundary-script change is required.
- The bridge imports `@modelcontextprotocol/sdk` (allowed) and
  `src/shell/connection-file.ts`. The `mcp/domain/port/adapters-fake → shell` ban does
  **not** cover `bridge/`, so this edge is permitted; it reflects the real contract.
- Because the bridge has **no** Ableton SDK dependency, it is included in the normal
  `npm run typecheck` (unlike `extension.ts`, which is SDK-only and excluded).

## Testing (no Live host required)

- **Component — `test/component/bridge.test.ts`:** start a FakeLive-backed HTTP server
  on port 0 (reuse the `http-auth.test.ts` factory pattern); call `runBridge` with
  `PassThrough` stdin/stdout; write newline-delimited `initialize`, `notifications/
  initialized`, `tools/list`, and one real `tools/call` (e.g. `get_set`) to stdin; parse
  responses off stdout and assert the `initialize` result, **21** tools, and a valid
  tool result. Exercises real stdio framing + the HTTP splice end-to-end.
- **Unit — `test/unit/shell/connection-file.test.ts`:** per-OS path (drive via injected
  env/platform or a thin seam), write→read round-trip, `0600` mode, corrupt-file →
  `undefined`.
- **Unit — `test/unit/bridge/resolve-connection.test.ts`:** env precedence
  (URL form, PORT form, file fallback) and the structured "no connection" error.

## Documentation

- New ADR **`docs/decisions/0008-stdio-bridge.md`** (context → decision → alternatives
  → consequences). Alternatives to record: raw HTTP pump (re-implements framing/Accept/
  notification/SSE handling by hand) and full `Client`+`Server` proxy (heaviest;
  re-declares capabilities the splice passes through).
- **`docs/capability-map.md`:** note the stdio bridge exists alongside the HTTP endpoint.
- Connection instructions (status dialog copy and/or README): show the stdio option —
  point the client at `node <repo>/dist/bridge.cjs` with the connection file
  auto-discovered.
- `docs/tools.md` is generated and unaffected.

## Out of scope (YAGNI)

npm publish / real `npx ableton-mcp`; auto-starting Live; multi-instance or port-scan
discovery; Windows-service niceties; SSE-resumption tuning. All are clean follow-ups.
