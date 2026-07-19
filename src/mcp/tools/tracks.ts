import { z } from "zod";
import type { TrackSpec } from "../../port/types.js";
import type { ToolDef } from "./types.js";

export const trackTools: ToolDef[] = [
  {
    name: "create_tracks",
    description:
      "Create one or more tracks in a single undo step. Each spec: " +
      '{type: "midi" | "audio", name?}. Returns the created track summaries with IDs.',
    inputSchema: {
      tracks: z
        .array(
          z.object({
            type: z.enum(["midi", "audio"]),
            name: z.string().optional(),
          }),
        )
        .min(1),
    },
    handler: async (args, deps) => ({
      tracks: await deps.tracks.createTracks(args.tracks as TrackSpec[]),
    }),
  },
  {
    name: "update_track",
    description: "Rename, mute, solo or arm a track. Returns the updated summary.",
    inputSchema: {
      trackId: z.string(),
      name: z.string().optional(),
      muted: z.boolean().optional(),
      soloed: z.boolean().optional(),
      armed: z.boolean().optional(),
    },
    handler: async (args, deps) => ({
      track: await deps.tracks.updateTrack(args.trackId as string, {
        name: args.name as string | undefined,
        muted: args.muted as boolean | undefined,
        soloed: args.soloed as boolean | undefined,
        armed: args.armed as boolean | undefined,
      }),
    }),
  },
  {
    name: "delete_tracks",
    description:
      "Delete tracks by ID in one undo step. All IDs are validated first: " +
      "if any is stale the call fails and nothing is deleted.",
    inputSchema: { trackIds: z.array(z.string()).min(1) },
    handler: async (args, deps) => {
      await deps.tracks.deleteTracks(args.trackIds as string[]);
      return { deleted: args.trackIds };
    },
  },
  {
    name: "create_scenes",
    description: "Append N scenes (1-64) to the set. Returns the created scenes with IDs.",
    inputSchema: { count: z.number().int().min(1).max(64) },
    handler: async (args, deps) => ({
      scenes: await deps.tracks.createScenes(args.count as number),
    }),
  },
];
