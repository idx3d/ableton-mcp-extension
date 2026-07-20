#!/usr/bin/env node
/**
 * Enforces the architecture rules from CLAUDE.md / the design spec:
 *
 *   1. Only src/adapters/sdk-*, src/shell/, and src/extension.ts may import
 *      @ableton-extensions/*.
 *   2. src/port/ imports nothing outside itself (no packages, no other layers).
 *   3. src/domain/ imports only src/port/ and itself.
 *   4. src/mcp/ never imports src/adapters/ (adapters are injected at the
 *      composition root: src/extension.ts, src/dev/, tests).
 *   5. src/mcp/, src/domain/, src/port/, src/adapters/fake/ must not import
 *      src/shell/ (the shell stays an outer ring).
 *
 * Exits non-zero listing every violation. Runs as part of `npm run lint`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, dirname, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(ts|mts|cts)$/.test(entry.name) ? [full] : [];
  });
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;'"]*?from\s+["']([^"']+)["']/g;

function importsOf(file) {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]);
}

/** Resolve a relative import to a src-root-relative path like "port/types.js". */
function resolveRelative(file, spec) {
  return relative(SRC, resolve(dirname(file), spec))
    .split(sep)
    .join("/");
}

const violations = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).split(sep).join("/");
  const layer = rel.split("/")[0];
  const inSdkAdapter = rel.startsWith("adapters/sdk-");

  for (const spec of importsOf(file)) {
    const isRelative = spec.startsWith(".");
    const target = isRelative ? resolveRelative(file, spec) : null;

    if (
      spec.startsWith("@ableton-extensions/") &&
      !inSdkAdapter &&
      layer !== "shell" &&
      rel !== "extension.ts"
    ) {
      violations.push(
        `${rel}: imports ${spec} (only src/adapters/sdk-*, src/shell/, src/extension.ts may)`,
      );
    }
    if (
      (layer === "mcp" ||
        layer === "domain" ||
        layer === "port" ||
        rel.startsWith("adapters/fake/")) &&
      isRelative &&
      target.startsWith("shell/")
    ) {
      violations.push(`${rel}: must not import shell/ (keep the shell an outer ring)`);
    }
    if (layer === "port") {
      if (!isRelative || !target.startsWith("port/")) {
        violations.push(`${rel}: port/ must not import ${spec}`);
      }
    }
    if (layer === "domain" && isRelative) {
      if (!target.startsWith("port/") && !target.startsWith("domain/")) {
        violations.push(`${rel}: domain/ may only import port/ and domain/, not ${spec}`);
      }
    }
    if (layer === "domain" && !isRelative) {
      violations.push(`${rel}: domain/ must not import packages (${spec})`);
    }
    if (layer === "mcp" && isRelative && target.startsWith("adapters/")) {
      violations.push(
        `${rel}: mcp/ must not import adapters/ (inject via composition root)`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:\n");
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(`\n${violations.length} violation(s). See CLAUDE.md for the rules.`);
  process.exit(1);
}
console.log("Architecture boundaries OK.");
