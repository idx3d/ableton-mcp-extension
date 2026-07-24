/**
 * Shared esbuild options for the extension and bridge bundles. Imported by
 * `build.ts` (the real build) and by the bundle-load regression test, so the
 * test exercises the exact options that ship — removing the `global` define
 * below fails the test.
 */
import type { BuildOptions } from "esbuild";

/**
 * The Extension Host evaluates the bundle in a context that exposes `globalThis`
 * but NOT the Node-specific `global` binding (a vm-context, unlike real Node
 * where `global` self-references the global object). A bundled
 * `@hono/node-server` fetch shim (pulled transitively via the MCP SDK's HTTP
 * transport) references bare `global` (`global.Request`, `global.crypto`, …),
 * throwing `ReferenceError: global is not defined` at load time and crashing the
 * host. Rewriting `global` → `globalThis` (always defined) fixes it. Node and
 * vitest both define `global`, so CI unit/component tests never hit this — only
 * an in-Live load, or the bundle-load regression test, does.
 */
const define: Record<string, string> = { global: "globalThis" };

function base(dev: boolean): BuildOptions {
  return {
    bundle: true,
    format: "cjs",
    platform: "node",
    define,
    sourcemap: dev,
    minify: !dev,
  };
}

export function extensionBuildOptions(dev: boolean): BuildOptions {
  return {
    ...base(dev),
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
  };
}

export function bridgeBuildOptions(dev: boolean): BuildOptions {
  return {
    ...base(dev),
    entryPoints: ["src/bridge/main.ts"],
    outfile: "dist/bridge.cjs",
    banner: { js: "#!/usr/bin/env node" },
  };
}
