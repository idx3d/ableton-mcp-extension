/**
 * In-memory ring of recent log lines for the status dialog's Logs screen —
 * SDK-FREE (enforced by scripts/check-boundaries.mjs). `install()` intercepts a
 * console so server events and errors are captured for in-Live viewing while
 * still forwarding to the host's `ExtensionHost.txt`. Tool-call summaries are
 * pushed in by the composition root so the screen is a unified event stream.
 */
export type LogLevel = "info" | "error" | "tool";

export interface LogLine {
  at: string;
  level: LogLevel;
  message: string;
}

/** The subset of `console` we wrap. */
export interface ConsoleLike {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

export class LogBuffer {
  private readonly ring: LogLine[] = [];

  constructor(private readonly capacity = 200) {}

  push(level: LogLevel, message: string): void {
    this.ring.push({ at: new Date().toISOString(), level, message });
    if (this.ring.length > this.capacity) {
      this.ring.splice(0, this.ring.length - this.capacity);
    }
  }

  /** Most recent `n` lines, newest first (empty for non-positive `n`). */
  recent(n: number): LogLine[] {
    if (n <= 0) return [];
    return this.ring.slice(-n).reverse();
  }

  /**
   * Wraps `target.log`/`target.error` so each call is captured here and then
   * forwarded to the original. Idempotency is the caller's responsibility —
   * install once, early in activation.
   */
  install(target: ConsoleLike = console): void {
    const origLog = target.log.bind(target);
    const origError = target.error.bind(target);
    target.log = (...args: unknown[]): void => {
      this.push("info", args.map(formatArg).join(" "));
      origLog(...args);
    };
    target.error = (...args: unknown[]): void => {
      this.push("error", args.map(formatArg).join(" "));
      origError(...args);
    };
  }
}
