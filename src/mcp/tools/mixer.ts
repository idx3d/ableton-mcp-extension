import { z } from "zod";
import type { MixerUpdate } from "../../domain/mixer-service.js";
import type { ToolDef } from "./types.js";

export const mixerTools: ToolDef[] = [
  {
    name: "set_mixer",
    description:
      "Set volume, pan and/or send levels for one or more tracks in ONE undo step. " +
      "Values are Live-internal raw values: volume 0..1 (0.85 = 0 dB), pan -1..1, " +
      "sends 0..1 (returnIds from get_set). Everything is validated before anything " +
      "is applied — one bad entry means nothing changes.",
    inputSchema: {
      updates: z
        .array(
          z.object({
            trackId: z.string(),
            volume: z.number().min(0).max(1).optional(),
            pan: z.number().min(-1).max(1).optional(),
            sends: z
              .array(z.object({ returnId: z.string(), value: z.number().min(0).max(1) }))
              .optional(),
          }),
        )
        .min(1),
    },
    handler: async (args, deps) => {
      const updates = args.updates as MixerUpdate[];
      await deps.mixer.setMixer(updates);
      return { updated: updates.map((u) => u.trackId) };
    },
  },
];
