import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

/**
 * The prelude is injected as an esbuild banner and runs before any dependency,
 * installing the web globals Ableton's stripped Extension Host omits (see
 * scripts/host-globals-prelude.js). We run it in a vm context that starts WITHOUT
 * those globals (mirroring the host) and assert it fills them in from node:
 * builtins. Emptying the prelude fails this test.
 */
const preludePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/host-globals-prelude.js",
);

describe("host-globals prelude", () => {
  it("installs the web globals the Extension Host omits", () => {
    const code = readFileSync(preludePath, "utf8");
    // A stripped context: only `require` (as the host provides), no web globals.
    const sandbox: Record<string, unknown> = { require: createRequire(preludePath) };
    vm.createContext(sandbox);

    // Precondition: these are absent, as in the host.
    for (const name of ["URL", "TextEncoder", "crypto", "ReadableStream"]) {
      expect(sandbox[name], `${name} should start undefined`).toBeUndefined();
    }

    vm.runInContext(code, sandbox, { filename: preludePath });

    for (const name of [
      "URL",
      "URLSearchParams",
      "TextEncoder",
      "TextDecoder",
      "crypto",
      "ReadableStream",
      "WritableStream",
      "TransformStream",
      "Blob",
      "performance",
      "queueMicrotask",
    ]) {
      expect(typeof sandbox[name], `${name} should be installed`).not.toBe("undefined");
    }

    // The installed classes actually work.
    const URLCtor = sandbox.URL as typeof URL;
    expect(new URLCtor("http://127.0.0.1:20808/mcp").pathname).toBe("/mcp");
    const Enc = sandbox.TextEncoder as typeof TextEncoder;
    expect(new Enc().encode("ok")).toBeInstanceOf(Uint8Array);
  });
});
