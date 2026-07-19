import { PortError, type PortErrorCode } from "../port/errors.js";

export type ToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: PortErrorCode; message: string; hint?: string };

/**
 * Robustness boundary: tools never throw to the client. PortErrors become
 * structured, self-correcting failures; anything else becomes INTERNAL with
 * a generic message (details belong in the audit log, Plan 3).
 */
export async function runTool(
  fn: () => Promise<unknown> | unknown,
): Promise<ToolResult> {
  try {
    const value = await fn();
    return { ok: true, ...(value as Record<string, unknown>) };
  } catch (error) {
    if (error instanceof PortError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      };
    }
    console.error("[ableton-mcp] internal tool error:", error);
    return {
      ok: false,
      code: "INTERNAL",
      message: "Internal error while executing the tool.",
      hint: "This is a bug in the extension, not in your request. Try a different approach.",
    };
  }
}
