import { clipTools } from "./clips.js";
import { setTools } from "./set.js";
import { trackTools } from "./tracks.js";
import type { ToolDef } from "./types.js";

export const allTools: ToolDef[] = [...setTools, ...trackTools, ...clipTools];
