import { describe, expect, it } from "vitest";
import { IdRegistry } from "../../../src/adapters/sdk-1.0/id-registry.js";

describe("IdRegistry", () => {
  it("mints stable, sequential IDs per object", () => {
    const reg = new IdRegistry<object>("t");
    const a = {};
    const b = {};
    expect(reg.idFor(a)).toBe("t1");
    expect(reg.idFor(b)).toBe("t2");
    expect(reg.idFor(a)).toBe("t1");
    expect(reg.resolve("t2")).toBe(b);
  });

  it("never reuses IDs after forget", () => {
    const reg = new IdRegistry<object>("c");
    const a = {};
    reg.idFor(a);
    reg.forget(a);
    expect(reg.resolve("c1")).toBeUndefined();
    expect(reg.idFor({})).toBe("c2");
  });
});
