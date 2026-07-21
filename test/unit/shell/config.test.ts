import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOrCreateConfig } from "../../../src/shell/config.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "amcp-cfg-"));
}

describe("loadOrCreateConfig", () => {
  it("defaults the port to 20808 and mints a UUID token", () => {
    const cfg = loadOrCreateConfig(tempDir());
    expect(cfg.port).toBe(20808);
    expect(cfg.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("persists the token across two loads of the same storage dir", () => {
    const dir = tempDir();
    const first = loadOrCreateConfig(dir);
    const second = loadOrCreateConfig(dir);
    expect(second.token).toBe(first.token);
    expect(second.port).toBe(first.port);
  });

  it("writes config.json into the storage dir", () => {
    const dir = tempDir();
    const cfg = loadOrCreateConfig(dir);
    const onDisk = JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as {
      port: number;
      token: string;
    };
    expect(onDisk.token).toBe(cfg.token);
    expect(onDisk.port).toBe(20808);
  });

  it("creates the storage dir if it does not exist", () => {
    const dir = join(tempDir(), "nested", "state");
    const cfg = loadOrCreateConfig(dir);
    expect(cfg.token).toBeTruthy();
    expect(() => readFileSync(join(dir, "config.json"), "utf8")).not.toThrow();
  });

  it("heals a corrupt config file by re-minting instead of throwing", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), "{ not json");
    const cfg = loadOrCreateConfig(dir);
    expect(cfg.port).toBe(20808);
    expect(cfg.token).toBeTruthy();
    // The healed file is valid JSON on the next load.
    expect(loadOrCreateConfig(dir).token).toBe(cfg.token);
  });
});
