import { writeFileSync } from "node:fs";
import { build } from "esbuild";
import { bridgeBuildOptions, extensionBuildOptions } from "./scripts/build-config.js";

const dev = process.argv.includes("--dev");

await build(extensionBuildOptions(dev));
await build(bridgeBuildOptions(dev));

// package.json declares "type": "module" (this repo is ESM-first), so Node's
// require() would otherwise resolve dist/extension.js's module type by
// walking up to that ancestor and load our esbuild-cjs bundle as ESM — which
// silently drops the `activate` named export instead of throwing (Node's
// require(esm) support parses/executes the file, but a plain
// `module.exports = ...` assignment isn't recognized as a named export the
// way it is under true CommonJS). The Extension Host's own loader relies on
// a global `require()` to evaluate this same bundle (see
// @ableton-extensions/cli's run.ts), so it hits the same ambiguity. A nested
// package.json pins dist/ to CommonJS regardless of the root's "type".
writeFileSync("dist/package.json", JSON.stringify({ type: "commonjs" }) + "\n");

console.log("built dist/extension.js and dist/bridge.cjs");
