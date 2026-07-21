/**
 * In-Live self-test runner. Replays the union of the three component scenarios
 * (build-a-beat, edit-existing-set, sound-design) as imperative steps against
 * the REAL adapter behind `ToolDeps`, plus a set of contract checks that pin
 * FakeLive-vs-Live parity (CONFLICT / INVALID_INPUT / NOT_FOUND semantics and
 * the clip-color round-trip).
 *
 * SDK-free by construction: it drives the domain services through `ToolDeps`
 * and only touches `port` types, so it stays inside the CI typecheck (its unit
 * test imports it) while still exercising whatever `LivePort` is wired in —
 * FakeLive in tests, `SdkAdapter` in a running Live.
 *
 * Leaves the user's set as found: every track and scene it needs is created by
 * the test itself and removed again in a `finally` cleanup (track deletion
 * cascades its clips and devices); the tempo is captured up front and restored.
 * Because every write also runs through `transact`, Live's Undo can revert the
 * whole run as a fallback.
 */
import type { ToolDeps } from "../mcp/tools/types.js";
import { PortError, type PortErrorCode } from "../port/errors.js";
import type { Note } from "../port/types.js";

export interface SelfTestResult {
  passed: number;
  failed: number;
  failures: string[];
}

/** Notes lifted verbatim from the build-a-beat scenario; one carries extras. */
const DRUMS: Note[] = [
  [36, 0, 0.25, 110],
  [42, 0.5, 0.25, 70],
  [38, 1, 0.25, 100],
  [42, 1.5, 0.25, 70],
  [36, 2, 0.25, 110],
  [42, 2.5, 0.25, 70],
  [38, 3, 0.25, 100],
  [42, 3.5, 0.25, 70, { prob: 0.85 }],
];
const BASS: Note[] = [
  [36, 0, 1, 100],
  [36, 1.5, 0.5, 90],
  [43, 2, 1, 100],
  [41, 3, 1, 95],
];

const NAME_PREFIX = "MCP Self-Test";
/**
 * Placeholder sample path for the audio-clip contract check. FakeLive accepts
 * any non-empty path; a real Live install needs a file to exist here, so the
 * check degrades to a SKIP (not a failure) when the file is missing.
 */
const SELF_TEST_SAMPLE = "/tmp/ableton-mcp-selftest.wav";

function fmt(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return String(value);
  }
}

function errText(err: unknown): string {
  if (err instanceof PortError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function notesEqual(a: Note[], b: Note[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function approx(actual: number | undefined, expected: number): boolean {
  return actual !== undefined && Math.abs(actual - expected) < 1e-6;
}

export async function runSelfTest(
  deps: ToolDeps,
  report: (line: string) => void,
): Promise<SelfTestResult> {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  const pass = (label: string): void => {
    passed++;
    report(`PASS: ${label}`);
  };
  const fail = (label: string, expected: unknown, got: unknown): void => {
    failed++;
    const line = `FAIL: ${label} (expected ${fmt(expected)} got ${fmt(got)})`;
    failures.push(line);
    report(line);
  };
  const check = (label: string, ok: boolean, expected: unknown, got: unknown): void => {
    if (ok) pass(label);
    else fail(label, expected, got);
  };
  const expectError = async (
    label: string,
    code: PortErrorCode,
    fn: () => Promise<unknown>,
  ): Promise<void> => {
    try {
      await fn();
      fail(label, code, "no error thrown");
    } catch (err) {
      const actual = err instanceof PortError ? err.code : `non-PortError`;
      check(
        label,
        actual === code,
        code,
        err instanceof PortError ? err.code : errText(err),
      );
    }
  };

  const createdTrackIds: string[] = [];
  let createdSceneIds: string[] = [];

  const initial = await deps.inspector.getSet();
  const originalTempo = initial.tempo;
  const returns = initial.returnTracks;
  report(
    `Starting self-test (existing tracks: ${initial.tracks.length}, tempo: ${originalTempo}).`,
  );

  try {
    // --- build-a-beat: tracks, scenes, tempo, MIDI clips + note round-trip ---
    const created = await deps.tracks.createTracks([
      { type: "midi", name: `${NAME_PREFIX} Drums` },
      { type: "midi", name: `${NAME_PREFIX} Bass` },
      { type: "audio", name: `${NAME_PREFIX} Audio` },
      { type: "midi", name: `${NAME_PREFIX} Scratch` },
    ]);
    createdTrackIds.push(...created.map((t) => t.id));
    check("create 4 tracks", created.length === 4, 4, created.length);
    const [drums, bass, audio, scratch] = created;

    const scenes = await deps.tracks.createScenes(2);
    createdSceneIds.push(...scenes.map((s) => s.id));
    check("create 2 scenes", scenes.length === 2, 2, scenes.length);
    const [sceneA, sceneB] = scenes;

    await deps.song.updateSong({ tempo: 124 });
    const afterTempo = await deps.inspector.getSet();
    check("set tempo to 124", afterTempo.tempo === 124, 124, afterTempo.tempo);

    const drumClip = await deps.clips.createMidiClip({
      trackId: drums.id,
      sceneId: sceneA.id,
      lengthBeats: 4,
      notes: DRUMS,
      name: "Beat A",
    });
    const drumRead = await deps.inspector.getClip(drumClip.id);
    check(
      "drum clip notes round-trip exactly",
      notesEqual(drumRead.notes, DRUMS),
      DRUMS,
      drumRead.notes,
    );

    const bassClip = await deps.clips.createMidiClip({
      trackId: bass.id,
      sceneId: sceneA.id,
      lengthBeats: 4,
      notes: BASS,
      name: "Bassline",
    });
    const bassRead = await deps.inspector.getClip(bassClip.id);
    check(
      "bass clip notes round-trip exactly",
      notesEqual(bassRead.notes, BASS),
      BASS,
      bassRead.notes,
    );

    // --- contract: occupied slot -> CONFLICT ---
    await expectError("occupied slot -> CONFLICT", "CONFLICT", () =>
      deps.clips.createMidiClip({
        trackId: drums.id,
        sceneId: sceneA.id,
        lengthBeats: 4,
        notes: [],
      }),
    );

    // --- contract: MIDI clip on an audio track -> INVALID_INPUT ---
    await expectError("MIDI clip on audio track -> INVALID_INPUT", "INVALID_INPUT", () =>
      deps.clips.createMidiClip({
        trackId: audio.id,
        sceneId: sceneA.id,
        lengthBeats: 4,
        notes: [],
      }),
    );

    // --- edit-existing-set: filter thinning, rename+color, scene ops ---
    const thinned = await deps.clips.editClipNotes(drumClip.id, {
      select: { pitchMin: 42, pitchMax: 42, startBeat: 2 },
      remove: true,
    });
    check(
      "edit_clip_notes thins hats after beat 2 (8 -> 6)",
      thinned.noteCount === 6,
      6,
      thinned.noteCount,
    );

    await deps.clips.updateClip(drumClip.id, { name: "Beat A v2", color: "#FF5500" });
    const recolored = await deps.inspector.getClip(drumClip.id);
    check(
      "update_clip renames clip",
      recolored.name === "Beat A v2",
      "Beat A v2",
      recolored.name,
    );
    // Color round-trip: FakeLive stores the hex verbatim; the SdkAdapter packs
    // via colorFromHex/colorToHex (uppercase #RRGGBB), so compare uppercased.
    check(
      "update_clip color round-trips (#FF5500)",
      (recolored.color ?? "").toUpperCase() === "#FF5500",
      "#FF5500",
      recolored.color,
    );

    await deps.tracks.updateScene(sceneA.id, { name: "Verse" });
    const afterRename = await deps.inspector.getSet();
    const renamed = afterRename.scenes.find((s) => s.id === sceneA.id);
    check("scene rename -> 'Verse'", renamed?.name === "Verse", "Verse", renamed?.name);

    await deps.tracks.deleteScenes([sceneB.id]);
    createdSceneIds = createdSceneIds.filter((id) => id !== sceneB.id);
    const afterSceneDelete = await deps.inspector.getSet();
    const sceneBGone = !afterSceneDelete.scenes.some((s) => s.id === sceneB.id);
    check(
      "scene delete removes the second scene",
      sceneBGone,
      "absent",
      sceneBGone ? "absent" : "present",
    );

    // --- contract: stale track ID after delete -> NOT_FOUND ---
    await deps.tracks.deleteTracks([scratch.id]);
    createdTrackIds.splice(createdTrackIds.indexOf(scratch.id), 1);
    await expectError("stale track ID after delete -> NOT_FOUND", "NOT_FOUND", () =>
      deps.clips.createMidiClip({
        trackId: scratch.id,
        sceneId: sceneA.id,
        lengthBeats: 4,
        notes: [],
      }),
    );

    // --- sound-design: insert Reverb, set params, batch mixer ---
    const reverb = await deps.devices.insertDevice(drums.id, "Reverb");
    check("insert Reverb on drums", reverb.name === "Reverb", "Reverb", reverb.name);

    const tuned = await deps.devices.setParams(reverb.id, {
      "Dry/Wet": 0.3,
      "Decay Time": 0.8,
    });
    const dryWet = tuned.params.find((p) => p.name === "Dry/Wet")?.value;
    const decay = tuned.params.find((p) => p.name === "Decay Time")?.value;
    check("Reverb Dry/Wet set to 0.3", approx(dryWet, 0.3), 0.3, dryWet);
    check("Reverb Decay Time set to 0.8", approx(decay, 0.8), 0.8, decay);

    const drumsUpdate = {
      trackId: drums.id,
      volume: 0.7,
      pan: -0.15,
      ...(returns.length > 0
        ? { sends: [{ returnId: returns[0].id, value: 0.25 }] }
        : {}),
    };
    await deps.mixer.setMixer([drumsUpdate, { trackId: bass.id, volume: 0.9 }]);
    const drumsTrack = await deps.inspector.getTrack(drums.id);
    check(
      "batch set_mixer volume -> 0.7",
      approx(drumsTrack.mixer.volume, 0.7),
      0.7,
      drumsTrack.mixer.volume,
    );
    check(
      "batch set_mixer pan -> -0.15",
      approx(drumsTrack.mixer.pan, -0.15),
      -0.15,
      drumsTrack.mixer.pan,
    );
    if (returns.length > 0) {
      const send = drumsTrack.mixer.sends.find(
        (s) => s.returnId === returns[0].id,
      )?.value;
      check(
        `batch set_mixer send ${returns[0].id} -> 0.25`,
        approx(send, 0.25),
        0.25,
        send,
      );
    } else {
      report("SKIP: mixer send check — the set has no return tracks.");
    }

    // --- contract: audio-clip note edit -> INVALID_INPUT ---
    // Needs a real sample on disk in Live; degrades to SKIP if unavailable.
    let audioClipId: string | undefined;
    try {
      const audioClip = await deps.clips.createAudioClip({
        trackId: audio.id,
        sceneId: sceneA.id,
        filePath: SELF_TEST_SAMPLE,
        name: "Self-Test Audio",
      });
      audioClipId = audioClip.id;
    } catch (err) {
      report(
        `SKIP: audio-clip note-edit check — could not create an audio clip (${errText(err)}). Provide a sample at ${SELF_TEST_SAMPLE} to enable it.`,
      );
    }
    if (audioClipId !== undefined) {
      const id = audioClipId;
      await expectError("audio-clip note edit -> INVALID_INPUT", "INVALID_INPUT", () =>
        deps.clips.editClipNotes(id, { remove: true }),
      );
    }
  } finally {
    // Restore the set to how we found it: tempo first, then delete everything
    // we created (track deletion cascades its clips and devices).
    report("Cleaning up self-test tracks and scenes…");
    try {
      await deps.song.updateSong({ tempo: originalTempo });
    } catch (err) {
      report(`WARN: failed to restore tempo (${errText(err)}).`);
    }
    try {
      const set = await deps.inspector.getSet();
      const liveTrackIds = new Set(set.tracks.map((t) => t.id));
      const liveSceneIds = new Set(set.scenes.map((s) => s.id));
      const tracksToDelete = createdTrackIds.filter((id) => liveTrackIds.has(id));
      const scenesToDelete = createdSceneIds.filter((id) => liveSceneIds.has(id));
      if (scenesToDelete.length > 0) await deps.tracks.deleteScenes(scenesToDelete);
      if (tracksToDelete.length > 0) await deps.tracks.deleteTracks(tracksToDelete);
      report(
        `Cleanup complete: removed ${tracksToDelete.length} track(s), ${scenesToDelete.length} scene(s).`,
      );
    } catch (err) {
      report(
        `WARN: cleanup incomplete (${errText(err)}). Use Live's Undo to revert the self-test changes.`,
      );
    }
  }

  report(`Self-test finished: ${passed} passed, ${failed} failed.`);
  return { passed, failed, failures };
}
