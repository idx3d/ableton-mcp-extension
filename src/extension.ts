/**
 * Extension entry point (manifest `entry` → dist/extension.js). The composition
 * root: it is one of the few files allowed to import the SDK, and it wires the
 * SdkAdapter → domain services → MCP server → HTTP transport, then registers a
 * status command + context-menu action.
 *
 * Excluded from the CI typecheck (tsconfig.json); verified by
 * `npm run typecheck:sdk` after `npm run setup:sdk`.
 */
import { initialize, type ActivationContext } from "@ableton-extensions/sdk";
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
import { AuditLog } from "./shell/audit-log.js";
import { loadOrCreateConfig } from "./shell/config.js";
import { buildStatusDialogUrl } from "./shell/status-dialog.js";

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
        createMcpServer(deps, { onToolResult: (report) => audit.record(report) }),
    });

    console.log(`[ableton-mcp] MCP server running at ${server.url}`);

    context.commands.registerCommand(COMMAND_ID, () => {
      // Commands are synchronous/void; run the async dialog flow detached and
      // swallow its errors so the host never sees a rejected promise.
      void (async () => {
        try {
          const dialogUrl = buildStatusDialogUrl({
            url: server.url,
            token: config.token,
            entries: audit.recent(10),
          });
          const result = await context.ui.showModalDialog(
            dialogUrl,
            DIALOG_WIDTH,
            DIALOG_HEIGHT,
          );
          if (result === "selftest") {
            // TODO(Task 8): run the contract self-test suite against the
            // running server and report the outcome. No-op for now.
            console.log("[ableton-mcp] self-test requested (not yet implemented)");
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
