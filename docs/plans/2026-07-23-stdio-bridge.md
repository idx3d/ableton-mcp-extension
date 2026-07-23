# stdio Proxy Transport Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a tiny in-repo `ableton-mcp` bin that lets stdio-only MCP clients reach the extension's loopback HTTP endpoint, auto-discovering the URL + token via a fixed-path connection file.

**Architecture:** A message-level **transport splice** wires the official
`StdioServerTransport` ⇄ `StreamableHTTPClientTransport` (each transport's `onmessage`
feeds the other's `send`), so capabilities, tool lists, and sessions pass through
untouched. The extension writes a `connection.json` to an OS-conventional path; the
bridge reads it (env vars override). Everything but the extension wiring is testable
against FakeLive with no Ableton host.

**Tech Stack:** TypeScript (ESM), `@modelcontextprotocol/sdk` (already a dependency),
esbuild bundling, vitest.

**Design spec:** `docs/specs/2026-07-23-stdio-bridge-design.md`.

## Global Constraints

- **SDK quarantine:** no file here may import `@ableton-extensions/*` except
  `src/extension.ts` (already exempt). `scripts/check-boundaries.mjs` enforces this and
  runs in `npm run lint` — the new `src/bridge/` layer is auto-covered.
- **stdout is the MCP channel:** the bridge and its CLI must send _all_ diagnostics to
  **stderr** (`console.error`), never stdout.
- **Node ≥ 24**, `"type": "module"`; the bridge bundle is emitted as CJS
  (`dist/bridge.cjs`); `dist/package.json` already pins `{ "type": "commonjs" }`.
- **Green gates before every commit:** `npm test` and `npm run typecheck`. Run
  `npm run lint` and `npm run format` before the final commit of a task.
- **Token file is a secret:** `connection.json` is written mode `0600`.
- Tool count assertion is currently **21** (matches `test/component/http-auth.test.ts`).

---

### Task 1: Connection-file module (shell↔bridge contract)

**Files:**

- Create: `src/shell/connection-file.ts`
- Test: `test/unit/shell/connection-file.test.ts`

**Interfaces:**

- Consumes: nothing (SDK-free; `node:fs`/`node:os`/`node:path` only).
- Produces:
  - `interface ConnectionInfo { url: string; token: string; updatedAt?: string }`
  - `function connectionFilePath(env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform): string`
  - `function writeConnectionFile(info: { url: string; token: string }, path?: string): void`
  - `function readConnectionFile(path?: string): ConnectionInfo | undefined`

- [ ] **Step 1: Write the failing test**

Create `test/unit/shell/connection-file.test.ts`:

```ts
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  connectionFilePath,
  readConnectionFile,
  writeConnectionFile,
} from "../../../src/shell/connection-file.js";

function tempPath(): string {
  return join(mkdtempSync(join(tmpdir(), "amcp-conn-")), "connection.json");
}

describe("connectionFilePath", () => {
  it("uses Application Support on macOS", () => {
    expect(connectionFilePath({ HOME: "/Users/x" }, "darwin")).toBe(
      "/Users/x/Library/Application Support/ableton-mcp/connection.json",
    );
  });

  it("uses APPDATA on Windows", () => {
    const p = connectionFilePath({ APPDATA: "C:\\Users\\x\\AppData\\Roaming" }, "win32");
    expect(p).toContain("ableton-mcp");
    expect(p).toContain("AppData");
  });

  it("uses XDG_CONFIG_HOME on linux", () => {
    expect(connectionFilePath({ XDG_CONFIG_HOME: "/home/x/.config" }, "linux")).toBe(
      "/home/x/.config/ableton-mcp/connection.json",
    );
  });

  it("falls back to ~/.config on linux without XDG_CONFIG_HOME", () => {
    expect(connectionFilePath({ HOME: "/home/x" }, "linux")).toBe(
      "/home/x/.config/ableton-mcp/connection.json",
    );
  });
});

describe("write/read round-trip", () => {
  it("round-trips url + token and stamps updatedAt", () => {
    const path = tempPath();
    writeConnectionFile({ url: "http://127.0.0.1:20808/mcp", token: "tok" }, path);
    const info = readConnectionFile(path);
    expect(info?.url).toBe("http://127.0.0.1:20808/mcp");
    expect(info?.token).toBe("tok");
    expect(typeof info?.updatedAt).toBe("string");
  });

  it("writes the file with 0600 perms (posix)", () => {
    if (process.platform === "win32") return;
    const path = tempPath();
    writeConnectionFile({ url: "u", token: "t" }, path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("returns undefined for a corrupt file", () => {
    const path = tempPath();
    writeFileSync(path, "{not json", "utf8");
    expect(readConnectionFile(path)).toBeUndefined();
  });

  it("returns undefined for a missing file", () => {
    expect(readConnectionFile(join(tmpdir(), "amcp-nope", "x.json"))).toBeUndefined();
  });

  it("returns undefined when url/token are missing", () => {
    const path = tempPath();
    writeFileSync(path, JSON.stringify({ url: "u" }), "utf8");
    expect(readConnectionFile(path)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/shell/connection-file.test.ts`
Expected: FAIL — cannot resolve `../../../src/shell/connection-file.js`.

- [ ] **Step 3: Write the implementation**

Create `src/shell/connection-file.ts`:

```ts
/**
 * The shell↔bridge discovery contract. SDK-FREE (enforced by
 * scripts/check-boundaries.mjs). The extension writes this file to a fixed,
 * OS-conventional path so the external `ableton-mcp` stdio bridge can find the
 * running server's URL + bearer token — the SDK-assigned storageDirectory is
 * not reconstructable from outside Live.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ConnectionInfo {
  url: string;
  token: string;
  updatedAt?: string;
}

/** Fixed, OS-conventional path both the extension (writer) and bridge (reader) agree on. */
export function connectionFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const dir =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "ableton-mcp")
      : platform === "win32"
        ? join(env.APPDATA ?? join(home, "AppData", "Roaming"), "ableton-mcp")
        : join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "ableton-mcp");
  return join(dir, "connection.json");
}

/** Writes {url, token, updatedAt} at 0600 (it carries the bearer token). */
export function writeConnectionFile(
  info: { url: string; token: string },
  path: string = connectionFilePath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const body: ConnectionInfo = { ...info, updatedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}

/** Reads the connection file; returns undefined if absent, corrupt, or incomplete. */
export function readConnectionFile(
  path: string = connectionFilePath(),
): ConnectionInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ConnectionInfo>;
    if (typeof parsed.url === "string" && typeof parsed.token === "string") {
      return { url: parsed.url, token: parsed.token, updatedAt: parsed.updatedAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/shell/connection-file.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx eslint src/shell/connection-file.ts test/unit/shell/connection-file.test.ts
git add src/shell/connection-file.ts test/unit/shell/connection-file.test.ts
git commit -m "feat: connection-file discovery contract for the stdio bridge"
```

---

### Task 2: `resolveConnection` — env-then-file precedence

**Files:**

- Create: `src/bridge/bridge.ts` (this task adds `resolveConnection`; Task 3 adds `runBridge`)
- Test: `test/unit/bridge/resolve-connection.test.ts`

**Interfaces:**

- Consumes: `ConnectionInfo`, `readConnectionFile` from `src/shell/connection-file.ts`.
- Produces:
  - `interface Connection { url: string; token: string }`
  - `function resolveConnection(env?: NodeJS.ProcessEnv, readFile?: () => ConnectionInfo | undefined): Connection`
    — throws an `Error` with a recovery hint when nothing resolves.

- [ ] **Step 1: Write the failing test**

Create `test/unit/bridge/resolve-connection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConnection } from "../../../src/bridge/bridge.js";

describe("resolveConnection", () => {
  it("prefers ABLETON_MCP_URL + ABLETON_MCP_TOKEN", () => {
    const c = resolveConnection(
      { ABLETON_MCP_URL: "http://127.0.0.1:9/mcp", ABLETON_MCP_TOKEN: "t" },
      () => undefined,
    );
    expect(c).toEqual({ url: "http://127.0.0.1:9/mcp", token: "t" });
  });

  it("builds the URL from ABLETON_MCP_PORT + token", () => {
    const c = resolveConnection(
      { ABLETON_MCP_PORT: "20999", ABLETON_MCP_TOKEN: "t" },
      () => undefined,
    );
    expect(c).toEqual({ url: "http://127.0.0.1:20999/mcp", token: "t" });
  });

  it("falls back to the connection file when env is absent", () => {
    const c = resolveConnection({}, () => ({
      url: "http://127.0.0.1:20808/mcp",
      token: "f",
    }));
    expect(c).toEqual({ url: "http://127.0.0.1:20808/mcp", token: "f" });
  });

  it("ignores a lone URL without a token", () => {
    const c = resolveConnection({ ABLETON_MCP_URL: "http://x/mcp" }, () => ({
      url: "http://file/mcp",
      token: "f",
    }));
    expect(c.url).toBe("http://file/mcp");
  });

  it("throws a recovery-hint error when nothing resolves", () => {
    expect(() => resolveConnection({}, () => undefined)).toThrow(/Ableton MCP: Status/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/bridge/resolve-connection.test.ts`
Expected: FAIL — cannot resolve `../../../src/bridge/bridge.js`.

- [ ] **Step 3: Write the implementation**

Create `src/bridge/bridge.ts`:

```ts
/**
 * The `ableton-mcp` stdio bridge. Runs OUTSIDE Live (never imports the Ableton
 * SDK — enforced by scripts/check-boundaries.mjs). It resolves the running
 * server's URL + token, then splices an MCP stdio client to the loopback HTTP
 * endpoint at the transport layer.
 */
import { readConnectionFile, type ConnectionInfo } from "../shell/connection-file.js";

export interface Connection {
  url: string;
  token: string;
}

/** env (URL or PORT + TOKEN) wins; else the connection file; else a hint error. */
export function resolveConnection(
  env: NodeJS.ProcessEnv = process.env,
  readFile: () => ConnectionInfo | undefined = readConnectionFile,
): Connection {
  const token = env.ABLETON_MCP_TOKEN;
  if (env.ABLETON_MCP_URL && token) {
    return { url: env.ABLETON_MCP_URL, token };
  }
  if (env.ABLETON_MCP_PORT && token) {
    return { url: `http://127.0.0.1:${env.ABLETON_MCP_PORT}/mcp`, token };
  }
  const fromFile = readFile();
  if (fromFile) {
    return { url: fromFile.url, token: fromFile.token };
  }
  throw new Error(
    "No Ableton MCP connection found. In Ableton Live, right-click a Scene in " +
      "Session view and choose 'Ableton MCP: Status…' to confirm the extension " +
      "is running, or set ABLETON_MCP_URL and ABLETON_MCP_TOKEN.",
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/bridge/resolve-connection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx eslint src/bridge/bridge.ts test/unit/bridge/resolve-connection.test.ts
git add src/bridge/bridge.ts test/unit/bridge/resolve-connection.test.ts
git commit -m "feat: resolveConnection env-then-file discovery for the bridge"
```

---

### Task 3: `runBridge` — the transport splice (component test vs FakeLive)

**Files:**

- Modify: `src/bridge/bridge.ts` (add `runBridge` + `RunningBridge`)
- Test: `test/component/bridge.test.ts`

**Interfaces:**

- Consumes: `StdioServerTransport` from `@modelcontextprotocol/sdk/server/stdio.js`;
  `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk/client/streamableHttp.js`;
  `startHttpServer` / `createMcpServer` + FakeLive-backed domain services (test only).
- Produces:
  - `interface RunningBridge { close(): Promise<void> }`
  - `function runBridge(opts: { url: string; token: string; stdin: Readable; stdout: Writable }): Promise<RunningBridge>`

- [ ] **Step 1: Write the failing test**

Create `test/component/bridge.test.ts`:

```ts
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../src/domain/clip-editor.js";
import { DeviceService } from "../../src/domain/device-service.js";
import { MixerService } from "../../src/domain/mixer-service.js";
import { SetInspector } from "../../src/domain/set-inspector.js";
import { SongService } from "../../src/domain/song-service.js";
import { TrackService } from "../../src/domain/track-service.js";
import { startHttpServer } from "../../src/mcp/http.js";
import { createMcpServer } from "../../src/mcp/server.js";
import { runBridge } from "../../src/bridge/bridge.js";

const TOKEN = "test-token-123";

describe("stdio bridge splice", () => {
  let fake: FakeLive;
  let server: Awaited<ReturnType<typeof startHttpServer>>;
  let bridge: Awaited<ReturnType<typeof runBridge>>;
  let stdin: PassThrough;
  let stdout: PassThrough;
  const waiters = new Map<number, (msg: any) => void>();

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }]);
    server = await startHttpServer({
      port: 0,
      token: TOKEN,
      createServer: () =>
        createMcpServer({
          inspector: new SetInspector(fake),
          tracks: new TrackService(fake),
          clips: new ClipEditor(fake),
          song: new SongService(fake),
          devices: new DeviceService(fake),
          mixer: new MixerService(fake),
        }),
    });

    stdin = new PassThrough();
    stdout = new PassThrough();
    let buf = "";
    stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (typeof msg.id === "number" && waiters.has(msg.id)) {
          waiters.get(msg.id)!(msg);
          waiters.delete(msg.id);
        }
      }
    });

    bridge = await runBridge({ url: server.url, token: TOKEN, stdin, stdout });
  });

  afterEach(async () => {
    await bridge.close();
    await server.close();
  });

  function rpc(id: number, method: string, params: unknown): Promise<any> {
    const p = new Promise<any>((resolve) => waiters.set(id, resolve));
    stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return p;
  }
  function notify(method: string): void {
    stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  }

  it("initializes, lists 21 tools, and calls get_set over stdio", async () => {
    const init = await rpc(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });
    expect(init.result.serverInfo).toBeDefined();
    notify("notifications/initialized");

    const list = await rpc(2, "tools/list", {});
    expect(list.result.tools.length).toBe(21);

    const call = await rpc(3, "tools/call", { name: "get_set", arguments: {} });
    expect(call.result.content).toBeDefined();
    expect(call.result.isError).toBeFalsy();
  }, 15000);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/component/bridge.test.ts`
Expected: FAIL — `runBridge` is not exported from `src/bridge/bridge.js`.

- [ ] **Step 3: Add `runBridge` to `src/bridge/bridge.ts`**

Add these imports at the top of `src/bridge/bridge.ts` (alongside the existing import):

```ts
import type { Readable, Writable } from "node:stream";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
```

Append to the file:

```ts
export interface RunningBridge {
  close(): Promise<void>;
}

/**
 * Splices an MCP stdio client (over the given streams) to the loopback HTTP
 * endpoint. Both transports are transparent JSONRPCMessage pipes — no
 * Client/Server objects — so capabilities and tool lists pass through untouched.
 */
export async function runBridge(opts: {
  url: string;
  token: string;
  stdin: Readable;
  stdout: Writable;
}): Promise<RunningBridge> {
  const stdio = new StdioServerTransport(opts.stdin, opts.stdout);
  const http = new StreamableHTTPClientTransport(new URL(opts.url), {
    requestInit: { headers: { Authorization: `Bearer ${opts.token}` } },
  });

  let closing = false;
  const closeBoth = (): void => {
    if (closing) return;
    closing = true;
    void http.close();
    void stdio.close();
  };

  stdio.onmessage = (msg) => void http.send(msg);
  http.onmessage = (msg) => void stdio.send(msg);
  stdio.onclose = closeBoth;
  http.onclose = closeBoth;
  stdio.onerror = (err) => console.error("[ableton-mcp bridge] stdio error:", err);
  http.onerror = (err) => console.error("[ableton-mcp bridge] http error:", err);

  await http.start();
  await stdio.start();

  return { close: async () => closeBoth() };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/component/bridge.test.ts`
Expected: PASS. (If `initialize` rejects on protocol version, assert on
`init.result` presence only — the SDK server negotiates rather than erroring.)

- [ ] **Step 5: Full gate + commit**

```bash
npm test && npm run typecheck && npm run lint
git add src/bridge/bridge.ts test/component/bridge.test.ts
git commit -m "feat: runBridge stdio<->HTTP transport splice"
```

---

### Task 4: CLI entry + build target + `bin` (buildable bridge)

**Files:**

- Create: `src/bridge/main.ts`
- Modify: `build.ts` (add a second esbuild target)
- Modify: `package.json` (add `bin`)

**Interfaces:**

- Consumes: `resolveConnection`, `runBridge` from `src/bridge/bridge.ts`.
- Produces: `dist/bridge.cjs` (executable, shebanged); `ableton-mcp` bin entry.

- [ ] **Step 1: Write the CLI entry**

Create `src/bridge/main.ts`:

```ts
/**
 * CLI entry for the `ableton-mcp` stdio bridge (esbuild adds the shebang).
 * Resolves the running server, then pumps stdio <-> HTTP. All diagnostics go to
 * stderr — stdout is reserved for the MCP JSON-RPC stream.
 */
import { resolveConnection, runBridge } from "./bridge.js";

async function main(): Promise<void> {
  const { url, token } = resolveConnection();
  await runBridge({ url, token, stdin: process.stdin, stdout: process.stdout });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

- [ ] **Step 2: Add the build target**

In `build.ts`, after the existing `await build({ ... entrypoint extension ... })`
call and before the `writeFileSync("dist/package.json", ...)` line, add:

```ts
await build({
  entryPoints: ["src/bridge/main.ts"],
  outfile: "dist/bridge.cjs",
  bundle: true,
  format: "cjs",
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: process.argv.includes("--dev"),
  minify: !process.argv.includes("--dev"),
});
```

And update the final log line to also mention the bridge:

```ts
console.log("built dist/extension.js and dist/bridge.cjs");
```

- [ ] **Step 3: Add the `bin` entry**

In `package.json`, add a top-level `"bin"` field (place it right after `"private": true,`):

```json
  "bin": {
    "ableton-mcp": "dist/bridge.cjs"
  },
```

- [ ] **Step 4: Build and smoke-test the bin end-to-end**

Run the build, then verify the bin errors cleanly with no connection, and pumps a
real request when pointed at a dev FakeLive server:

```bash
npm run build:dev
# (a) no connection -> exits non-zero with a hint on stderr, nothing on stdout:
ABLETON_MCP_URL= ABLETON_MCP_TOKEN= node dist/bridge.cjs </dev/null; echo "exit=$?"
```

Expected: a line containing `Ableton MCP: Status` on stderr; `exit=1`.

```bash
# (b) against a live dev server: start it, capture its URL/token, drive the bin.
ABLETON_MCP_TOKEN=smoke ABLETON_MCP_PORT=20808 npm run dev:fake &
sleep 2
printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"cli","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | ABLETON_MCP_PORT=20808 ABLETON_MCP_TOKEN=smoke node dist/bridge.cjs
# Expected: two JSON-RPC result lines on stdout; the id:2 line lists 21 tools.
kill %1
```

Expected: stdout shows the `initialize` result then a `tools/list` result whose
`result.tools` has length 21.

- [ ] **Step 5: Verify boundaries + commit**

```bash
npm run lint && npm run typecheck
git add src/bridge/main.ts build.ts package.json
git commit -m "feat: ableton-mcp bin — bridge CLI entry + esbuild target"
```

---

### Task 5: Extension writes the connection file on activation

**Files:**

- Modify: `src/extension.ts` (import + best-effort write after `startHttpServer`)

**Interfaces:**

- Consumes: `writeConnectionFile` from `src/shell/connection-file.ts`;
  `server.url` + `config.token` already in scope at the call site.
- Produces: a `connection.json` on disk whenever the extension activates.

- [ ] **Step 1: Add the import**

In `src/extension.ts`, alongside the existing `./shell/config.js` import, add:

```ts
import { writeConnectionFile } from "./shell/connection-file.js";
```

- [ ] **Step 2: Write the connection file after the server starts**

In `src/extension.ts`, immediately after the existing
`console.log(\`[ableton-mcp] MCP server running at ${server.url}\`);` line, add:

```ts
// Publish the effective URL + token to a fixed, externally-locatable path so
// the `ableton-mcp` stdio bridge can auto-discover them. Best-effort: a write
// failure must never crash activation.
try {
  writeConnectionFile({ url: server.url, token: config.token });
} catch (err) {
  console.error("[ableton-mcp] failed to write connection file:", err);
}
```

- [ ] **Step 3: Verify the SDK-side typecheck**

`extension.ts` is excluded from the default `npm run typecheck`; verify it with the
SDK-aware config (SDK is installed in this repo):

Run: `npm run typecheck:sdk`
Expected: no errors.

- [ ] **Step 4: Verify boundaries + commit**

`connection-file.ts` is SDK-free, and `extension.ts` is already exempt from the
SDK-quarantine rule, so the boundary check stays green.

```bash
npm run lint
git add src/extension.ts
git commit -m "feat: publish connection.json on activation for stdio-bridge discovery"
```

---

### Task 6: Documentation — ADR, capability map, README

**Files:**

- Create: `docs/decisions/0008-stdio-bridge.md`
- Modify: `docs/capability-map.md`
- Modify: `README.md`

**Interfaces:** none (docs only). `docs/tools.md` is generated and unaffected.

- [ ] **Step 1: Write ADR 0008**

Create `docs/decisions/0008-stdio-bridge.md` (match the context→decision→
alternatives→consequences shape of the existing ADRs 0001–0007):

```markdown
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
```

- [ ] **Step 2: Note the bridge in the capability map**

In `docs/capability-map.md`, in the "Runtime status" section, append a sentence:

```markdown
An **stdio bridge** (`dist/bridge.cjs`, the `ableton-mcp` bin) lets stdio-only MCP
clients reach the loopback HTTP endpoint; it auto-discovers the URL + token from a
fixed-path `connection.json` the extension writes on activation. See
[`decisions/0008-stdio-bridge.md`](decisions/0008-stdio-bridge.md).
```

- [ ] **Step 3: Add stdio connection instructions to the README**

In `README.md`, under the existing connection/usage guidance (near the
`claude mcp add --transport http …` instructions if present), add a subsection:

````markdown
### Connecting a stdio-only MCP client

Clients that speak only stdio (e.g. Claude Desktop) connect through the bundled
bridge. Build it once (`npm run build`), then point the client at:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/ableton-mcp-extension/dist/bridge.cjs"]
}
```
````

The bridge auto-discovers the running extension's URL + token from
`connection.json` (written on activation). To override, set `ABLETON_MCP_URL` (or
`ABLETON_MCP_PORT`) and `ABLETON_MCP_TOKEN` in the client's `env`.

````

- [ ] **Step 4: Format + commit**

```bash
npm run format
git add docs/decisions/0008-stdio-bridge.md docs/capability-map.md README.md
git commit -m "docs: ADR 0008 + capability map + README for the stdio bridge"
````

---

## Self-Review

**Spec coverage:**

- connection-file contract (path table, 0600, corrupt→undefined) → Task 1. ✓
- `resolveConnection` env precedence + hint error → Task 2. ✓
- `runBridge` transport splice + component test (21 tools, real tool call) → Task 3. ✓
- CLI entry, `dist/bridge.cjs` build target, `bin` → Task 4. ✓
- extension writes connection file (best-effort) → Task 5. ✓
- ADR 0008, capability-map, README → Task 6. ✓
- Boundaries (bridge SDK-free, auto-enforced; bridge in CI typecheck) → Global
  Constraints + Task 3/5 gates. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ConnectionInfo`, `Connection`, `RunningBridge`,
`connectionFilePath`/`writeConnectionFile`/`readConnectionFile`,
`resolveConnection`, `runBridge` names/signatures match across Tasks 1–5 and the
spec. The tool-count assertion is `21` everywhere. ✓

**Not covered by tests (documented):** `extension.ts` wiring (Task 5) is verified by
`npm run typecheck:sdk` only — its runtime behavior is exercised during the in-Live
smoke, consistent with how the composition root is treated elsewhere.
