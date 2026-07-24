# 0009 — Running in the real Extension Host (stripped runtime + bigint marshalling)

## Context

The design spec and capability map assumed the Extension Host was **"full Node.js
≥ 24.14.1."** The first in-Live smoke run (Live 12.4.5b8, macOS, 2026-07-24)
proved that wrong in three ways. An in-Live diagnostic probe captured the actual
runtime; see the runtime notes in `docs/capability-map.md`.

1. **No bare `global`.** The host evaluates the bundle in a `vm` context where
   only `globalThis` exists, not Node's `global` self-reference. A bundled fetch
   shim referencing `global` threw `ReferenceError: global is not defined` at
   load.
2. **Almost no web globals.** The context provides `fetch`, `AbortController`,
   `Buffer`, `process`, `console`, `require`, and timers — and **none** of
   `URL`, `TextEncoder`/`TextDecoder`, `crypto`, `Request`, `Response`, `Headers`,
   `ReadableStream`, `Blob`, `Event`, `EventTarget`, … Node builtin modules ARE
   requirable. The MCP SDK's `StreamableHTTPServerTransport` is built on
   `@hono/node-server`, whose shim does `class extends globalThis.Request` at
   module-init — and `Request` is absent, throwing `Class extends value undefined`.
3. **Integer getters marshal as `bigint`.** The SDK types getters like
   `Clip.color`, `Song.rootNote`, MIDI pitch/velocity, and marker positions as
   `number`, but the native layer returns them as `bigint`. `colorToHex` did
   `bigint & 0xffffff` and threw `Cannot mix BigInt and other types`.

FakeLive and the Node/vitest CI world exhibit none of these (full Node globals,
plain-number values), so the whole test suite was green while the extension could
not load in Live. This is exactly the gap the in-Live smoke gate exists to close.

## Decision

1. **`define: { global: "globalThis" }`** on both esbuild bundles
   (`scripts/build-config.ts`).
2. **Drop the hono-based transport.** Replace `StreamableHTTPServerTransport` with
   a custom `node:http`-native `NodeHttpStatelessTransport`
   (`src/mcp/node-http-transport.ts`) implementing the SDK `Transport` interface.
   It speaks the subset of Streamable HTTP we use — stateless, JSON responses, one
   `McpServer` per request — with no Web `Request`/`Response`/`Headers`. The wire
   protocol is unchanged, so the stdio bridge's client transport is unaffected.
3. **Host-globals prelude.** `scripts/host-globals-prelude.js`, injected as an
   esbuild banner so it runs before any dependency, installs the missing web
   globals from `node:` builtins (`URL`←`node:url`, `TextEncoder`←`node:util`,
   `crypto`←`node:crypto.webcrypto`, streams←`node:stream/web`, `Blob`←`node:buffer`,
   `performance`←`node:perf_hooks`) — needed by the SDK core and our own `new URL()`
   at request time.
4. **`toNumber` boundary coercion.** `src/adapters/sdk-1.0/codec.ts` exports
   `toNumber(v) = typeof v === "bigint" ? Number(v) : v`, applied to every
   integer-domain SDK read in the adapter. `Number()` is a no-op for real numbers,
   so float getters are unaffected.

## Alternatives

- **Polyfill `Request`/`Response`/`Headers`** (bundle a fetch ponyfill) to keep
  hono. Rejected: bolts a web-compat layer onto a non-web host, keeps bundling
  hono, and risks WHATWG-compliance mismatches in the transport's body handling.
  `Request`/`Response`/`Headers` are also not sourceable from any `node:` builtin
  (undici is not installed in the host), so this needs a bundled dependency that
  itself assumes more absent globals (`Event`/`EventTarget`/…).
- **Downgrade the MCP SDK** to a pre-hono server transport. Rejected: larger blast
  radius on the tool/server API and the just-shipped bridge; the custom transport
  is ~120 lines and validated by the existing real-client component tests.
- **Coerce bigints only where they crash.** Rejected in favor of coercing the
  whole adapter boundary — one pass avoids whack-a-mole across in-Live runs.

## Consequences

- The extension loads and runs in the real Extension Host: **macOS self-test 20/20,
  0 failed**, validating color packing, note round-trips, mixer send↔return
  ordering, and device params.
- No `@hono/node-server` in the bundle (smaller output). The transport is fully
  ours, so its correctness rides on the component tests (real MCP client ↔ our
  server) plus the faithful-host bundle-load and prelude tests, which reproduce the
  stripped context in CI.
- New regression guards: `test/component/extension-bundle-load.test.ts` (bundle
  loads in a faithful host `vm` context), `test/unit/host-globals-prelude.test.ts`
  (prelude installs the globals), and bigint cases in `test/unit/adapters/sdk-codec.test.ts`.
- **Filesystem is sandboxed to `storageDirectory`/`tempDirectory`.** Writes
  elsewhere throw `ERR_ACCESS_DENIED`. This breaks the stdio bridge's fixed-path
  `connection.json` discovery in-Live (the write is best-effort and caught, so it
  only logs) — tracked as a follow-up; the bridge needs env-var or
  storageDirectory-based discovery instead.
