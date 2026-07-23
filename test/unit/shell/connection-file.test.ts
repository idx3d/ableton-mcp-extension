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
