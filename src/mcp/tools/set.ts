import { z } from "zod";
import type { SongPatch } from "../../port/types.js";
import type { ToolDef } from "./types.js";

export const setTools: ToolDef[] = [
  {
    name: "get_set",
    description:
      "Compact overview of the open Live set: tempo, scale, tracks (one line each: " +
      "id, name, type, devices, clip count) and scenes. Call this first to obtain IDs; " +
      "drill down with get_track / get_clip. Includes arrangement cue points (cues) when present.",
    inputSchema: {},
    handler: async (_args, deps) => ({ set: await deps.inspector.getSet() }),
  },
  {
    name: "get_track",
    description:
      "One track in depth: its clip slots per scene (with clip summaries) and device chain. " +
      "Use the trackId from get_set.",
    inputSchema: { trackId: z.string() },
    handler: async (args, deps) => ({
      track: await deps.inspector.getTrack(args.trackId as string),
    }),
  },
  {
    name: "get_clip",
    description:
      "Full detail of one clip, including its MIDI notes as compact tuples " +
      "[pitch, startBeat, durationBeats, velocity, extras?].",
    inputSchema: { clipId: z.string() },
    handler: async (args, deps) => ({
      clip: await deps.inspector.getClip(args.clipId as string),
    }),
  },
  {
    name: "update_song",
    description:
      "Update song-level settings in one undo step: tempo (20-999 BPM) and " +
      "arrangement cue points. addCues creates locators at beat positions; " +
      "renameCues / deleteCueIds edit existing ones by ID (batch, all-or-nothing). " +
      "Cue time is fixed at creation — the Ableton API cannot move a cue; delete " +
      "and re-add instead. Returns minted IDs for added cues.",
    inputSchema: {
      tempo: z.number().optional(),
      addCues: z
        .array(z.object({ timeBeats: z.number().min(0), name: z.string().optional() }))
        .min(1)
        .optional(),
      renameCues: z
        .array(z.object({ id: z.string(), name: z.string().min(1) }))
        .min(1)
        .optional(),
      deleteCueIds: z.array(z.string()).min(1).optional(),
    },
    handler: async (args, deps) => {
      const patch = {
        ...(args.tempo !== undefined ? { tempo: args.tempo as number } : {}),
        ...(args.addCues !== undefined
          ? { addCues: args.addCues as SongPatch["addCues"] }
          : {}),
        ...(args.renameCues !== undefined
          ? { renameCues: args.renameCues as SongPatch["renameCues"] }
          : {}),
        ...(args.deleteCueIds !== undefined
          ? { deleteCueIds: args.deleteCueIds as string[] }
          : {}),
      } satisfies SongPatch;
      const result = await deps.song.updateSong(patch);
      return {
        song: { tempo: (args.tempo as number | undefined) ?? null },
        ...(result.addedCues.length > 0 ? { addedCues: result.addedCues } : {}),
        ...(patch.renameCues ? { renamedCueIds: patch.renameCues.map((r) => r.id) } : {}),
        ...(patch.deleteCueIds ? { deletedCueIds: patch.deleteCueIds } : {}),
      };
    },
  },
];
