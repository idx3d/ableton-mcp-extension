import { z } from "zod";

export const noteExtrasSchema = z
  .object({
    prob: z.number().min(0).max(1).optional(),
    velDev: z.number().optional(),
    muted: z.boolean().optional(),
    relVel: z.number().int().min(0).max(127).optional(),
  })
  .strict();

/** [pitch, startBeat, durBeats, velocity] or [..., extras] — ADR 0004. */
export const noteSchema = z.union([
  z.tuple([z.number(), z.number(), z.number(), z.number()]),
  z.tuple([z.number(), z.number(), z.number(), z.number(), noteExtrasSchema]),
]);

export const NOTE_FORMAT_DOC =
  "Each note is a tuple [pitch 0-127, startBeat, durationBeats, velocity 1-127] " +
  "with an optional 5th element {prob?, velDev?, muted?, relVel?} for non-default extras.";
