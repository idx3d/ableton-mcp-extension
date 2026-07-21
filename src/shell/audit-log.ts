/**
 * Tool-call audit log — SDK-FREE (enforced by scripts/check-boundaries.mjs).
 * Every MCP tool result is appended as one JSONL line to
 * `<dir>/logs/audit.jsonl` for durable history, and mirrored into a small
 * in-memory ring so the status dialog can show the most recent activity
 * without re-reading the file.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** What createMcpServer's onToolResult callback reports for each call. */
export interface ToolReport {
  tool: string;
  ok: boolean;
  code?: string;
  durationMs: number;
}

/** A persisted audit entry: a ToolReport plus the wall-clock time it ran. */
export interface AuditEntry extends ToolReport {
  at: string;
}

/** Upper bound on the in-memory ring used by recent(). */
const MAX_RING = 100;

export class AuditLog {
  private readonly logFile: string;
  private readonly ring: AuditEntry[] = [];

  constructor(dir: string) {
    const logsDir = join(dir, "logs");
    mkdirSync(logsDir, { recursive: true });
    this.logFile = join(logsDir, "audit.jsonl");
  }

  /** Appends the entry to the JSONL file and pushes it onto the bounded ring. */
  record(entry: ToolReport): void {
    const full: AuditEntry = {
      tool: entry.tool,
      ok: entry.ok,
      ...(entry.code !== undefined ? { code: entry.code } : {}),
      durationMs: entry.durationMs,
      at: new Date().toISOString(),
    };

    try {
      appendFileSync(this.logFile, `${JSON.stringify(full)}\n`);
    } catch (err) {
      // The audit log must never break a tool call; a full/unwritable disk
      // degrades to in-memory-only history.
      console.error("[ableton-mcp] audit append failed:", err);
    }

    this.ring.push(full);
    if (this.ring.length > MAX_RING) {
      this.ring.splice(0, this.ring.length - MAX_RING);
    }
  }

  /** The most recent `n` entries, newest first (empty for non-positive `n`). */
  recent(n: number): AuditEntry[] {
    if (n <= 0) return [];
    return this.ring.slice(-n).reverse();
  }
}
