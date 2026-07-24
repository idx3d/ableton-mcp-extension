import { describe, expect, it } from "vitest";
import {
  buildLogsDialogUrl,
  buildStatusDialogUrl,
} from "../../../src/shell/status-dialog.js";
import type { LogLine } from "../../../src/shell/log-buffer.js";

function decode(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  expect(dataUrl.slice(0, comma)).toContain("data:text/html");
  return decodeURIComponent(dataUrl.slice(comma + 1));
}

const URL_ = "http://127.0.0.1:20808/mcp";
const TOKEN = "419a3021-1a9a-4f1b-b9d7-85ed80c5617b";

describe("buildStatusDialogUrl", () => {
  const html = decode(buildStatusDialogUrl({ url: URL_, token: TOKEN, entries: [] }));

  it("uses client-agnostic wording, not 'for Claude Code'", () => {
    expect(html).toContain("AI coding agents");
    expect(html).not.toContain("Local MCP server for Claude Code");
  });

  it("shows the Claude Code CLI snippet with the full token", () => {
    expect(html).toContain(`claude mcp add --transport http ableton ${URL_}`);
    expect(html).toContain(`Authorization: Bearer ${TOKEN}`);
  });

  it("shows a Codex config.toml snippet with url + bearer_token_env_var", () => {
    expect(html).toContain("[mcp_servers.ableton]");
    expect(html).toContain(`url = &quot;${URL_}&quot;`);
    expect(html).toContain("bearer_token_env_var = &quot;ABLETON_MCP_TOKEN&quot;");
    // the env var needs the real token to be set somewhere the user can copy it
    expect(html).toContain(`ABLETON_MCP_TOKEN=${TOKEN}`);
  });

  it("masks the token in the Token field", () => {
    expect(html).toContain("419a3021…617b");
  });

  it("has Close, Run self-test, and Logs buttons", () => {
    expect(html).toContain("send('close')");
    expect(html).toContain("send('selftest')");
    expect(html).toContain("send('logs')");
  });
});

describe("buildLogsDialogUrl", () => {
  it("renders lines with level classes, newest as given", () => {
    const lines: LogLine[] = [
      { at: "2026-07-24T18:00:00.000Z", level: "error", message: "boom & <fail>" },
      { at: "2026-07-24T17:59:00.000Z", level: "info", message: "server running" },
      { at: "2026-07-24T17:58:00.000Z", level: "tool", message: "get_set ok 12ms" },
    ];
    const html = decode(buildLogsDialogUrl(lines));
    expect(html).toContain("server running");
    expect(html).toContain("get_set ok 12ms");
    // HTML-escaped, not raw
    expect(html).toContain("boom &amp; &lt;fail&gt;");
    expect(html).not.toContain("boom & <fail>");
    expect(html).toContain("lvl-error");
    expect(html).toContain("lvl-tool");
  });

  it("shows an empty state when there are no lines", () => {
    const html = decode(buildLogsDialogUrl([]));
    expect(html.toLowerCase()).toContain("no log");
  });

  it("has Back, Refresh, and Close buttons", () => {
    const html = decode(buildLogsDialogUrl([]));
    expect(html).toContain("send('back')");
    expect(html).toContain("send('refresh')");
    expect(html).toContain("send('close')");
  });
});
