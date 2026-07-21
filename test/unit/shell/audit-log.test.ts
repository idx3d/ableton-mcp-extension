import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog } from "../../../src/shell/audit-log.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "amcp-audit-"));
}

describe("AuditLog", () => {
  it("appends one JSONL line per record to logs/audit.jsonl", () => {
    const dir = tempDir();
    const log = new AuditLog(dir);
    log.record({ tool: "get_set", ok: true, durationMs: 5 });
    log.record({
      tool: "create_tracks",
      ok: false,
      code: "INVALID_INPUT",
      durationMs: 2,
    });

    const lines = readFileSync(join(dir, "logs", "audit.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(first.tool).toBe("get_set");
    expect(first.ok).toBe(true);
    expect(first.durationMs).toBe(5);
    expect(typeof first.at).toBe("string");

    const second = JSON.parse(lines[1]) as Record<string, unknown>;
    expect(second.ok).toBe(false);
    expect(second.code).toBe("INVALID_INPUT");
  });

  it("returns recent entries newest-first", () => {
    const log = new AuditLog(tempDir());
    log.record({ tool: "a", ok: true, durationMs: 1 });
    log.record({ tool: "b", ok: true, durationMs: 1 });
    log.record({ tool: "c", ok: true, durationMs: 1 });
    expect(log.recent(2).map((e) => e.tool)).toEqual(["c", "b"]);
    expect(log.recent(10).map((e) => e.tool)).toEqual(["c", "b", "a"]);
  });

  it("bounds the in-memory ring to the last 100 entries", () => {
    const log = new AuditLog(tempDir());
    for (let i = 0; i < 150; i++) log.record({ tool: `t${i}`, ok: true, durationMs: 1 });
    const recent = log.recent(1000);
    expect(recent).toHaveLength(100);
    expect(recent[0].tool).toBe("t149");
    expect(recent[99].tool).toBe("t50");
  });

  it("returns an empty array for non-positive n", () => {
    const log = new AuditLog(tempDir());
    log.record({ tool: "a", ok: true, durationMs: 1 });
    expect(log.recent(0)).toEqual([]);
    expect(log.recent(-3)).toEqual([]);
  });
});
