import { createRequire } from "node:module";
import { resolve } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { extensionBuildOptions } from "../../scripts/build-config.js";

/**
 * The Ableton Extension Host evaluates the bundle in a context that exposes
 * `globalThis` but NOT Node's `global` binding. A bundled `@hono/node-server`
 * fetch shim (pulled via the MCP SDK's HTTP transport) references bare `global`,
 * which threw `ReferenceError: global is not defined` and crashed the host on
 * first in-Live load. Normal Node/vitest always define `global`, so nothing else
 * in the suite catches this — this test recreates the host condition.
 *
 * We cannot bundle `src/extension.ts` in CI (it imports the Ableton SDK, which is
 * not installed there — ADR 0005). `src/mcp/http.ts` is SDK-free, pulls the same
 * `@hono/node-server` shim through `StreamableHTTPServerTransport`, and is built
 * with the SAME shared options (`extensionBuildOptions`) that ship — so removing
 * the `global` → `globalThis` define from `scripts/build-config.ts` fails here.
 */
async function bundleWithShippedOptions(entry: string): Promise<string> {
  const result = await build({
    ...extensionBuildOptions(false),
    entryPoints: [entry],
    outfile: "bundle.js",
    write: false,
  });
  return result.outputFiles[0].text;
}

/** Evaluate CJS `code` in a context mirroring the host: `globalThis` yes, `global` no. */
function loadInGlobalLessContext(code: string, entry: string): Record<string, unknown> {
  const sandbox: Record<string, unknown> = {};
  for (const key of Object.getOwnPropertyNames(globalThis)) {
    try {
      sandbox[key] = (globalThis as Record<string, unknown>)[key];
    } catch {
      /* some getters throw; skip */
    }
  }
  delete sandbox.global; // the host does not expose the bare `global` identifier

  const entryPath = resolve(entry);
  sandbox.require = createRequire(entryPath);
  const moduleObj = { exports: {} as Record<string, unknown> };
  sandbox.module = moduleObj;
  sandbox.exports = moduleObj.exports;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: entryPath });
  return moduleObj.exports;
}

describe("extension bundle loads without Node's `global` binding", () => {
  const ENTRY = "src/mcp/http.ts";

  it("evaluates in a global-less context (Extension Host parity)", async () => {
    const code = await bundleWithShippedOptions(ENTRY);
    const exported = loadInGlobalLessContext(code, ENTRY);
    // Full top-level evaluation ran (the hono shim executes at module load);
    // startHttpServer is http.ts's export, proving the module fully evaluated.
    expect(typeof exported.startHttpServer).toBe("function");
  });

  it("emits no bare `global` reference in the shipped bundle", async () => {
    const code = await bundleWithShippedOptions(ENTRY);
    const bareGlobal = /(^|[^A-Za-z0-9_.$])global([^A-Za-z0-9_]|$)/;
    expect(bareGlobal.test(code)).toBe(false);
  });
});
