import { describe, expect, it } from "vitest";
import { resolveConnection } from "../../../src/bridge/bridge.js";

describe("resolveConnection", () => {
  it("prefers ABLETON_MCP_URL + ABLETON_MCP_TOKEN", () => {
    const c = resolveConnection(
      { ABLETON_MCP_URL: "http://127.0.0.1:9/mcp", ABLETON_MCP_TOKEN: "t" },
      () => undefined,
    );
    expect(c).toEqual({ url: "http://127.0.0.1:9/mcp", token: "t" });
  });

  it("builds the URL from ABLETON_MCP_PORT + token", () => {
    const c = resolveConnection({ ABLETON_MCP_PORT: "20999", ABLETON_MCP_TOKEN: "t" }, () => undefined);
    expect(c).toEqual({ url: "http://127.0.0.1:20999/mcp", token: "t" });
  });

  it("falls back to the connection file when env is absent", () => {
    const c = resolveConnection({}, () => ({ url: "http://127.0.0.1:20808/mcp", token: "f" }));
    expect(c).toEqual({ url: "http://127.0.0.1:20808/mcp", token: "f" });
  });

  it("ignores a lone URL without a token", () => {
    const c = resolveConnection(
      { ABLETON_MCP_URL: "http://x/mcp" },
      () => ({ url: "http://file/mcp", token: "f" }),
    );
    expect(c.url).toBe("http://file/mcp");
  });

  it("throws a recovery-hint error when nothing resolves", () => {
    expect(() => resolveConnection({}, () => undefined)).toThrow(/Ableton MCP: Status/);
  });
});
