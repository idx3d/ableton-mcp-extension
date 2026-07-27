import { z } from "zod";
import type { TrackSpec } from "../../port/types.js";
import type { ToolDef } from "./types.js";

export const trackTools: ToolDef[] = [
  {
    name: "create_tracks",
    description:
      "Create and/or duplicate tracks in a single undo step. Each spec needs " +
      'EXACTLY ONE of type or duplicateOf: {type: "midi" | "audio", name?} (new ' +
      "empty track) OR {duplicateOf: trackId, name?} (full copy — clips, devices, " +
      "mixer — inserted right after the source). Because each copy lands right " +
      "after the SOURCE, N duplicates of the same track end up in reverse order " +
      "(the last one created sits closest to the source), matching Live. Returns " +
      "the created track summaries with IDs.",
    inputSchema: {
      // Deliberately a single loose object rather than a union: an "exactly one
      // of" union turns the most likely input mistake into an unstructured zod
      // protocol error, so the rule is enforced in TrackService.createTracks
      // instead and surfaces as a coded {ok:false, code, hint} result.
      tracks: z
        .array(
          z.object({
            type: z.enum(["midi", "audio"]).optional(),
            name: z.string().optional(),
            duplicateOf: z.string().optional(),
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
    description:
      "Append N empty scenes (count 1-64), or duplicate an existing scene and its " +
      "clips (duplicateOf, inserted right after the source; count copies N times). " +
      "Each copy lands right after the SOURCE, so count > 1 yields the copies in " +
      "reverse order (the last one created sits closest to the source), matching " +
      "Live. Returns the created scenes with IDs.",
    inputSchema: {
      count: z.number().int().min(1).max(64).optional(),
      duplicateOf: z.string().optional(),
    },
    handler: async (args, deps) => ({
      scenes: await deps.tracks.createScenes(
        args.count as number | undefined,
        args.duplicateOf as string | undefined,
      ),
    }),
  },
  {
    name: "update_scene",
    description: "Rename a scene, in one undo step.",
    inputSchema: { sceneId: z.string(), name: z.string() },
    handler: async (args, deps) => ({
      scene: await deps.tracks.updateScene(args.sceneId as string, {
        name: args.name as string,
      }),
    }),
  },
  {
    name: "delete_scenes",
    description:
      "Delete scenes by ID in one undo step — this also deletes every session clip " +
      "in those scenes. All IDs are validated first (all-or-nothing).",
    inputSchema: { sceneIds: z.array(z.string()).min(1) },
    handler: async (args, deps) => {
      await deps.tracks.deleteScenes(args.sceneIds as string[]);
      return { deleted: args.sceneIds };
    },
  },
];
