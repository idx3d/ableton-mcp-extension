/**
 * The shell↔bridge discovery contract. SDK-FREE (enforced by
 * scripts/check-boundaries.mjs). The extension writes this file to a fixed,
 * OS-conventional path so the external `ableton-mcp` stdio bridge can find the
 * running server's URL + bearer token — the SDK-assigned storageDirectory is
 * not reconstructable from outside Live.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ConnectionInfo {
  url: string;
  token: string;
  updatedAt?: string;
}

/** Fixed, OS-conventional path both the extension (writer) and bridge (reader) agree on. */
export function connectionFilePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const dir =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "ableton-mcp")
      : platform === "win32"
        ? join(env.APPDATA ?? join(home, "AppData", "Roaming"), "ableton-mcp")
        : join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "ableton-mcp");
  return join(dir, "connection.json");
}

/** Writes {url, token, updatedAt} at 0600 (it carries the bearer token). */
export function writeConnectionFile(
  info: { url: string; token: string },
  path: string = connectionFilePath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const body: ConnectionInfo = { ...info, updatedAt: new Date().toISOString() };
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
}

/** Reads the connection file; returns undefined if absent, corrupt, or incomplete. */
export function readConnectionFile(
  path: string = connectionFilePath(),
): ConnectionInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<ConnectionInfo>;
    if (typeof parsed.url === "string" && typeof parsed.token === "string") {
      return { url: parsed.url, token: parsed.token, updatedAt: parsed.updatedAt };
    }
    return undefined;
  } catch {
    return undefined;
  }
}
