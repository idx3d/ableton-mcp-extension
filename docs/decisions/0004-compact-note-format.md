# ADR 0004: Compact tuple format for MIDI notes

**Date:** 2026-07-19 · **Status:** Accepted

## Context

Token economy is P0. The SDK's `NoteDescription` is a verbose object
(`{pitch, startTime, duration, velocity, muted, probability, velocityDeviation,
releaseVelocity, selected}`). A 500-note clip serialized as objects wastes thousands
of tokens on repeated keys and default values.

## Decision

Across MCP tools, notes are `[pitch, startBeat, durBeats, velocity]` tuples. Optional
per-note extras (probability, velocityDeviation, muted, releaseVelocity) appear only
when non-default, as a fifth object element: `[60, 0, 0.5, 100, {"prob": 0.8}]`.
Times are in beats. Roughly 4× smaller than the object form for typical clips.

The port DTO uses the same compact shape; the adapter converts to/from
`NoteDescription` at the SDK boundary.

## Consequences

- `get_clip`, `create_midi_clip`, `replace_clip_notes`, `edit_clip_notes` all share
  one note codec (single implementation + unit tests).
- Tool descriptions must document the tuple order clearly — models handle positional
  formats well when documented, poorly when ambiguous.
