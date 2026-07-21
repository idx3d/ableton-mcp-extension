#!/usr/bin/env node
/**
 * Cross-platform replacement for shelling out to `extensions-cli package`
 * with a bash `$(...)`-computed -o path. That form only works under a POSIX
 * shell, so it silently breaks on Windows cmd.exe (both Ableton Live and
 * this project's CI matrix target Windows).
 *
 * This script:
 *   1. Reads manifest.json directly (no shell command substitution).
 *   2. Computes the .ablx filename using the exact same convention as the
 *      CLI's own default (see @ableton-extensions/cli's packageExtension,
 *      which does `manifest.name.replace(/\s+/gu, "-") + "-" + version +
 *      ".ablx"`) so our explicit -o path matches what users already expect
 *      from `extensions-cli package .` with no -o flag.
 *   3. Ensures dist/ exists.
 *   4. Invokes the CLI's bin script directly via
 *      `execFileSync(process.execPath, [cliBin, ...argv])` — no shell, no
 *      npx. We resolve the CLI's entry point from its own package.json
 *      "bin" field rather than shelling out to `npx extensions-cli`,
 *      because npx's executable resolution goes through PATH/PATHEXT
 *      lookups that behave differently across platforms (and can silently
 *      pick up a stale global install); invoking the resolved .mjs file
 *      with the current `node` binary is deterministic everywhere.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const name = manifest.name ?? "extension";
const version = manifest.version ?? "0.0.0";
const ablxName = `${name.replace(/\s+/gu, "-")}-${version}.ablx`;

const distDir = join(root, "dist");
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const cliPackageJsonPath = join(
  root,
  "node_modules",
  "@ableton-extensions",
  "cli",
  "package.json",
);
const cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, "utf8"));
const cliBin = join(dirname(cliPackageJsonPath), cliPackageJson.bin["extensions-cli"]);

const outPath = join("dist", ablxName);

execFileSync(
  process.execPath,
  [cliBin, "package", ".", "-o", outPath, "-i", "dist/package.json"],
  { cwd: root, stdio: "inherit" },
);

console.log(`packaged ${outPath}`);
