import { z } from "zod";
import type { ToolDef } from "./types.js";

export const setTools: ToolDef[] = [
  {
    name: "get_set",
    description:
      "Compact overview of the open Live set: tempo, scale, tracks (one line each: " +
      "id, name, type, devices, clip count) and scenes. Call this first to obtain IDs; " +
      "drill down with get_track / get_clip.",
    inputSchema: {},
    handler: async (_args, deps) => ({ set: deps.inspector.getSet() }),
  },
  {
    name: "get_track",
    description:
      "One track in depth: its clip slots per scene (with clip summaries) and device chain. " +
      "Use the trackId from get_set.",
    inputSchema: { trackId: z.string() },
    handler: async (args, deps) => ({
      track: deps.inspector.getTrack(args.trackId as string),
    }),
  },
  {
    name: "get_clip",
    description:
      "Full detail of one clip, including its MIDI notes as compact tuples " +
      "[pitch, startBeat, durationBeats, velocity, extras?].",
    inputSchema: { clipId: z.string() },
    handler: async (args, deps) => ({
      clip: deps.inspector.getClip(args.clipId as string),
    }),
  },
  {
    name: "update_song",
    description: "Update song-level settings. Currently: tempo (20-999 BPM).",
    inputSchema: { tempo: z.number().optional() },
    handler: async (args, deps) => {
      await deps.song.updateSong({ tempo: args.tempo as number | undefined });
      return { song: { tempo: (args.tempo as number | undefined) ?? null } };
    },
  },
];
