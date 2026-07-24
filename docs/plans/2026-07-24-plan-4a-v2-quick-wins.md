# Plan 4a: v2 Quick Wins (cues, duplicate, warp, Simpler sample)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase A of the v2 surface (spec: `docs/specs/2026-07-24-v2-tool-surface-design.md` §3): arrangement cue points, duplicate-as-create-mode for tracks/scenes/devices, audio-clip warp control, and Simpler sample replacement — taking the tool surface from 21 to 22 tools (one new tool `set_simpler_sample`; the rest extend existing tools).

**Architecture:** Same ports-and-adapters layering as v1. `src/port/` gains cue/warp/duplicate DTO extensions and two new methods (`duplicateDevice`, `setSimplerSample`); FakeLive and the SDK adapter both implement everything; domain services validate; four tool files change. Vertical-slice tasks: each feature lands port→fake→service→tool→tests in one task, then one SDK-adapter task, then self-test contract checks, then docs.

**Tech Stack:** unchanged (TypeScript strict/ESM, vitest, zod v3, `@modelcontextprotocol/sdk`; SDK adapter against vendored `@ableton-extensions/sdk` 1.0.0-beta.0).

**Roadmap context:** First of three Phase PRs from the v2 spec. Plan 4b (take lanes + rack chains) and Plan 4c (import_file + render_audio) follow, each planned after the previous lands.

## Global Constraints

All v1 constraints remain binding:

- **SDK quarantine:** only `src/adapters/sdk-1.0/*` imports `@ableton-extensions/sdk` (enforced by `npm run lint`). `src/port/` has zero imports beyond its own files.
- **Data safety:** every write tool = one `transact(toolName, …)` undo step. Batch inputs (cue ops, mixed create/duplicate specs) resolve and validate ALL IDs before the first mutation — all-or-nothing.
- **Robustness:** tools never throw to the client; every failure is `{ok:false, code, message, hint?}` with code ∈ NOT_FOUND | INVALID_INPUT | UNSUPPORTED | CONFLICT | INTERNAL. FakeLive and SdkAdapter error codes/messages/hints must match verbatim (pinned by self-test contract checks).
- **Token economy:** write results return minimal deltas; `get_set` (with cues) must stay under the existing 8 KB budget test; new fields on `ClipDetail`/`DeviceDetail` only (never on summaries).
- **FakeLive divergences from real Live** (default cue names, duplicate name behavior) get a code comment and a self-test contract check — never silent.
- Every task ends with `npm test`, `npm run typecheck`, `npm run lint` green, then `npm run format`, then a commit.
- Work on branch `feature/v2-quick-wins` off `main`.

---

### Task 1: Cue points (port + FakeLive + SongService + update_song/get_set)

**Files:**

- Modify: `src/port/types.ts` (CueId/CueRef, widen SongPatch, `SetSnapshot.cues?`, new UpdateSongResult)
- Modify: `src/port/live-port.ts` (`updateSong` return type)
- Modify: `src/adapters/fake/fake-live.ts`
- Modify: `src/domain/song-service.ts`
- Modify: `src/mcp/tools/set.ts` (`update_song` schema/handler, `get_set` description)
- Test: `test/unit/adapters/fake-live-cues.test.ts` (new)
- Test: `test/unit/domain/song-service-cues.test.ts` (new)

**Interfaces:**

- Consumes: existing FakeLive internals (`counters`, `PortError`), `SongService`, tool plumbing.
- Produces (used by Tasks 5–8):
  - `CueId` (`"q1"`, …), `CueRef { id; name; timeBeats }`, `UpdateSongResult { addedCues: CueRef[] }`.
  - `SongPatch` gains `addCues?: Array<{timeBeats: number; name?: string}>`, `renameCues?: Array<{id: CueId; name: string}>`, `deleteCueIds?: CueId[]`.
  - `SetSnapshot.cues?: CueRef[]` — present only when the set has cue points, sorted by `timeBeats`.
  - `LivePort.updateSong(patch): Promise<UpdateSongResult>` (was `Promise<void>`).
  - `SongService.updateSong` validates: tempo 20–999, `timeBeats >= 0`, rename names non-empty; returns `UpdateSongResult`.

- [ ] **Step 1: Write the failing FakeLive tests**

`test/unit/adapters/fake-live-cues.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive cue points", () => {
  let fake: FakeLive;
  beforeEach(() => {
    fake = new FakeLive();
  });

  it("getSet omits cues when there are none", async () => {
    expect("cues" in (await fake.getSet())).toBe(false);
  });

  it("addCues mints q-IDs, defaults names, and keeps cues time-sorted", async () => {
    const { addedCues } = await fake.updateSong({
      addCues: [{ timeBeats: 16, name: "Drop" }, { timeBeats: 0 }],
    });
    expect(addedCues).toEqual([
      { id: "q1", name: "Drop", timeBeats: 16 },
      { id: "q2", name: "Cue 2", timeBeats: 0 },
    ]);
    expect((await fake.getSet()).cues).toEqual([
      { id: "q2", name: "Cue 2", timeBeats: 0 },
      { id: "q1", name: "Drop", timeBeats: 16 },
    ]);
  });

  it("renames and deletes by ID", async () => {
    await fake.updateSong({ addCues: [{ timeBeats: 0 }, { timeBeats: 8 }] });
    await fake.updateSong({
      renameCues: [{ id: "q1", name: "Intro" }],
      deleteCueIds: ["q2"],
    });
    expect((await fake.getSet()).cues).toEqual([
      { id: "q1", name: "Intro", timeBeats: 0 },
    ]);
  });

  it("validates all cue IDs before mutating (all-or-nothing)", async () => {
    await fake.updateSong({ addCues: [{ timeBeats: 0, name: "Keep" }] });
    await expect(
      fake.updateSong({
        renameCues: [{ id: "q1", name: "Changed" }],
        deleteCueIds: ["q99"],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fake.getSet()).cues).toEqual([
      { id: "q1", name: "Keep", timeBeats: 0 },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-cues.test.ts`
Expected: FAIL — compile errors (`addCues` not in `SongPatch`, `updateSong` returns void).

- [ ] **Step 3: Extend the port**

`src/port/types.ts` — append near the other ID types, and widen `SongPatch`/`SetSnapshot`:

```ts
export type CueId = string; // "q1", ... minted per session ("c" is taken by clips)

/** An arrangement cue point (locator). time is immutable in API 1.0.0. */
export interface CueRef {
  id: CueId;
  name: string;
  timeBeats: number;
}

export interface UpdateSongResult {
  /** Minted refs for cues created by addCues; empty when none were added. */
  addedCues: CueRef[];
}
```

Replace the existing `SongPatch` with:

```ts
export interface SongPatch {
  tempo?: number;
  addCues?: Array<{ timeBeats: number; name?: string }>;
  renameCues?: Array<{ id: CueId; name: string }>;
  deleteCueIds?: CueId[];
}
```

In `SetSnapshot`, after `returnTracks`:

```ts
  /** Present only when the set has cue points; sorted by timeBeats. */
  cues?: CueRef[];
```

`src/port/live-port.ts` — change the `updateSong` line and import `UpdateSongResult`:

```ts
  updateSong(patch: SongPatch): Promise<UpdateSongResult>;
```

- [ ] **Step 4: Implement in FakeLive**

`src/adapters/fake/fake-live.ts` — import `CueId`, `CueRef`, `UpdateSongResult`; add state:

```ts
interface FakeCue {
  id: CueId;
  name: string;
  timeBeats: number;
}
```

In the class: `private cues: FakeCue[] = [];` and extend `counters` to `{ track: 0, scene: 0, clip: 0, device: 0, cue: 0 }`.

In `getSet()`, after `returnTracks`:

```ts
      ...(this.cues.length > 0 ? { cues: this.cues.map((c) => ({ ...c })) } : {}),
```

Replace `updateSong` with:

```ts
  async updateSong(patch: SongPatch): Promise<UpdateSongResult> {
    // Validate every referenced cue before any mutation (all-or-nothing).
    const requireCue = (id: CueId): FakeCue => {
      const cue = this.cues.find((c) => c.id === id);
      if (!cue) throw PortError.notFound("cue point", id);
      return cue;
    };
    const renames = (patch.renameCues ?? []).map((r) => ({
      cue: requireCue(r.id),
      name: r.name,
    }));
    const deletes = patch.deleteCueIds ?? [];
    for (const id of deletes) requireCue(id);

    if (patch.tempo !== undefined) this.tempo = patch.tempo;
    for (const { cue, name } of renames) cue.name = name;
    if (deletes.length > 0) this.cues = this.cues.filter((c) => !deletes.includes(c.id));
    const addedCues: CueRef[] = (patch.addCues ?? []).map((add) => {
      const cue: FakeCue = {
        id: `q${++this.counters.cue}`,
        // Real Live derives a default locator name from the position; the
        // fake's placeholder is pinned by the self-test contract checks.
        name: add.name ?? `Cue ${this.counters.cue}`,
        timeBeats: add.timeBeats,
      };
      this.cues.push(cue);
      return { ...cue };
    });
    // Live presents cue points in time order (verify in-Live via self-test).
    this.cues.sort((a, b) => a.timeBeats - b.timeBeats);
    return { addedCues };
  }
```

- [ ] **Step 5: Run FakeLive tests to verify they pass**

Run: `npx vitest run test/unit/adapters/fake-live-cues.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing SongService tests**

`test/unit/domain/song-service-cues.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { SongService } from "../../../src/domain/song-service.js";

describe("SongService cue validation", () => {
  it("rejects negative timeBeats before touching the set", async () => {
    const fake = new FakeLive();
    const service = new SongService(fake);
    await expect(
      service.updateSong({ addCues: [{ timeBeats: -1 }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.undoSteps).toEqual([]);
  });

  it("rejects empty rename names", async () => {
    const service = new SongService(new FakeLive());
    await expect(
      service.updateSong({ renameCues: [{ id: "q1", name: "  " }] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("adds cues inside one update_song undo step and returns minted refs", async () => {
    const fake = new FakeLive();
    const service = new SongService(fake);
    const { addedCues } = await service.updateSong({
      tempo: 100,
      addCues: [{ timeBeats: 4, name: "Verse" }],
    });
    expect(addedCues).toEqual([{ id: "q1", name: "Verse", timeBeats: 4 }]);
    expect(fake.undoSteps).toEqual(["update_song"]);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run test/unit/domain/song-service-cues.test.ts`
Expected: FAIL — validation missing / return type mismatch.

- [ ] **Step 8: Implement SongService + tools**

`src/domain/song-service.ts` — replace `updateSong` (import `UpdateSongResult`):

```ts
  async updateSong(patch: SongPatch): Promise<UpdateSongResult> {
    if (patch.tempo !== undefined && (patch.tempo < 20 || patch.tempo > 999)) {
      throw new PortError("INVALID_INPUT", `tempo ${patch.tempo} must be 20-999 BPM`);
    }
    for (const add of patch.addCues ?? []) {
      if (add.timeBeats < 0) {
        throw new PortError(
          "INVALID_INPUT",
          `cue timeBeats ${add.timeBeats} must be >= 0`,
        );
      }
    }
    for (const rename of patch.renameCues ?? []) {
      if (rename.name.trim() === "") {
        throw new PortError("INVALID_INPUT", "cue name must not be empty");
      }
    }
    return this.live.transact("update_song", () => this.live.updateSong(patch));
  }
```

`src/mcp/tools/set.ts` — import `type { SongPatch }` from `../../port/types.js`; replace the `update_song` entry:

```ts
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
        ...(patch.renameCues
          ? { renamedCueIds: patch.renameCues.map((r) => r.id) }
          : {}),
        ...(patch.deleteCueIds ? { deletedCueIds: patch.deleteCueIds } : {}),
      };
    },
  },
```

In the `get_set` description, append: `" Includes arrangement cue points (cues) when present."`

- [ ] **Step 9: Run the full gate**

Run: `npx vitest run test/unit/domain/song-service-cues.test.ts` → PASS, then `npm test && npm run typecheck && npm run lint`
Expected: all green (`updateSong`'s new return type is ignored by existing callers — no other changes needed).

- [ ] **Step 10: Format and commit**

```bash
npm run format
git add -A
git commit -m "feat: arrangement cue points via update_song/get_set"
```

---

### Task 2: Duplicate as create-mode (tracks, scenes, devices)

**Files:**

- Modify: `src/port/types.ts` (`TrackSpec`), `src/port/live-port.ts` (`createScenes` signature, new `duplicateDevice`)
- Modify: `src/adapters/fake/fake-live.ts`
- Modify: `src/domain/track-service.ts`, `src/domain/device-service.ts`
- Modify: `src/mcp/tools/tracks.ts` (`create_tracks`, `create_scenes`), `src/mcp/tools/devices.ts` (`insert_device`)
- Test: `test/unit/adapters/fake-live-duplicate.test.ts` (new)
- Test: `test/unit/domain/duplicate-services.test.ts` (new)

**Interfaces:**

- Consumes: Task 1's file state (no direct dependency).
- Produces (used by Tasks 5–8):
  - `TrackSpec` becomes `{ type?: TrackType; name?: string; duplicateOf?: TrackId }` — exactly one of `type` | `duplicateOf` (validated in TrackService AND defensively in adapters).
  - `LivePort.createScenes(count: number, duplicateOf?: SceneId)`.
  - `LivePort.duplicateDevice(id: DeviceId): Promise<DeviceDetail>` — copy inserted directly after the original.
  - `TrackService.createScenes(count: number | undefined, duplicateOf?: SceneId)` — count defaults to 1 when duplicating.
  - `DeviceService.duplicateDevice(id: DeviceId): Promise<DeviceDetail>` (undo label `insert_device`).
  - Duplicates insert immediately after their source (tracks in `song.tracks` order, scenes in scene order, devices in chain order) and carry nested content with freshly minted IDs.

- [ ] **Step 1: Write the failing FakeLive tests**

`test/unit/adapters/fake-live-duplicate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive duplicate", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([
      { type: "midi", name: "Drums" },
      { type: "audio", name: "Vox" },
    ]);
    await fake.createScenes(2);
    await fake.createMidiClip("t1", "s1", 4, [[60, 0, 1, 100]], "Beat");
    await fake.insertDevice("t1", "Reverb");
  });

  it("duplicates a track with clips and devices, inserted after the source", async () => {
    const [copy] = await fake.createTracks([{ duplicateOf: "t1" }]);
    expect(copy.id).toBe("t3");
    expect(copy.name).toBe("Drums");
    expect(copy.deviceNames).toEqual(["Reverb"]);
    expect(copy.clipCount).toBe(1);
    expect((await fake.getSet()).tracks.map((t) => t.id)).toEqual(["t1", "t3", "t2"]);
    // Cloned clip has a fresh ID and the same notes.
    const slot = (await fake.getTrack("t3")).slots.find((s) => s.clip !== null);
    expect(slot?.clip?.id).not.toBe((await fake.getTrack("t1")).slots[0].clip?.id);
  });

  it("validates every duplicateOf before creating anything", async () => {
    await expect(
      fake.createTracks([{ type: "midi" }, { duplicateOf: "t99" }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fake.getSet()).tracks).toHaveLength(2);
  });

  it("duplicates a scene with its clips, inserted after the source", async () => {
    const [copy] = await fake.createScenes(1, "s1");
    expect(copy).toEqual({ id: "s3", name: "Scene 1" });
    expect((await fake.getSet()).scenes.map((s) => s.id)).toEqual(["s1", "s3", "s2"]);
    const slot = (await fake.getTrack("t1")).slots.find((s) => s.sceneId === "s3");
    expect(slot?.clip?.name).toBe("Beat");
  });

  it("duplicates a device after the original", async () => {
    const copy = await fake.duplicateDevice("d1");
    expect(copy.name).toBe("Reverb");
    expect(copy.id).toBe("d2");
    expect((await fake.getTrack("t1")).devices.map((d) => d.id)).toEqual(["d1", "d2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-duplicate.test.ts`
Expected: FAIL — compile errors (`duplicateOf`, `createScenes` arity, `duplicateDevice`).

- [ ] **Step 3: Extend the port**

`src/port/types.ts` — replace `TrackSpec`:

```ts
export interface TrackSpec {
  /** Exactly one of type | duplicateOf (validated in TrackService). */
  type?: TrackType;
  name?: string;
  /** Duplicate this track (with its clips/devices); inserted after it. */
  duplicateOf?: TrackId;
}
```

`src/port/live-port.ts`:

```ts
  createScenes(count: number, duplicateOf?: SceneId): Promise<SceneSummary[]>;
  /** Duplicate a device; the copy is inserted directly after the original. */
  duplicateDevice(id: DeviceId): Promise<DeviceDetail>;
```

- [ ] **Step 4: Implement in FakeLive**

In `src/adapters/fake/fake-live.ts`, replace `createTracks` and `createScenes`, add `duplicateDevice` and the clone helpers:

```ts
  async createTracks(specs: TrackSpec[]): Promise<TrackSummary[]> {
    // Resolve every duplicate source before creating anything (all-or-nothing).
    const sources = new Map<TrackSpec, FakeTrack>();
    for (const spec of specs) {
      if (spec.duplicateOf !== undefined) {
        sources.set(spec, this.requireTrack(spec.duplicateOf));
      }
    }
    return specs.map((spec) => {
      const source = sources.get(spec);
      if (source) {
        const copy = this.cloneTrack(source, spec.name);
        this.tracks.splice(this.tracks.indexOf(source) + 1, 0, copy);
        return this.summarize(copy);
      }
      if (spec.type === undefined) {
        throw new PortError(
          "INVALID_INPUT",
          "each track spec needs exactly one of type or duplicateOf",
        );
      }
      const id = `t${++this.counters.track}`;
      const defaultName =
        spec.type === "midi"
          ? `MIDI ${this.counters.track}`
          : `Audio ${this.counters.track}`;
      const track: FakeTrack = {
        id,
        name: spec.name ?? defaultName,
        type: spec.type,
        muted: false,
        soloed: false,
        armed: false,
        clips: new Map(),
        devices: [],
        mixer: this.defaultMixer(),
      };
      this.tracks.push(track);
      return this.summarize(track);
    });
  }

  async createScenes(count: number, duplicateOf?: SceneId): Promise<SceneSummary[]> {
    const created: SceneSummary[] = [];
    if (duplicateOf === undefined) {
      for (let i = 0; i < count; i++) {
        const id = `s${++this.counters.scene}`;
        const scene = { id, name: `Scene ${this.counters.scene}` };
        this.scenes.push(scene);
        created.push({ ...scene });
      }
      return created;
    }
    const source = this.requireScene(duplicateOf);
    for (let i = 0; i < count; i++) {
      const id = `s${++this.counters.scene}`;
      // Live keeps the source name on duplicate (pinned by self-test).
      const scene = { id, name: source.name };
      this.scenes.splice(this.scenes.indexOf(source) + 1 + i, 0, scene);
      for (const track of this.tracks) {
        const clip = track.clips.get(source.id);
        if (clip) track.clips.set(id, this.cloneClip(clip));
      }
      created.push({ ...scene });
    }
    return created;
  }

  async duplicateDevice(id: DeviceId): Promise<DeviceDetail> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    const copy = this.cloneDevice(found.device);
    found.track.devices.splice(found.track.devices.indexOf(found.device) + 1, 0, copy);
    return await this.getDevice(copy.id);
  }
```

Clone helpers (place next to the other private helpers):

```ts
  private cloneClip(clip: FakeClip): FakeClip {
    return { ...clip, id: this.mintClipId(), notes: this.cloneNotes(clip.notes) };
  }

  private cloneDevice(device: FakeDevice): FakeDevice {
    return {
      ...device,
      id: `d${++this.counters.device}`,
      params: device.params.map((p) => ({
        ...p,
        valueItems: p.valueItems ? [...p.valueItems] : undefined,
      })),
    };
  }

  private cloneTrack(source: FakeTrack, name?: string): FakeTrack {
    const clips = new Map<SceneId, FakeClip>();
    for (const [sceneId, clip] of source.clips) clips.set(sceneId, this.cloneClip(clip));
    return {
      id: `t${++this.counters.track}`,
      // Live keeps the source name on duplicate (pinned by self-test).
      name: name ?? source.name,
      type: source.type,
      muted: source.muted,
      soloed: source.soloed,
      armed: source.armed,
      clips,
      devices: source.devices.map((d) => this.cloneDevice(d)),
      mixer: {
        volume: source.mixer.volume,
        pan: source.mixer.pan,
        sends: new Map(source.mixer.sends),
      },
    };
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/adapters/fake-live-duplicate.test.ts`
Expected: PASS (also run `npx vitest run test/unit/adapters` — existing track/scene tests must stay green).

- [ ] **Step 6: Write the failing service tests**

`test/unit/domain/duplicate-services.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { DeviceService } from "../../../src/domain/device-service.js";
import { TrackService } from "../../../src/domain/track-service.js";

describe("duplicate via services", () => {
  let fake: FakeLive;
  let tracks: TrackService;
  let devices: DeviceService;
  beforeEach(async () => {
    fake = new FakeLive();
    tracks = new TrackService(fake);
    devices = new DeviceService(fake);
    await tracks.createTracks([{ type: "midi", name: "Drums" }]);
    await tracks.createScenes(1);
    await fake.insertDevice("t1", "Reverb");
  });

  it("rejects a spec with both type and duplicateOf", async () => {
    await expect(
      tracks.createTracks([{ type: "midi", duplicateOf: "t1" }]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("rejects a spec with neither type nor duplicateOf", async () => {
    await expect(tracks.createTracks([{ name: "x" }])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("createScenes with duplicateOf defaults count to 1 and fails fast on stale IDs", async () => {
    const created = await tracks.createScenes(undefined, "s1");
    expect(created).toHaveLength(1);
    await expect(tracks.createScenes(undefined, "s99")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("createScenes without count or duplicateOf is INVALID_INPUT", async () => {
    await expect(tracks.createScenes(undefined)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("duplicateDevice records an insert_device undo step", async () => {
    const copy = await devices.duplicateDevice("d1");
    expect(copy.name).toBe("Reverb");
    expect(fake.undoSteps).toContain("insert_device");
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run test/unit/domain/duplicate-services.test.ts`
Expected: FAIL — signatures/validation missing.

- [ ] **Step 8: Implement services + tools**

`src/domain/track-service.ts` — in `createTracks`, after the empty check:

```ts
    for (const spec of specs) {
      if ((spec.type !== undefined) === (spec.duplicateOf !== undefined)) {
        throw new PortError(
          "INVALID_INPUT",
          "each track spec needs exactly one of type or duplicateOf",
        );
      }
    }
```

Replace `createScenes`:

```ts
  async createScenes(
    count: number | undefined,
    duplicateOf?: SceneId,
  ): Promise<SceneSummary[]> {
    const n = count ?? (duplicateOf !== undefined ? 1 : undefined);
    if (n === undefined) {
      throw new PortError(
        "INVALID_INPUT",
        "provide count and/or duplicateOf",
        "count appends empty scenes; duplicateOf copies an existing scene.",
      );
    }
    if (!Number.isInteger(n) || n < 1 || n > 64) {
      throw new PortError("INVALID_INPUT", `count ${n} must be an integer 1-64`);
    }
    if (duplicateOf !== undefined) await this.requireSceneId(duplicateOf);
    return this.live.transact("create_scenes", () =>
      this.live.createScenes(n, duplicateOf),
    );
  }
```

`src/domain/device-service.ts` — add:

```ts
  async duplicateDevice(deviceId: DeviceId): Promise<DeviceDetail> {
    await this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("insert_device", () =>
      this.live.duplicateDevice(deviceId),
    );
  }
```

`src/mcp/tools/tracks.ts` — replace the `create_tracks` and `create_scenes` entries (no new imports needed — validation lives in the services):

```ts
  {
    name: "create_tracks",
    description:
      "Create and/or duplicate tracks in a single undo step. Each spec is EITHER " +
      '{type: "midi" | "audio", name?} (new empty track) OR {duplicateOf: trackId, ' +
      "name?} (full copy — clips, devices, mixer — inserted right after the " +
      "source). Returns the created track summaries with IDs.",
    inputSchema: {
      tracks: z
        .array(
          z.union([
            z
              .object({ type: z.enum(["midi", "audio"]), name: z.string().optional() })
              .strict(),
            z.object({ duplicateOf: z.string(), name: z.string().optional() }).strict(),
          ]),
        )
        .min(1),
    },
    handler: async (args, deps) => ({
      tracks: await deps.tracks.createTracks(args.tracks as TrackSpec[]),
    }),
  },
```

```ts
  {
    name: "create_scenes",
    description:
      "Append N empty scenes (count 1-64), or duplicate an existing scene and its " +
      "clips (duplicateOf, inserted right after the source; count copies N times). " +
      "Returns the created scenes with IDs.",
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
```

`src/mcp/tools/devices.ts` — replace the `insert_device` entry (add `import { PortError } from "../../port/errors.js";`):

```ts
  {
    name: "insert_device",
    description:
      'Insert a built-in Live device by name (e.g. "Reverb", "Auto Filter") onto a ' +
      "track's device chain, OR duplicate an existing device (duplicateOf: deviceId " +
      "— the copy lands right after the source; trackId/index must be omitted). " +
      "One undo step. Optional index positions a named insert (0 = first); omitted " +
      "appends. Third-party plugins are not supported by the Ableton API. Returns " +
      "the new device with its parameters.",
    inputSchema: {
      trackId: z.string().optional(),
      device: z.string().optional(),
      duplicateOf: z.string().optional(),
      index: z.number().int().min(0).optional(),
    },
    handler: async (args, deps) => {
      if (args.duplicateOf !== undefined) {
        if (
          args.device !== undefined ||
          args.trackId !== undefined ||
          args.index !== undefined
        ) {
          throw new PortError(
            "INVALID_INPUT",
            "duplicateOf cannot be combined with trackId, device, or index",
            "The duplicate is inserted right after the source device on its own track.",
          );
        }
        return { device: await deps.devices.duplicateDevice(args.duplicateOf as string) };
      }
      if (args.trackId === undefined || args.device === undefined) {
        throw new PortError(
          "INVALID_INPUT",
          "provide trackId + device, or duplicateOf",
        );
      }
      return {
        device: await deps.devices.insertDevice(
          args.trackId as string,
          args.device as string,
          args.index as number | undefined,
        ),
      };
    },
  },
```

- [ ] **Step 9: Run the full gate**

Run: `npx vitest run test/unit/domain/duplicate-services.test.ts` → PASS, then `npm test && npm run typecheck && npm run lint`
Expected: all green. (`test/component/build-a-beat.test.ts` and friends still pass — old call shapes remain valid.)

- [ ] **Step 10: Format and commit**

```bash
npm run format
git add -A
git commit -m "feat: duplicate tracks/scenes/devices as create-mode params"
```

---

### Task 3: Audio-clip warp (update_clip + get_clip)

**Files:**

- Modify: `src/port/types.ts` (`WarpMode`, `ClipPatch`, `ClipDetail`)
- Modify: `src/adapters/fake/fake-live.ts`
- Modify: `src/domain/clip-editor.ts` (empty-patch hint)
- Modify: `src/mcp/tools/clips.ts` (`update_clip`)
- Test: `test/unit/adapters/fake-live-warp.test.ts` (new)

**Interfaces:**

- Consumes: Task 2's `cloneClip` (spread copies warp fields automatically).
- Produces (used by Tasks 5–8):
  - `WarpMode = "beats" | "tones" | "texture" | "repitch" | "complex" | "complexPro"` (SDK enum: Beats 0, Tones 1, Texture 2, Repitch 3, Complex 4, ComplexPro 6 — 5 is unassigned).
  - `ClipPatch.warping?: boolean`, `ClipPatch.warpMode?: WarpMode`.
  - `ClipDetail.warping?: boolean`, `ClipDetail.warpMode?: WarpMode` — audio clips only, never on `ClipSummary`.
  - Warp fields on a MIDI clip → `UNSUPPORTED` (adapter-level, both adapters, message `clip <id> is a MIDI clip`, hint `warping and warpMode apply to audio clips only.`).

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/fake-live-warp.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive audio-clip warp", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([
      { type: "audio", name: "Vox" },
      { type: "midi", name: "Keys" },
    ]);
    await fake.createScenes(1);
    await fake.createAudioClip("t1", "s1", "/samples/vox.wav");
    await fake.createMidiClip("t2", "s1", 4, []);
  });

  it("audio clips default to warping beats mode", async () => {
    const clip = await fake.getClip("c1");
    expect(clip.warping).toBe(true);
    expect(clip.warpMode).toBe("beats");
  });

  it("updates warping and warpMode", async () => {
    await fake.updateClip("c1", { warping: false, warpMode: "complexPro" });
    const clip = await fake.getClip("c1");
    expect(clip.warping).toBe(false);
    expect(clip.warpMode).toBe("complexPro");
  });

  it("MIDI clips never expose warp fields", async () => {
    const clip = await fake.getClip("c2");
    expect("warping" in clip).toBe(false);
    expect("warpMode" in clip).toBe(false);
  });

  it("warp on a MIDI clip is UNSUPPORTED", async () => {
    await expect(fake.updateClip("c2", { warping: true })).rejects.toMatchObject({
      code: "UNSUPPORTED",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-warp.test.ts`
Expected: FAIL — compile errors (`warping` not in `ClipPatch`).

- [ ] **Step 3: Extend the port**

`src/port/types.ts`:

```ts
/** Live's warp algorithms (audio clips). Mirrors the SDK WarpMode enum. */
export type WarpMode =
  | "beats"
  | "tones"
  | "texture"
  | "repitch"
  | "complex"
  | "complexPro";
```

In `ClipPatch`, after `color`:

```ts
  /** Audio clips only — UNSUPPORTED on MIDI clips. */
  warping?: boolean;
  warpMode?: WarpMode;
```

In `ClipDetail`, after `filePath`:

```ts
  /** Audio clips only. */
  warping?: boolean;
  warpMode?: WarpMode;
```

- [ ] **Step 4: Implement in FakeLive**

`src/adapters/fake/fake-live.ts` — add `WarpMode` to the port-types import; `FakeClip` gains:

```ts
  /** audio clips only */
  warping?: boolean;
  warpMode?: WarpMode;
```

In `createAudioClip`, extend the clip literal (after `filePath`):

```ts
      // Real-Live defaults for a freshly created warped clip; pinned by the
      // self-test contract checks.
      warping: true,
      warpMode: "beats",
```

In `getClip`, extend the return (after the `filePath` spread):

```ts
      ...(clip.warping !== undefined ? { warping: clip.warping } : {}),
      ...(clip.warpMode !== undefined ? { warpMode: clip.warpMode } : {}),
```

In `updateClip`, before the `name` assignment:

```ts
    if (
      (patch.warping !== undefined || patch.warpMode !== undefined) &&
      found.clip.kind !== "audio"
    ) {
      throw new PortError(
        "UNSUPPORTED",
        `clip ${id} is a MIDI clip`,
        "warping and warpMode apply to audio clips only.",
      );
    }
```

and after the `color` assignment:

```ts
    if (patch.warping !== undefined) found.clip.warping = patch.warping;
    if (patch.warpMode !== undefined) found.clip.warpMode = patch.warpMode;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/adapters/fake-live-warp.test.ts`
Expected: PASS

- [ ] **Step 6: Update ClipEditor + update_clip tool**

`src/domain/clip-editor.ts` — in `updateClip`, change the empty-patch hint to:

```ts
        "Provide at least one of: name, looping, color, warping, warpMode.",
```

`src/mcp/tools/clips.ts` — replace the `update_clip` entry:

```ts
  {
    name: "update_clip",
    description:
      'Update clip properties in one undo step: name, looping, color ("#RRGGBB"); ' +
      "for audio clips also warping (on/off) and warpMode (beats | tones | texture " +
      "| repitch | complex | complexPro). Returns the updated clip summary.",
    inputSchema: {
      clipId: z.string(),
      name: z.string().optional(),
      looping: z.boolean().optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      warping: z.boolean().optional(),
      warpMode: z
        .enum(["beats", "tones", "texture", "repitch", "complex", "complexPro"])
        .optional(),
    },
    handler: async (args, deps) => {
      const patch: ClipPatch = {
        ...(args.name !== undefined ? { name: args.name as string } : {}),
        ...(args.looping !== undefined ? { looping: args.looping as boolean } : {}),
        ...(args.color !== undefined ? { color: args.color as string } : {}),
        ...(args.warping !== undefined ? { warping: args.warping as boolean } : {}),
        ...(args.warpMode !== undefined
          ? { warpMode: args.warpMode as ClipPatch["warpMode"] }
          : {}),
      };
      const clip = await deps.clips.updateClip(args.clipId as string, patch);
      return {
        clip: {
          id: clip.id,
          name: clip.name,
          looping: clip.looping,
          color: clip.color ?? null,
          ...(clip.warping !== undefined ? { warping: clip.warping } : {}),
          ...(clip.warpMode !== undefined ? { warpMode: clip.warpMode } : {}),
        },
      };
    },
  },
```

- [ ] **Step 7: Run the full gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 8: Format and commit**

```bash
npm run format
git add -A
git commit -m "feat: audio-clip warp control via update_clip/get_clip"
```

---

### Task 4: Simpler sample replacement (new tool `set_simpler_sample`)

**Files:**

- Modify: `src/port/types.ts` (`DeviceDetail.samplePath?`), `src/port/live-port.ts` (new `setSimplerSample`)
- Modify: `src/adapters/fake/fake-live.ts` (Simpler in CATALOG, `FakeDevice.samplePath?`, method)
- Modify: `src/domain/device-service.ts`
- Modify: `src/mcp/tools/devices.ts` (new tool)
- Test: `test/unit/adapters/fake-live-simpler.test.ts` (new)

**Interfaces:**

- Consumes: Task 2's `cloneDevice` (`...device` spread copies `samplePath` automatically).
- Produces (used by Tasks 5–8):
  - `DeviceDetail.samplePath?: string` — present only on Simpler devices with a loaded sample.
  - `LivePort.setSimplerSample(id: DeviceId, filePath: string): Promise<{ samplePath: string }>`.
  - `DeviceService.setSimplerSample(deviceId, filePath)` — rejects non-absolute paths (`INVALID_INPUT`) before the port call; undo label `set_simpler_sample`.
  - Non-Simpler device → `UNSUPPORTED`, message `` `device ${id} is a ${name}, not a Simpler` ``.
  - Tool `set_simpler_sample(deviceId, filePath)` → `{ deviceId, samplePath }`. Tool count: 21 → 22.

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/fake-live-simpler.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive Simpler sample", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Sampler" }]);
    await fake.insertDevice("t1", "Simpler");
    await fake.insertDevice("t1", "Reverb");
  });

  it("a fresh Simpler has no samplePath", async () => {
    expect("samplePath" in (await fake.getDevice("d1"))).toBe(false);
  });

  it("replaces the sample and reports it in get_device", async () => {
    const result = await fake.setSimplerSample("d1", "/samples/kick.wav");
    expect(result).toEqual({ samplePath: "/samples/kick.wav" });
    expect((await fake.getDevice("d1")).samplePath).toBe("/samples/kick.wav");
  });

  it("is UNSUPPORTED on non-Simpler devices", async () => {
    await expect(
      fake.setSimplerSample("d2", "/samples/kick.wav"),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED",
      message: "device d2 is a Reverb, not a Simpler",
    });
  });

  it("is NOT_FOUND on stale device IDs", async () => {
    await expect(fake.setSimplerSample("d9", "/x.wav")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-simpler.test.ts`
Expected: FAIL — `Simpler` unknown to CATALOG / `setSimplerSample` missing.

- [ ] **Step 3: Extend port + FakeLive**

`src/port/types.ts` — in `DeviceDetail`:

```ts
export interface DeviceDetail extends DeviceRef {
  trackId: TrackId;
  params: DeviceParam[];
  /** Simpler devices only: path of the loaded sample. */
  samplePath?: string;
}
```

`src/port/live-port.ts`:

```ts
  /** Replace the sample of a Simpler device (absolute file path). */
  setSimplerSample(id: DeviceId, filePath: string): Promise<{ samplePath: string }>;
```

`src/adapters/fake/fake-live.ts` — CATALOG gains:

```ts
  Simpler: [onOff, knob("Volume", 0.85), knob("Filter Freq", 1)],
```

`FakeDevice` gains `samplePath?: string;` — and in `getDevice`, after `params`:

```ts
      ...(found.device.samplePath !== undefined
        ? { samplePath: found.device.samplePath }
        : {}),
```

New method:

```ts
  async setSimplerSample(
    id: DeviceId,
    filePath: string,
  ): Promise<{ samplePath: string }> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    if (found.device.name !== "Simpler") {
      throw new PortError(
        "UNSUPPORTED",
        `device ${id} is a ${found.device.name}, not a Simpler`,
        "set_simpler_sample only works on Simpler devices (see get_track for names).",
      );
    }
    // FakeLive cannot check the file exists; real Live throws (mapped to
    // NOT_FOUND by the SdkAdapter) — pinned by the self-test contract checks.
    found.device.samplePath = filePath;
    return { samplePath: filePath };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/adapters/fake-live-simpler.test.ts`
Expected: PASS

- [ ] **Step 5: Implement service + tool**

`src/domain/device-service.ts` — add:

```ts
const ABSOLUTE_PATH_RE = /^(\/|[A-Za-z]:[\\/])/;
```

(top of file, after imports) and the method:

```ts
  async setSimplerSample(
    deviceId: DeviceId,
    filePath: string,
  ): Promise<{ samplePath: string }> {
    if (!ABSOLUTE_PATH_RE.test(filePath)) {
      throw new PortError(
        "INVALID_INPUT",
        `filePath "${filePath}" must be absolute`,
        "Provide the full path to an audio file on the machine running Live.",
      );
    }
    await this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("set_simpler_sample", () =>
      this.live.setSimplerSample(deviceId, filePath),
    );
  }
```

`src/mcp/tools/devices.ts` — append to `deviceTools`:

```ts
  {
    name: "set_simpler_sample",
    description:
      "Replace the sample loaded in a Simpler device with an audio file " +
      "(absolute path on the machine running Live), in one undo step. Fails " +
      "UNSUPPORTED on any other device type. Returns the loaded sample's path.",
    inputSchema: { deviceId: z.string(), filePath: z.string().min(1) },
    handler: async (args, deps) => {
      const { samplePath } = await deps.devices.setSimplerSample(
        args.deviceId as string,
        args.filePath as string,
      );
      return { deviceId: args.deviceId, samplePath };
    },
  },
```

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green.

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add -A
git commit -m "feat: set_simpler_sample tool (Simpler sample replacement)"
```

---

### Task 5: Component tests + token budgets

**Files:**

- Test: `test/component/quick-wins.test.ts` (new)
- Modify: `test/component/token-budget.test.ts` (cues in the big fixture)

**Interfaces:**

- Consumes: `startTestStack` / `callTool` from `test/component/helpers.ts`; all Task 1–4 tools.
- Produces: the CI gate for this plan — full-stack behavior incl. error envelopes, plus the token-economy assertion that 10 cues keep `get_set` under 8 KB.

- [ ] **Step 1: Write the component tests**

`test/component/quick-wins.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

describe("v2 quick wins (component)", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack();
    await callTool(stack.client, "create_tracks", {
      tracks: [
        { type: "midi", name: "Drums" },
        { type: "audio", name: "Vox" },
      ],
    });
    await callTool(stack.client, "create_scenes", { count: 1 });
  });
  afterEach(async () => {
    await stack.close();
  });

  it("cue lifecycle: add, list, rename, delete", async () => {
    const add = await callTool(stack.client, "update_song", {
      addCues: [{ timeBeats: 0, name: "Intro" }, { timeBeats: 32 }],
    });
    expect(add.payload.ok).toBe(true);
    expect(add.payload.addedCues).toHaveLength(2);
    const [intro, second] = add.payload.addedCues;

    const set = await callTool(stack.client, "get_set");
    expect(set.payload.set.cues.map((c: { name: string }) => c.name)).toContain(
      "Intro",
    );

    const edit = await callTool(stack.client, "update_song", {
      renameCues: [{ id: second.id, name: "Drop" }],
      deleteCueIds: [intro.id],
    });
    expect(edit.payload).toMatchObject({
      ok: true,
      renamedCueIds: [second.id],
      deletedCueIds: [intro.id],
    });

    const bad = await callTool(stack.client, "update_song", {
      deleteCueIds: ["q99"],
    });
    expect(bad.payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("duplicates a track via create_tracks", async () => {
    await callTool(stack.client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [[60, 0, 1, 100]],
    });
    const dup = await callTool(stack.client, "create_tracks", {
      tracks: [{ duplicateOf: "t1" }],
    });
    expect(dup.payload.ok).toBe(true);
    expect(dup.payload.tracks[0]).toMatchObject({ name: "Drums", clipCount: 1 });
  });

  it("duplicates a scene and a device", async () => {
    const scene = await callTool(stack.client, "create_scenes", {
      duplicateOf: "s1",
    });
    expect(scene.payload.ok).toBe(true);
    expect(scene.payload.scenes).toHaveLength(1);

    await callTool(stack.client, "insert_device", { trackId: "t1", device: "Reverb" });
    const dup = await callTool(stack.client, "insert_device", {
      duplicateOf: "d1",
    });
    expect(dup.payload.ok).toBe(true);
    expect(dup.payload.device.name).toBe("Reverb");

    const bad = await callTool(stack.client, "insert_device", {
      duplicateOf: "d1",
      index: 0,
    });
    expect(bad.payload).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("controls warp on audio clips and rejects it on MIDI clips", async () => {
    await callTool(stack.client, "create_audio_clip", {
      trackId: "t2",
      sceneId: "s1",
      filePath: "/samples/vox.wav",
    });
    const warp = await callTool(stack.client, "update_clip", {
      clipId: "c1",
      warpMode: "repitch",
      warping: false,
    });
    expect(warp.payload.ok).toBe(true);
    expect(warp.payload.clip).toMatchObject({ warpMode: "repitch", warping: false });

    await callTool(stack.client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [],
    });
    const bad = await callTool(stack.client, "update_clip", {
      clipId: "c2",
      warping: true,
    });
    expect(bad.payload).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });

  it("replaces a Simpler sample and rejects other devices and relative paths", async () => {
    await callTool(stack.client, "insert_device", { trackId: "t1", device: "Simpler" });
    const ok = await callTool(stack.client, "set_simpler_sample", {
      deviceId: "d1",
      filePath: "/samples/kick.wav",
    });
    expect(ok.payload).toMatchObject({ ok: true, samplePath: "/samples/kick.wav" });

    const device = await callTool(stack.client, "get_device", { deviceId: "d1" });
    expect(device.payload.device.samplePath).toBe("/samples/kick.wav");

    const relative = await callTool(stack.client, "set_simpler_sample", {
      deviceId: "d1",
      filePath: "samples/kick.wav",
    });
    expect(relative.payload).toMatchObject({ ok: false, code: "INVALID_INPUT" });

    await callTool(stack.client, "insert_device", { trackId: "t1", device: "Reverb" });
    const wrong = await callTool(stack.client, "set_simpler_sample", {
      deviceId: "d2",
      filePath: "/samples/kick.wav",
    });
    expect(wrong.payload).toMatchObject({ ok: false, code: "UNSUPPORTED" });
  });
});
```

- [ ] **Step 2: Extend the token-budget fixture**

`test/component/token-budget.test.ts` — in `bigFixture()`, before `return fake;`:

```ts
  await fake.updateSong({
    addCues: Array.from({ length: 10 }, (_, i) => ({
      timeBeats: i * 16,
      name: `Section ${i + 1}`,
    })),
  });
```

In the `get_set` budget test, add after the tracks assertion:

```ts
    expect(payload.set.cues).toHaveLength(10);
```

- [ ] **Step 3: Run the full gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green — in particular `get_set … stays under 8 KB` still passes with 10 cues.

- [ ] **Step 4: Format and commit**

```bash
npm run format
git add -A
git commit -m "test: component coverage + token budgets for v2 quick wins"
```

---

### Task 6: SDK adapter (real-Live implementation)

**Files:**

- Modify: `src/adapters/sdk-1.0/sdk-adapter.ts` (only — `codec.ts` is deliberately SDK-import-free so its unit test stays in CI; the warp mapping needs the SDK enum, so it lives in the adapter file)

**Interfaces:**

- Consumes: everything Tasks 1–4 defined on the port; SDK 1.0.0-beta.0 APIs (verified signatures): `Song.cuePoints` / `createCuePoint(time)` / `deleteCuePoint(cp)`, `CuePoint.name` (set) / `.time` (get only), `Song.duplicateTrack(track)` / `duplicateScene(scene)`, `Track.duplicateDevice(device)`, `AudioClip.warping` / `.warpMode` (both settable), enum `WarpMode {Beats:0, Tones:1, Texture:2, Repitch:3, Complex:4, ComplexPro:6}`, `Simpler.sample` / `.replaceSample(absPath)`.
- Produces: `SdkAdapter` fully implements the widened `LivePort`. Error codes/messages/hints match FakeLive verbatim.

**Note:** `sdk-adapter.ts` is excluded from the CI typecheck; verify locally with `npm run setup:sdk && npm run typecheck:sdk`. If the SDK tarballs are not present in `references/`, implement carefully against the signatures above, run plain `npm run typecheck` + `npm test`, and flag in the PR that `typecheck:sdk` needs a machine with the tarballs.

- [ ] **Step 1: Add the warp-mode mapping to sdk-adapter.ts**

Add near the top of `sdk-adapter.ts` (below the imports):

```ts
import { WarpMode as SdkWarpMode } from "@ableton-extensions/sdk";
import type { WarpMode } from "../../port/types.js";

const WARP_MODE_PAIRS: ReadonlyArray<[SdkWarpMode, WarpMode]> = [
  [SdkWarpMode.Beats, "beats"],
  [SdkWarpMode.Tones, "tones"],
  [SdkWarpMode.Texture, "texture"],
  [SdkWarpMode.Repitch, "repitch"],
  [SdkWarpMode.Complex, "complex"],
  [SdkWarpMode.ComplexPro, "complexPro"],
];

function warpModeFromSdk(mode: number): WarpMode {
  const found = WARP_MODE_PAIRS.find(([sdk]) => sdk === mode);
  if (!found) throw new PortError("INTERNAL", `unknown SDK warp mode ${mode}`);
  return found[1];
}

function warpModeToSdk(mode: WarpMode): SdkWarpMode {
  const found = WARP_MODE_PAIRS.find(([, port]) => port === mode);
  if (!found) throw new PortError("INTERNAL", `unknown warp mode ${mode}`);
  return found[0];
}
```

(Adjust import placement to merge with the existing SDK import statement; also import `CuePoint` and `Simpler` types there.)

- [ ] **Step 2: Cue points in SdkAdapter**

Add the registry field next to the others:

```ts
  private readonly cueIds = new IdRegistry<CuePoint<V>>("q");
```

In `getSet()`, after `returnTracks`:

```ts
      ...(this.song.cuePoints.length > 0
        ? {
            cues: [...this.song.cuePoints]
              .sort((a, b) => toNumber(a.time) - toNumber(b.time))
              .map((cp) => ({
                id: this.cueIds.idFor(cp),
                name: cp.name,
                timeBeats: toNumber(cp.time),
              })),
          }
        : {}),
```

Replace `updateSong`:

```ts
  async updateSong(patch: SongPatch): Promise<UpdateSongResult> {
    // Resolve every referenced cue before any mutation (all-or-nothing),
    // mirroring FakeLive.
    const resolveCue = (id: string): CuePoint<V> => {
      const cue = this.cueIds.resolve(id);
      if (cue && this.song.cuePoints.includes(cue)) return cue;
      if (cue) this.cueIds.forget(cue);
      throw PortError.notFound("cue point", id);
    };
    const renames = (patch.renameCues ?? []).map((r) => ({
      cue: resolveCue(r.id),
      name: r.name,
    }));
    const deletes = (patch.deleteCueIds ?? []).map((id) => resolveCue(id));

    if (patch.tempo !== undefined) this.song.tempo = patch.tempo;
    for (const { cue, name } of renames) cue.name = name;
    for (const cue of deletes) {
      await this.song.deleteCuePoint(cue);
      this.cueIds.forget(cue);
    }
    const addedCues: CueRef[] = [];
    for (const add of patch.addCues ?? []) {
      const cue = await this.song.createCuePoint(add.timeBeats);
      if (add.name !== undefined) cue.name = add.name;
      addedCues.push({
        id: this.cueIds.idFor(cue),
        name: cue.name,
        timeBeats: toNumber(cue.time),
      });
    }
    return { addedCues };
  }
```

(Import `CueRef`, `UpdateSongResult` from port types.)

- [ ] **Step 3: Duplicate in SdkAdapter**

In `createTracks`, replace the loop body:

```ts
    for (const spec of specs) {
      let track: Track<V>;
      if (spec.duplicateOf !== undefined) {
        const source = this.resolveTrack(spec.duplicateOf);
        track = await this.song.duplicateTrack(source);
      } else if (spec.type === "midi") {
        track = await this.song.createMidiTrack();
      } else if (spec.type === "audio") {
        track = await this.song.createAudioTrack();
      } else {
        throw new PortError(
          "INVALID_INPUT",
          "each track spec needs exactly one of type or duplicateOf",
        );
      }
      if (spec.name !== undefined) track.name = spec.name;
      created.push(this.summarizeTrack(track));
    }
```

Replace `createScenes`:

```ts
  async createScenes(count: number, duplicateOf?: SceneId): Promise<SceneSummary[]> {
    const created: SceneSummary[] = [];
    if (duplicateOf !== undefined) {
      const { scene: source } = this.resolveScene(duplicateOf);
      for (let i = 0; i < count; i++) {
        created.push(this.summarizeScene(await this.song.duplicateScene(source)));
      }
      return created;
    }
    for (let i = 0; i < count; i++) {
      // -1 appends at the end (docs/sdk-notes.md §3), matching FakeLive.
      created.push(this.summarizeScene(await this.song.createScene(-1)));
    }
    return created;
  }
```

Add:

```ts
  async duplicateDevice(id: DeviceId): Promise<DeviceDetail> {
    const { track, device } = this.resolveDevice(id);
    const copy = await track.duplicateDevice(device);
    return await this.deviceDetail(track, copy);
  }
```

- [ ] **Step 4: Warp in SdkAdapter**

In `getClip`, after the `filePath` spread:

```ts
      ...(clip instanceof AudioClip
        ? {
            warping: clip.warping,
            warpMode: warpModeFromSdk(toNumber(clip.warpMode)),
          }
        : {}),
```

In `updateClip`, before the `name` assignment:

```ts
    if (
      (patch.warping !== undefined || patch.warpMode !== undefined) &&
      !(clip instanceof AudioClip)
    ) {
      throw new PortError(
        "UNSUPPORTED",
        `clip ${id} is a MIDI clip`,
        "warping and warpMode apply to audio clips only.",
      );
    }
```

and after the `color` assignment (the instanceof check above lets TS narrow only inside a guarded block — re-check as needed):

```ts
    if (clip instanceof AudioClip) {
      if (patch.warping !== undefined) clip.warping = patch.warping;
      if (patch.warpMode !== undefined) clip.warpMode = warpModeToSdk(patch.warpMode);
    }
```

- [ ] **Step 5: Simpler in SdkAdapter**

In `deviceDetail`, after `params`:

```ts
      ...(device instanceof Simpler && device.sample
        ? { samplePath: device.sample.filePath }
        : {}),
```

Add:

```ts
  async setSimplerSample(
    id: DeviceId,
    filePath: string,
  ): Promise<{ samplePath: string }> {
    const { device } = this.resolveDevice(id);
    if (!(device instanceof Simpler)) {
      throw new PortError(
        "UNSUPPORTED",
        `device ${id} is a ${device.name}, not a Simpler`,
        "set_simpler_sample only works on Simpler devices (see get_track for names).",
      );
    }
    let sample;
    try {
      sample = await device.replaceSample(filePath);
    } catch (err) {
      if (err instanceof PortError) throw err;
      const message =
        err instanceof Error && err.message
          ? err.message
          : `could not load sample "${filePath}"`;
      throw new PortError(
        "NOT_FOUND",
        message,
        `Check that ${filePath} exists and is an audio file readable by Live.`,
      );
    }
    return { samplePath: sample.filePath };
  }
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run lint` (CI surface) and, when the SDK tarballs are available, `npm run setup:sdk && npm run typecheck:sdk`.
Expected: all green.

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add -A
git commit -m "feat: SDK adapter for cues, duplicate, warp, Simpler sample"
```

---

### Task 7: In-Live self-test contract checks

**Files:**

- Modify: `src/shell/self-test.ts`
- Test: `test/unit/shell/self-test.test.ts` runs the runner against FakeLive and asserts `passed > 0 && failed === 0` — no count changes needed, it just has to stay green.

**Interfaces:**

- Consumes: Tasks 1–4 service APIs; the runner's existing helpers `check`, `expectError`, `report`, `approx`, `errText`, `NAME_PREFIX`, `SELF_TEST_SAMPLE`, and its cleanup lists.
- Produces: contract checks that pin FakeLive-vs-real-Live parity for every quick-win feature; they run green against FakeLive in CI (via the unit test) and against real Live from the status dialog.

- [ ] **Step 1: Add a cue cleanup list**

In `runSelfTest`, next to `createdTrackIds`:

```ts
  let createdCueIds: string[] = [];
```

In the `finally` block, after the scene/track deletion (inside the same `try`):

```ts
      const liveCueIds = new Set(((set.cues ?? []) as { id: string }[]).map((c) => c.id));
      const cuesToDelete = createdCueIds.filter((id) => liveCueIds.has(id));
      if (cuesToDelete.length > 0) {
        await deps.song.updateSong({ deleteCueIds: cuesToDelete });
      }
```

(Note: `set` there is the snapshot the cleanup already fetches.)

- [ ] **Step 2: Add the quick-win checks**

Insert before the `--- contract: audio-clip note edit ---` section:

```ts
    // --- v2 quick wins: cue points (add → rename → delete round-trip) ---
    const cueAdd = await deps.song.updateSong({
      addCues: [{ timeBeats: 8, name: `${NAME_PREFIX} Cue` }],
    });
    const cue = cueAdd.addedCues[0];
    check("add cue point at beat 8", approx(cue?.timeBeats, 8), 8, cue?.timeBeats);
    if (cue) {
      createdCueIds.push(cue.id);
      await deps.song.updateSong({
        renameCues: [{ id: cue.id, name: `${NAME_PREFIX} Cue v2` }],
      });
      const renamedCue = (await deps.inspector.getSet()).cues?.find(
        (c) => c.id === cue.id,
      );
      check(
        "rename cue point",
        renamedCue?.name === `${NAME_PREFIX} Cue v2`,
        `${NAME_PREFIX} Cue v2`,
        renamedCue?.name,
      );
      await deps.song.updateSong({ deleteCueIds: [cue.id] });
      createdCueIds = createdCueIds.filter((id) => id !== cue.id);
      const cueGone = !((await deps.inspector.getSet()).cues ?? []).some(
        (c) => c.id === cue.id,
      );
      check("delete cue point", cueGone, "absent", cueGone ? "absent" : "present");
    }
    await expectError("stale cue ID -> NOT_FOUND", "NOT_FOUND", () =>
      deps.song.updateSong({ deleteCueIds: ["q999999"] }),
    );

    // --- v2 quick wins: duplicate track / scene / device ---
    const [dupTrack] = await deps.tracks.createTracks([{ duplicateOf: drums.id }]);
    createdTrackIds.push(dupTrack.id);
    check(
      "duplicate track keeps source name",
      dupTrack.name === drums.name,
      drums.name,
      dupTrack.name,
    );
    check(
      "duplicate track copies clips",
      dupTrack.clipCount >= 1,
      ">= 1 clip",
      dupTrack.clipCount,
    );
    const [dupScene] = await deps.tracks.createScenes(undefined, sceneA.id);
    createdSceneIds.push(dupScene.id);
    check(
      "duplicate scene keeps source name",
      dupScene.name === "Verse",
      "Verse",
      dupScene.name,
    );
    const reverbCopy = await deps.devices.duplicateDevice(reverb.id);
    check(
      "duplicate device -> Reverb copy",
      reverbCopy.name === "Reverb",
      "Reverb",
      reverbCopy.name,
    );

    // --- v2 quick wins: warp control ---
    await expectError("warp on MIDI clip -> UNSUPPORTED", "UNSUPPORTED", () =>
      deps.clips.updateClip(drumClip.id, { warping: false }),
    );

    // --- v2 quick wins: Simpler sample ---
    const simpler = await deps.devices.insertDevice(bass.id, "Simpler");
    check("insert Simpler", simpler.name === "Simpler", "Simpler", simpler.name);
    await expectError("Simpler sample on Reverb -> UNSUPPORTED", "UNSUPPORTED", () =>
      deps.devices.setSimplerSample(reverb.id, SELF_TEST_SAMPLE),
    );
    try {
      const { samplePath } = await deps.devices.setSimplerSample(
        simpler.id,
        SELF_TEST_SAMPLE,
      );
      check(
        "Simpler sample replaced",
        samplePath.length > 0,
        "non-empty path",
        samplePath,
      );
    } catch (err) {
      report(
        `SKIP: Simpler sample check — ${errText(err)}. Provide a sample at ${SELF_TEST_SAMPLE} to enable it.`,
      );
    }
```

Then, inside the existing `if (audioClipId !== undefined)` block (after the note-edit `expectError`), add the audio-warp round-trip:

```ts
      await deps.clips.updateClip(id, { warping: true, warpMode: "tones" });
      const warped = await deps.inspector.getClip(id);
      check(
        "audio clip warpMode -> tones",
        warped.warpMode === "tones",
        "tones",
        warped.warpMode,
      );
```

- [ ] **Step 3: Run the full gate**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green — in particular `test/unit/shell/self-test.test.ts` (`failed === 0` against FakeLive).

- [ ] **Step 4: Format and commit**

```bash
npm run format
git add -A
git commit -m "test: self-test contract checks for v2 quick wins"
```

---

### Task 8: Docs — capability map, ADR 0010, tools.md, roadmap

**Files:**

- Modify: `docs/capability-map.md` (exposure table + "Not possible" column)
- Create: `docs/decisions/0010-v2-surface-shaping.md`
- Modify: `docs/ROADMAP.md` (v2 slice status)
- Regenerate: `docs/tools.md` (`npm run gen:tools` — never hand-edit)
- Check: `README.md` for stale tool counts

**Interfaces:**

- Consumes: the final tool surface from Tasks 1–7.
- Produces: CLAUDE.md-mandated documentation for a port/adapter change; ADR 0010 is referenced by Plans 4b/4c.

- [ ] **Step 1: Update the capability map**

In `docs/capability-map.md`:

- Song/Set row, "Not possible" column: append `, cue-point move (time is immutable)`.
- MCP exposure table: replace the last two rows with:

```markdown
| Cue points                              | `update_song`, `get_set`                                            | v2a (implemented) |
| Duplicate track/scene/device            | `create_tracks`, `create_scenes`, `insert_device` (`duplicateOf`)   | v2a (implemented) |
| Audio-clip warp                         | `update_clip`, `get_clip`                                           | v2a (implemented) |
| Simpler sample replace                  | `set_simpler_sample`, `get_device` (`samplePath`)                   | v2a (implemented) |
| Audio render / file import              | `render_audio`, `import_file`                                       | deferred (v2c)    |
| Take lanes, rack chains                 | —                                                                   | deferred (v2b)    |
```

- Update the "21-tool v1 surface" phrasing in "Runtime status" to "22-tool surface (v1 + Phase A of the v2 spec)".

- [ ] **Step 2: Write ADR 0010**

`docs/decisions/0010-v2-surface-shaping.md`, following the ADR 0001–0009 format (context → decision → alternatives → consequences). Content to cover:

- **Context:** v2 spec exposes 8 SDK capabilities; tool-count growth costs client context (token economy P0).
- **Decision:** extend an existing tool when the capability is a new facet of an existing domain (cues→`update_song`, warp→`update_clip`, duplicate→create-mode params on `create_tracks`/`create_scenes`/`insert_device`); new tools only for new domains (`set_simpler_sample`, Plan 4b/4c tools). Duplicate is a create-mode (`duplicateOf`) rather than a standalone tool. Hierarchical minted IDs for subordinate objects (`t1.l1` lanes, `d3.ch1` chains — Plan 4b); flat `q*` for cues. File-based results exchange paths, never payloads (Plan 4c).
- **Alternatives:** dedicated tool per capability (rejected: schema-token bloat); one polymorphic `duplicate` tool (rejected: murkier errors, mixed ID namespaces).
- **Consequences:** 21→22 tools in Phase A (est. 27 after Phase C); schemas gain unions/optionals with exactly-one-of validation in services; API asymmetries (cue time immutable, insert-only chains) surface as `UNSUPPORTED`/schema absence with hints.

- [ ] **Step 3: Regenerate tools.md and check the README**

```bash
npm run gen:tools
grep -n "21" README.md docs/README* 2>/dev/null
```

Update any stale tool-count claims found (README says "21 tools" → "22 tools").

- [ ] **Step 4: Update the roadmap**

In `docs/ROADMAP.md` "Candidate next slices", replace the "Deferred v2 tools" bullet with a "v2 in progress" note: Plan 4a (this PR — cues/duplicate/warp/Simpler, spec `docs/specs/2026-07-24-v2-tool-surface-design.md`), Plan 4b (take lanes + rack chains), Plan 4c (import/render) to follow.

- [ ] **Step 5: Run the full gate and commit**

```bash
npm test && npm run typecheck && npm run lint && npm run format:check
git add -A
git commit -m "docs: capability map, ADR 0010, tools.md for v2 quick wins"
```

---

## Completion

After Task 8: push `feature/v2-quick-wins`, open the PR (one PR for this plan, per project convention), CI must be green. The in-Live smoke (macOS) with the extended self-test happens on this branch before merge per the spec's acceptance criteria — coordinate with the human partner since it needs a running Live.
