/**
 * Extension entry point (manifest `entry` → dist/extension.js). The composition
 * root: it is one of the few files allowed to import the SDK, and it wires the
 * SdkAdapter → domain services → MCP server → HTTP transport, then registers a
 * status command + context-menu action.
 *
 * Excluded from the CI typecheck (tsconfig.json); verified by
 * `npm run typecheck:sdk` after `npm run setup:sdk`.
 */
import {
  initialize,
  type ActivationContext,
  type ExtensionContext,
} from "@ableton-extensions/sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SdkAdapter } from "./adapters/sdk-1.0/sdk-adapter.js";
import { ClipEditor } from "./domain/clip-editor.js";
import { DeviceService } from "./domain/device-service.js";
import { MixerService } from "./domain/mixer-service.js";
import { SetInspector } from "./domain/set-inspector.js";
import { SongService } from "./domain/song-service.js";
import { TrackService } from "./domain/track-service.js";
import { startHttpServer } from "./mcp/http.js";
import { createMcpServer } from "./mcp/server.js";
import type { ToolDeps } from "./mcp/tools/types.js";
import { runSelfTest, type SelfTestResult } from "./shell/self-test.js";
import { AuditLog } from "./shell/audit-log.js";
import { loadOrCreateConfig } from "./shell/config.js";
import { writeConnectionFile } from "./shell/connection-file.js";
import { LogBuffer } from "./shell/log-buffer.js";
import {
  buildLogsDialogUrl,
  buildSelfTestResultUrl,
  buildStatusDialogUrl,
} from "./shell/status-dialog.js";

const COMMAND_ID = "ableton-mcp.show-status";
const CONTEXT_MENU_TITLE = "Ableton MCP: Status…";
const DIALOG_WIDTH = 560;
const DIALOG_HEIGHT = 560;

/**
 * Entry point invoked by the Extension Host. The whole body is guarded: any
 * failure is logged (reaching ExtensionHost.txt) rather than rethrown, so a
 * broken activation never spins Live into a crash loop.
 */
export async function activate(activation: ActivationContext): Promise<void> {
  try {
    // Install console capture first so the Logs screen sees every event from
    // here on (server start, errors, …). It still forwards to ExtensionHost.txt.
    const logs = new LogBuffer();
    logs.install();

    const context = initialize(activation, "1.0.0");

    // storageDirectory may be undefined (docs/sdk-notes.md §11); prefer it,
    // then tempDirectory, then a fixed OS-temp path so config/audit always
    // have somewhere to live.
    const env = context.environment;
    const storageDir =
      env.storageDirectory ?? env.tempDirectory ?? join(tmpdir(), "ableton-mcp");
    if (env.storageDirectory === undefined) {
      console.error(
        `[ableton-mcp] storageDirectory unavailable; using fallback ${storageDir}`,
      );
    }

    const config = loadOrCreateConfig(storageDir);
    const audit = new AuditLog(storageDir);

    const adapter = new SdkAdapter(context);
    const deps: ToolDeps = {
      inspector: new SetInspector(adapter),
      tracks: new TrackService(adapter),
      clips: new ClipEditor(adapter),
      song: new SongService(adapter),
      devices: new DeviceService(adapter),
      mixer: new MixerService(adapter),
    };

    const server = await startHttpServer({
      port: config.port,
      token: config.token,
      createServer: () =>
        createMcpServer(deps, {
          onToolResult: (report) => {
            audit.record(report);
            logs.push(
              "tool",
              `${report.tool} ${report.ok ? "ok" : (report.code ?? "error")} ${Math.round(report.durationMs)}ms`,
            );
          },
        }),
    });

    console.log(`[ableton-mcp] MCP server running at ${server.url}`);

    // Publish the effective URL + token to a fixed, externally-locatable path so
    // the `ableton-mcp` stdio bridge can auto-discover them. Best-effort: a write
    // failure must never crash activation.
    try {
      writeConnectionFile({ url: server.url, token: config.token });
    } catch (err) {
      console.error("[ableton-mcp] failed to write connection file:", err);
    }

    context.commands.registerCommand(COMMAND_ID, () => {
      // Commands are synchronous/void; run the async dialog flow detached and
      // swallow its errors so the host never sees a rejected promise. Each screen
      // is its own modal that resolves with an action string; this loop routes
      // between them until the user closes.
      void (async () => {
        try {
          let screen: "status" | "logs" = "status";
          for (;;) {
            if (screen === "logs") {
              const action = await context.ui.showModalDialog(
                buildLogsDialogUrl(logs.recent(200)),
                DIALOG_WIDTH,
                DIALOG_HEIGHT,
              );
              if (action === "refresh") continue;
              if (action === "back") {
                screen = "status";
                continue;
              }
              break; // "close"
            }

            const action = await context.ui.showModalDialog(
              buildStatusDialogUrl({
                url: server.url,
                token: config.token,
                entries: audit.recent(10),
              }),
              DIALOG_WIDTH,
              DIALOG_HEIGHT,
            );
            if (action === "selftest") {
              await runSelfTestFlow(context, deps, storageDir);
              continue; // back to the status screen
            }
            if (action === "logs") {
              screen = "logs";
              continue;
            }
            break; // "close"
          }
        } catch (err) {
          console.error("[ableton-mcp] status dialog error:", err);
        }
      })();
    });

    // "Scene" is broadly available in the Session view (docs/sdk-notes.md §10).
    // The unregister function it returns is not needed for the process lifetime.
    await context.ui.registerContextMenuAction("Scene", CONTEXT_MENU_TITLE, COMMAND_ID);
  } catch (err) {
    console.error("[ableton-mcp] activation failed:", err);
  }
}

/**
 * Runs the in-Live self-test inside a progress dialog, streaming each result
 * line to the dialog as it happens, writing the full transcript to
 * `<storageDir>/logs/selftest-<timestamp>.log`, and showing a pass/fail
 * summary modal at the end.
 */
async function runSelfTestFlow(
  context: ExtensionContext<"1.0.0">,
  deps: ToolDeps,
  storageDir: string,
): Promise<void> {
  const transcript: string[] = [];

  const result = (await context.ui.withinProgressDialog(
    "Running Ableton MCP self-test…",
    { progress: 0 },
    async (update) =>
      runSelfTest(deps, (line) => {
        transcript.push(line);
        // Also stream to the Extension Host log as each line happens: the
        // transcript below is only written once the run finishes, so a hard
        // Live crash mid-run would otherwise lose every line — including the
        // STEP marker naming the call that killed it.
        console.log(`[ableton-mcp] selftest: ${line}`);
        // Fire-and-forget: report() is synchronous, so stream without awaiting.
        void update(line);
      }),
  )) as SelfTestResult;

  try {
    const logDir = join(storageDir, "logs");
    mkdirSync(logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(logDir, `selftest-${stamp}.log`);
    const header = `Ableton MCP self-test — ${result.passed} passed, ${result.failed} failed`;
    writeFileSync(logPath, `${header}\n\n${transcript.join("\n")}\n`, "utf8");
    console.log(`[ableton-mcp] self-test log written to ${logPath}`);
  } catch (err) {
    console.error("[ableton-mcp] failed to write self-test log:", err);
  }

  await context.ui.showModalDialog(
    buildSelfTestResultUrl(result),
    DIALOG_WIDTH,
    DIALOG_HEIGHT,
  );
}
