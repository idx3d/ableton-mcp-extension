import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { extensionBuildOptions } from "../../scripts/build-config.js";

/**
 * Ableton's Extension Host evaluates the bundle in a stripped Node vm-context
 * that exposes only a handful of globals and NONE of the web platform globals
 * (`URL`, `TextEncoder`, `crypto`, `Request`, `Response`, `ReadableStream`, …) or
 * the bare `global` identifier. On first in-Live load this crashed twice —
 * `ReferenceError: global is not defined`, then `Class extends value undefined`
 * (a bundled `@hono/node-server` shim extending the absent `Request`). Normal
 * Node/vitest define all of these, so nothing else in the suite catches it.
 *
 * This test recreates the exact host context (inventory captured from an in-Live
 * probe on Live 12.4.5b8 / Node 24.14.1) and evaluates the bundles built with the
 * SHIPPED options (`extensionBuildOptions`, which carry the `global→globalThis`
 * define AND the host-globals prelude). We cannot bundle `src/extension.ts` in CI
 * (it imports the Ableton SDK, absent there — ADR 0005), so we cover the two
 * SDK-free entries that pull the load-time dependency graph: `src/mcp/server.ts`
 * (SDK core + every tool + zod) and `src/mcp/http.ts` (the node:http transport).
 * Removing the prelude or the define, or reintroducing a web-global dependency,
 * fails this test with the same error the host threw.
 */

/** Globals the Extension Host provides, beyond the JS intrinsics every vm context has. */
function hostSandbox(entryPath: string): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {
    fetch: globalThis.fetch,
    AbortController: globalThis.AbortController,
    Buffer: globalThis.Buffer,
    process: globalThis.process,
    console: globalThis.console,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    require: createRequire(entryPath),
  };
  const moduleObj = { exports: {} as Record<string, unknown> };
  sandbox.module = moduleObj;
  sandbox.exports = moduleObj.exports;
  return sandbox;
}

async function bundleWithShippedOptions(entry: string): Promise<string> {
  const result = await build({
    ...extensionBuildOptions(false),
    entryPoints: [entry],
    outfile: "bundle.js",
    write: false,
  });
  return result.outputFiles[0].text;
}

function loadInHostContext(code: string, entry: string): Record<string, unknown> {
  const sandbox = hostSandbox(resolve(entry));
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: resolve(entry) });
  return (sandbox.module as { exports: Record<string, unknown> }).exports;
}

describe("extension bundle loads in the stripped Extension Host context", () => {
  it("evaluates src/mcp/server.ts (SDK core + tools + zod)", async () => {
    const code = await bundleWithShippedOptions("src/mcp/server.ts");
    const exported = loadInHostContext(code, "src/mcp/server.ts");
    expect(typeof exported.createMcpServer).toBe("function");
  });

  it("evaluates src/mcp/http.ts (node:http transport)", async () => {
    const code = await bundleWithShippedOptions("src/mcp/http.ts");
    const exported = loadInHostContext(code, "src/mcp/http.ts");
    expect(typeof exported.startHttpServer).toBe("function");
  });
});
