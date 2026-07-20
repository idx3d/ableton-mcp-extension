import { describe, expect, it } from "vitest";
import { PortError } from "../../../src/port/errors.js";

describe("PortError", () => {
  it("carries code, message and hint", () => {
    const e = new PortError("INVALID_INPUT", "bad pitch", "Pitch must be 0-127.");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("INVALID_INPUT");
    expect(e.message).toBe("bad pitch");
    expect(e.hint).toBe("Pitch must be 0-127.");
  });

  it("notFound factory produces a self-correcting hint", () => {
    const e = PortError.notFound("track", "t9");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("track t9 not found");
    expect(e.hint).toContain("get_set");
  });
});
