import type { ZodRawShape } from "zod";
import type { ClipEditor } from "../../domain/clip-editor.js";
import type { SetInspector } from "../../domain/set-inspector.js";
import type { SongService } from "../../domain/song-service.js";
import type { TrackService } from "../../domain/track-service.js";

export interface ToolDeps {
  inspector: SetInspector;
  tracks: TrackService;
  clips: ClipEditor;
  song: SongService;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler(args: Record<string, unknown>, deps: ToolDeps): Promise<unknown>;
}
