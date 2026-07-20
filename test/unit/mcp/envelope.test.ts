import { describe, expect, it, vi } from "vitest";
import { PortError } from "../../../src/port/errors.js";
import { runTool } from "../../../src/mcp/envelope.js";

describe("runTool", () => {
  it("spreads a successful object result into ok envelope", async () => {
    const result = await runTool(async () => ({ track: { id: "t1" } }));
    expect(result).toEqual({ ok: true, track: { id: "t1" } });
  });

  it("maps PortError to a structured failure with hint", async () => {
    const result = await runTool(async () => {
      throw PortError.notFound("track", "t9");
    });
    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "track t9 not found",
      hint: expect.stringContaining("get_set"),
    });
  });

  it("maps unexpected errors to INTERNAL without leaking details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runTool(async () => {
      throw new Error("secret stack detail");
    });
    spy.mockRestore();
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("also catches synchronous PortError throws", async () => {
    const result = await runTool(() => {
      throw new PortError("INVALID_INPUT", "bad");
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
