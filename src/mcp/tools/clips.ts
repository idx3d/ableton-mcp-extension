import { z } from "zod";
import type { Note } from "../../port/types.js";
import { NOTE_FORMAT_DOC, noteSchema } from "./schemas.js";
import type { ToolDef } from "./types.js";

export const clipTools: ToolDef[] = [
  {
    name: "create_midi_clip",
    description:
      "Create a MIDI clip in a session slot (trackId + sceneId) with notes inline, " +
      "in one undo step. " +
      NOTE_FORMAT_DOC,
    inputSchema: {
      trackId: z.string(),
      sceneId: z.string(),
      lengthBeats: z.number().positive(),
      notes: z.array(noteSchema),
      name: z.string().optional(),
    },
    handler: async (args, deps) => ({
      clip: await deps.clips.createMidiClip({
        trackId: args.trackId as string,
        sceneId: args.sceneId as string,
        lengthBeats: args.lengthBeats as number,
        notes: args.notes as Note[],
        name: args.name as string | undefined,
      }),
    }),
  },
  {
    name: "replace_clip_notes",
    description:
      "Replace ALL notes of a MIDI clip in one undo step. " +
      "For partial edits re-send the full note list (edit_clip_notes arrives in a later version). " +
      NOTE_FORMAT_DOC,
    inputSchema: {
      clipId: z.string(),
      notes: z.array(noteSchema),
    },
    handler: async (args, deps) => ({
      clip: await deps.clips.replaceClipNotes(
        args.clipId as string,
        args.notes as Note[],
      ),
    }),
  },
];
