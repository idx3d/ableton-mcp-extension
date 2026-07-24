/**
 * Builds the self-contained HTML pages shown by `ui.showModalDialog`, each
 * returned as a `data:` URL (a scheme showModalDialog explicitly supports).
 * Screens: the status page (server URL, masked token, per-client connect
 * snippets, recent activity), the logs monitor, and the self-test result. Every
 * button posts `{ method: "close_and_send", params: [action] }` to the host so
 * the returned promise resolves with the action string (docs/sdk-notes.md §10
 * webview messaging); the composition root routes between screens on it.
 *
 * Pure and SDK-free: takes plain runtime data, returns a string.
 */
import type { AuditEntry } from "./audit-log.js";
import type { LogLine } from "./log-buffer.js";

export interface StatusDialogData {
  /** Full MCP endpoint, e.g. http://127.0.0.1:20808/mcp */
  url: string;
  /** Bearer token — shown masked, embedded in full in the connect snippets. */
  token: string;
  /** Recent audit entries, newest first (typically audit.recent(10)). */
  entries: AuditEntry[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function maskToken(token: string): string {
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

function shortTime(iso: string): string {
  return escapeHtml(iso.replace("T", " ").replace(/\.\d+Z$/, "Z"));
}

/** The webview→host bridge, identical on every screen. */
const SEND_SCRIPT = `<script>
  function send(action) {
    var msg = { method: "close_and_send", params: [action] };
    try {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
        window.webkit.messageHandlers.live.postMessage(msg); // macOS
      } else if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(msg); // Windows
      }
    } catch (err) {
      console.error("postMessage failed", err);
    }
  }
</script>`;

const BASE_STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    font: 13px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
    margin: 0; padding: 20px; color: #e6e6e6; background: #1f1f1f;
  }
  h1 { font-size: 15px; margin: 0 0 4px; }
  .sub { color: #9a9a9a; margin: 0 0 16px; }
  .field { margin-bottom: 14px; }
  .label { color: #9a9a9a; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; margin-bottom: 4px; }
  code, .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .url { font-size: 13px; word-break: break-all; }
  .cmd {
    display: block; background: #111; border: 1px solid #333; border-radius: 6px;
    padding: 10px; white-space: pre-wrap; word-break: break-all; font-size: 12px;
  }
  .actions { display: flex; gap: 10px; margin-top: 20px; }
  button {
    font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #444;
    background: #2c2c2c; color: #e6e6e6; cursor: pointer;
  }
  button.primary { background: #3b6fd4; border-color: #3b6fd4; color: #fff; }
  button:hover { filter: brightness(1.1); }`;

function page(title: string, extraStyle: string, body: string): string {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${BASE_STYLE}${extraStyle}</style>
</head>
<body>
${body}
${SEND_SCRIPT}
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function renderRows(entries: AuditEntry[]): string {
  if (entries.length === 0) {
    return `<tr><td colspan="4" class="empty">No tool calls yet.</td></tr>`;
  }
  return entries
    .map((e) => {
      const status = e.ok ? "ok" : escapeHtml(e.code ?? "error");
      const cls = e.ok ? "ok" : "err";
      return `<tr>
        <td>${shortTime(e.at)}</td>
        <td>${escapeHtml(e.tool)}</td>
        <td class="${cls}">${status}</td>
        <td class="num">${Math.round(e.durationMs)} ms</td>
      </tr>`;
    })
    .join("");
}

export function buildStatusDialogUrl(data: StatusDialogData): string {
  const claudeCmd = `claude mcp add --transport http ableton ${data.url} --header "Authorization: Bearer ${data.token}"`;
  const codexConfig = `# ~/.codex/config.toml
[mcp_servers.ableton]
url = "${data.url}"
bearer_token_env_var = "ABLETON_MCP_TOKEN"

# then export the token in your shell:
export ABLETON_MCP_TOKEN=${data.token}`;

  const style = `
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #2c2c2c; font-size: 12px; }
  th { color: #9a9a9a; font-weight: 600; }
  td.num, th.num { text-align: right; }
  td.ok { color: #57c974; }
  td.err { color: #e2725b; }
  td.empty { color: #777; text-align: center; padding: 12px; }`;

  const body = `  <h1>Ableton MCP</h1>
  <p class="sub">Local MCP server for AI coding agents (MCP).</p>

  <div class="field">
    <div class="label">Server</div>
    <div class="url mono">${escapeHtml(data.url)}</div>
  </div>

  <div class="field">
    <div class="label">Token (masked)</div>
    <div class="mono">${escapeHtml(maskToken(data.token))}</div>
  </div>

  <div class="field">
    <div class="label">Connect — Claude Code</div>
    <code class="cmd">${escapeHtml(claudeCmd)}</code>
  </div>

  <div class="field">
    <div class="label">Connect — Codex</div>
    <code class="cmd">${escapeHtml(codexConfig)}</code>
  </div>

  <div class="field">
    <div class="label">Recent activity</div>
    <table>
      <thead><tr><th>Time</th><th>Tool</th><th>Result</th><th class="num">Duration</th></tr></thead>
      <tbody>${renderRows(data.entries)}</tbody>
    </table>
  </div>

  <div class="actions">
    <button class="primary" onclick="send('close')">Close</button>
    <button onclick="send('selftest')">Run self-test</button>
    <button onclick="send('logs')">Logs</button>
  </div>`;

  return page("Ableton MCP", style, body);
}

function renderLogLines(lines: LogLine[]): string {
  if (lines.length === 0) {
    return `<div class="empty">No log entries yet.</div>`;
  }
  return lines
    .map(
      (l) =>
        `<div class="logline lvl-${l.level}"><span class="ts">${shortTime(l.at)}</span> <span class="lvl">${escapeHtml(l.level)}</span> <span class="msg">${escapeHtml(l.message)}</span></div>`,
    )
    .join("");
}

/**
 * The Logs monitor: a snapshot of the recent event stream (server events,
 * errors, and tool-call summaries), newest first, with Back / Refresh / Close.
 * Pure and SDK-free.
 */
export function buildLogsDialogUrl(lines: LogLine[]): string {
  const style = `
  .logs {
    background: #111; border: 1px solid #333; border-radius: 6px;
    padding: 8px; max-height: 60vh; overflow-y: auto;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px;
  }
  .logline { padding: 2px 0; border-bottom: 1px solid #1c1c1c; white-space: pre-wrap; word-break: break-word; }
  .logline .ts { color: #7a7a7a; }
  .logline .lvl { text-transform: uppercase; font-size: 10px; }
  .lvl-info .lvl { color: #9a9a9a; }
  .lvl-error .lvl, .lvl-error .msg { color: #e2725b; }
  .lvl-tool .lvl { color: #57a6ff; }
  .empty { color: #777; text-align: center; padding: 16px; }`;

  const body = `  <h1>Ableton MCP — Logs</h1>
  <p class="sub">Server events, errors, and tool calls (most recent first).</p>
  <div class="logs">${renderLogLines(lines)}</div>
  <div class="actions">
    <button class="primary" onclick="send('back')">Back</button>
    <button onclick="send('refresh')">Refresh</button>
    <button onclick="send('close')">Close</button>
  </div>`;

  return page("Ableton MCP — Logs", style, body);
}

export interface SelfTestSummary {
  passed: number;
  failed: number;
  failures: string[];
}

/**
 * Builds the modal shown after the self-test finishes: a pass/fail headline,
 * the counts, and the list of failure lines (if any). Same `data:` URL / Close
 * button contract as the status dialog above. Pure and SDK-free.
 */
export function buildSelfTestResultUrl(summary: SelfTestSummary): string {
  const ok = summary.failed === 0;
  const headline = ok ? "All checks passed" : "Self-test found failures";
  const failuresHtml =
    summary.failures.length === 0
      ? ""
      : `<div class="field">
    <div class="label">Failures</div>
    <ul class="fails">${summary.failures
      .map((f) => `<li>${escapeHtml(f)}</li>`)
      .join("")}</ul>
  </div>`;

  const style = `
  h1.ok { color: #57c974; }
  h1.err { color: #e2725b; }
  .fails { margin: 0; padding-left: 18px; }
  .fails li { color: #e2725b; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; margin-bottom: 4px; }`;

  const body = `  <h1 class="${ok ? "ok" : "err"}">${escapeHtml(headline)}</h1>
  <p class="sub">${summary.passed} passed · ${summary.failed} failed</p>
  ${failuresHtml}
  <div class="actions">
    <button class="primary" onclick="send('close')">Close</button>
  </div>`;

  return page("Ableton MCP — Self-test", style, body);
}
