/**
 * Shell configuration — SDK-FREE (enforced by scripts/check-boundaries.mjs).
 * Reads/writes a small JSON file in the extension's storage directory so the
 * server port and bearer token survive across Live sessions.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ShellConfig {
  port: number;
  token: string;
}

/** Fixed default port (spec §7); overridable by an existing config.json. */
const DEFAULT_PORT = 20808;

/**
 * Loads config.json from `storageDir`, filling in defaults for anything
 * missing, then persists the result. The bearer token is minted once with
 * `crypto.randomUUID()` and reused on every subsequent load. A corrupt or
 * unreadable file is treated as empty and healed rather than fatal.
 */
export function loadOrCreateConfig(storageDir: string): ShellConfig {
  mkdirSync(storageDir, { recursive: true });
  const configPath = join(storageDir, "config.json");

  let existing: Partial<ShellConfig> = {};
  if (existsSync(configPath)) {
    try {
      existing = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ShellConfig>;
    } catch {
      existing = {};
    }
  }

  const config: ShellConfig = {
    port: typeof existing.port === "number" ? existing.port : DEFAULT_PORT,
    token:
      typeof existing.token === "string" && existing.token.length > 0
        ? existing.token
        : randomUUID(),
  };

  // Persist unconditionally: first-run creation, and healing of a partial or
  // corrupt file. The write is idempotent for an already-valid config.
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
