# Plan 1: Foundation — Port, FakeLive, MCP Server over HTTP

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working MCP server (10 tools: set/track/clip reads, track/scene/clip/note/song writes) running against an in-memory FakeLive over Streamable HTTP with bearer-token auth, validated by a CI component-test harness — no Ableton required.

**Architecture:** Ports-and-adapters per `docs/specs/2026-07-19-ableton-mcp-extension-design.md`. `src/port/` defines the `LivePort` interface + DTOs (zero imports). `src/adapters/fake/` implements it in memory. `src/domain/` services own validation and undo-step naming. `src/mcp/` registers tools from a declarative registry and serves Streamable HTTP on 127.0.0.1. The real SDK adapter is Plan 3; nothing in this plan may import `@ableton-extensions/sdk`.

**Tech Stack:** TypeScript (strict, ESM, NodeNext), Node ≥ 24, vitest, zod v3, `@modelcontextprotocol/sdk` (v1.x), tsx (dev runner).

**Roadmap context:** Plan 1 of 3. Plan 2 = full tool surface (devices, mixer, audio clips, note-filter edits). Plan 3 = real SDK adapter, extension shell, packaging, smoke suite. Plans 2–3 are written after their predecessors complete.

## Global Constraints

- Only `src/adapters/sdk-*` may ever import `@ableton-extensions/sdk`; in this plan **nothing** imports it.
- `src/port/` has zero imports (type-only files importing from within `src/port/` are fine).
- Every write goes through `LivePort.transact(label, fn)` → exactly one undo step, labeled with the tool name.
- Batch writes validate all IDs **before** mutating (all-or-nothing per tool call).
- Tools never throw to the client: every result is `{ok: true, ...}` or `{ok: false, code, message, hint?}` with code ∈ `NOT_FOUND | INVALID_INPUT | UNSUPPORTED | CONFLICT | INTERNAL`.
- MIDI notes cross every boundary as compact tuples `[pitch, startBeat, durBeats, velocity, extras?]` (ADR 0004).
- Token budget (asserted in tests): `get_set` on a 50-track/8-scene fixture serializes to < 8192 bytes.
- HTTP binds `127.0.0.1` only; non-localhost `Host`/`Origin` → 403; missing/wrong bearer token → 401.
- TypeScript `strict`; ESM source (`"type": "module"`, NodeNext resolution — relative imports need `.js` extensions).
- Commit after every task (steps include the commands).

---

### Task 1: Project scaffold

**Files:**

- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Test: `test/unit/scaffold.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `npm test` (vitest run), `npm run typecheck` (tsc --noEmit) for all later tasks.

- [ ] **Step 1: Write package.json**

```json
{
  "name": "ableton-mcp-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "dev:fake": "tsx src/dev/fake-server.ts"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```bash
npm install zod@^3.24.0 @modelcontextprotocol/sdk@^1.12.0
npm install -D typescript@^5.9.0 vitest@^3.2.0 tsx@^4.19.0 @types/node@^24.0.0
```

Expected: both commands exit 0; `package-lock.json` created. If `@modelcontextprotocol/sdk@^1.12.0` does not resolve, install latest 1.x (`npm install @modelcontextprotocol/sdk@latest`) and note the version in the commit message.

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Write vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Write a sanity test**

`test/unit/scaffold.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 6: Verify test and typecheck pass**

Run: `npm test`
Expected: `1 passed`.
Run: `npm run typecheck`
Expected: exit 0, no output.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts test/
git commit -m "chore: scaffold TypeScript + vitest project"
```

---

### Task 2: Port layer — DTO types, errors, LivePort interface

**Files:**

- Create: `src/port/types.ts`, `src/port/errors.ts`, `src/port/live-port.ts`
- Test: `test/unit/port/errors.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (used by every later task):
  - All DTO types below, exactly as named.
  - `PortError` with `code: PortErrorCode`, `hint?: string`; factory `PortError.notFound(kind, id)`.
  - `LivePort` interface — sync reads, async writes, `transact`.

- [ ] **Step 1: Write the failing test**

`test/unit/port/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PortError } from "../../../src/port/errors.js";

describe("PortError", () => {
  it("carries code, message and hint", () => {
    const e = new PortError("INVALID_INPUT", "bad pitch", "Pitch must be 0-127.");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("INVALID_INPUT");
    expect(e.message).toBe("bad pitch");
    expect(e.hint).toBe("Pitch must be 0-127.");
  });

  it("notFound factory produces a self-correcting hint", () => {
    const e = PortError.notFound("track", "t9");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.message).toBe("track t9 not found");
    expect(e.hint).toContain("get_set");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/port/errors.test.ts`
Expected: FAIL — cannot find module `src/port/errors.js`.

- [ ] **Step 3: Write src/port/errors.ts**

```ts
export type PortErrorCode =
  "NOT_FOUND" | "INVALID_INPUT" | "UNSUPPORTED" | "CONFLICT" | "INTERNAL";

/** The only error type that crosses the port boundary. */
export class PortError extends Error {
  constructor(
    readonly code: PortErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "PortError";
  }

  static notFound(kind: string, id: string): PortError {
    return new PortError(
      "NOT_FOUND",
      `${kind} ${id} not found`,
      `The ${kind} may have been deleted or the ID is stale. Call get_set to refresh IDs.`,
    );
  }
}
```

- [ ] **Step 4: Write src/port/types.ts**

```ts
export type TrackId = string; // "t1", "t2", ... minted per session
export type SceneId = string; // "s1", ...
export type ClipId = string; // "c1", ...

export type TrackType = "midi" | "audio";

/** Optional per-note extras; present only when non-default (ADR 0004). */
export interface NoteExtras {
  /** probability 0..1 (default 1) */
  prob?: number;
  /** velocity deviation (default 0) */
  velDev?: number;
  /** default false */
  muted?: boolean;
  /** release velocity 0..127 (default 64) */
  relVel?: number;
}

/** [pitch 0-127, startBeat >= 0, durationBeats > 0, velocity 1-127, extras?] */
export type Note =
  [number, number, number, number] | [number, number, number, number, NoteExtras];

export interface TrackSpec {
  type: TrackType;
  name?: string;
}

export interface TrackPatch {
  name?: string;
  muted?: boolean;
  soloed?: boolean;
  armed?: boolean;
}

export interface SongPatch {
  tempo?: number;
}

export interface TrackSummary {
  id: TrackId;
  name: string;
  type: TrackType;
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  deviceNames: string[];
  clipCount: number;
}

export interface SceneSummary {
  id: SceneId;
  name: string;
}

export interface SetSnapshot {
  tempo: number;
  scaleName: string;
  rootNote: number;
  tracks: TrackSummary[];
  scenes: SceneSummary[];
}

export interface ClipSummary {
  id: ClipId;
  name: string;
  lengthBeats: number;
  looping: boolean;
  noteCount: number;
}

export interface ClipSlot {
  sceneId: SceneId;
  clip: ClipSummary | null;
}

export interface TrackDetail extends TrackSummary {
  slots: ClipSlot[];
}

export interface ClipDetail extends ClipSummary {
  trackId: TrackId;
  sceneId: SceneId;
  notes: Note[];
}
```

- [ ] **Step 5: Write src/port/live-port.ts**

```ts
import type {
  ClipDetail,
  ClipId,
  Note,
  SceneId,
  SceneSummary,
  SetSnapshot,
  SongPatch,
  TrackDetail,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
} from "./types.js";

/**
 * Everything the MCP server needs from Ableton Live.
 * Implemented by adapters/sdk-* (real Live, Plan 3) and adapters/fake (tests/dev).
 * Reads are synchronous and reflect Live's current state at call time.
 * Writes are async; callers group them into one undo step via transact().
 */
export interface LivePort {
  getSet(): SetSnapshot;
  getTrack(id: TrackId): TrackDetail;
  getClip(id: ClipId): ClipDetail;

  createTracks(specs: TrackSpec[]): Promise<TrackSummary[]>;
  updateTrack(id: TrackId, patch: TrackPatch): Promise<void>;
  deleteTracks(ids: TrackId[]): Promise<void>;
  createScenes(count: number): Promise<SceneSummary[]>;
  createMidiClip(
    trackId: TrackId,
    sceneId: SceneId,
    lengthBeats: number,
    notes: Note[],
    name?: string,
  ): Promise<ClipDetail>;
  replaceClipNotes(id: ClipId, notes: Note[]): Promise<void>;
  updateSong(patch: SongPatch): Promise<void>;

  /** Group all writes inside fn into one undo step named undoLabel. */
  transact<T>(undoLabel: string, fn: () => Promise<T>): Promise<T>;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run test/unit/port/errors.test.ts`
Expected: PASS (2 tests).
Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/port/ test/unit/port/
git commit -m "feat: port layer - DTOs, PortError, LivePort interface"
```

---

### Task 3: FakeLive — song, tracks, scenes

**Files:**

- Create: `src/adapters/fake/fake-live.ts`
- Test: `test/unit/adapters/fake-live.test.ts`

**Interfaces:**

- Consumes: `LivePort`, DTO types, `PortError` (Task 2).
- Produces: `class FakeLive implements LivePort` with `constructor()` (empty set: 0 tracks, 0 scenes, tempo 120, scaleName "Major", rootNote 0) and test-inspection field `readonly undoSteps: string[]` (labels of completed transactions, in order). Clip methods throw `UNSUPPORTED` until Task 4 replaces them.

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/fake-live.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { PortError } from "../../../src/port/errors.js";

describe("FakeLive tracks & scenes", () => {
  let fake: FakeLive;
  beforeEach(() => {
    fake = new FakeLive();
  });

  it("starts as an empty set", () => {
    const set = fake.getSet();
    expect(set.tempo).toBe(120);
    expect(set.tracks).toEqual([]);
    expect(set.scenes).toEqual([]);
  });

  it("creates tracks with minted sequential IDs and defaults", async () => {
    const created = await fake.createTracks([
      { type: "midi", name: "Drums" },
      { type: "audio" },
    ]);
    expect(created.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(created[0]).toMatchObject({
      name: "Drums",
      type: "midi",
      muted: false,
      soloed: false,
      armed: false,
      deviceNames: [],
      clipCount: 0,
    });
    expect(created[1].name).toBe("Audio 2"); // default name: "<Type> <n>"
    expect(fake.getSet().tracks).toHaveLength(2);
  });

  it("updates a track and rejects stale IDs", async () => {
    await fake.createTracks([{ type: "midi" }]);
    await fake.updateTrack("t1", { name: "Bass", muted: true });
    const t = fake.getTrack("t1");
    expect(t.name).toBe("Bass");
    expect(t.muted).toBe(true);

    await expect(fake.updateTrack("t99", { name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deletes tracks; deleted IDs are never reused", async () => {
    await fake.createTracks([{ type: "midi" }, { type: "midi" }]);
    await fake.deleteTracks(["t1"]);
    expect(fake.getSet().tracks.map((t) => t.id)).toEqual(["t2"]);
    expect(() => fake.getTrack("t1")).toThrow(PortError);
    const [t3] = await fake.createTracks([{ type: "midi" }]);
    expect(t3.id).toBe("t3");
  });

  it("creates scenes and updates tempo", async () => {
    const scenes = await fake.createScenes(2);
    expect(scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    await fake.updateSong({ tempo: 91.5 });
    expect(fake.getSet().tempo).toBe(91.5);
  });

  it("records one undo step per transact call", async () => {
    await fake.transact("create_tracks", () =>
      fake.createTracks([{ type: "midi" }, { type: "audio" }]),
    );
    expect(fake.undoSteps).toEqual(["create_tracks"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live.test.ts`
Expected: FAIL — cannot find module `src/adapters/fake/fake-live.js`.

- [ ] **Step 3: Write src/adapters/fake/fake-live.ts**

```ts
import { PortError } from "../../port/errors.js";
import type { LivePort } from "../../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  Note,
  SceneId,
  SceneSummary,
  SetSnapshot,
  SongPatch,
  TrackDetail,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
} from "../../port/types.js";

interface FakeClip {
  id: ClipId;
  name: string;
  lengthBeats: number;
  looping: boolean;
  notes: Note[];
}

interface FakeTrack {
  id: TrackId;
  name: string;
  type: "midi" | "audio";
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  /** session clip per scene */
  clips: Map<SceneId, FakeClip>;
}

interface FakeScene {
  id: SceneId;
  name: string;
}

/**
 * In-memory stand-in for Ableton Live. First-class LivePort implementation
 * used by component tests and the dev:fake loop. Mimics real-Live semantics
 * pinned by the contract tests (Plan 3). No rollback on mid-transact failure —
 * services enforce all-or-nothing by validating before mutating.
 */
export class FakeLive implements LivePort {
  private tracks: FakeTrack[] = [];
  private scenes: FakeScene[] = [];
  private tempo = 120;
  private scaleName = "Major";
  private rootNote = 0;
  private counters = { track: 0, scene: 0, clip: 0 };
  readonly undoSteps: string[] = [];

  // -- reads ----------------------------------------------------------------

  getSet(): SetSnapshot {
    return {
      tempo: this.tempo,
      scaleName: this.scaleName,
      rootNote: this.rootNote,
      tracks: this.tracks.map((t) => this.summarize(t)),
      scenes: this.scenes.map((s) => ({ ...s })),
    };
  }

  getTrack(id: TrackId): TrackDetail {
    const track = this.requireTrack(id);
    return {
      ...this.summarize(track),
      slots: this.scenes.map((scene) => {
        const clip = track.clips.get(scene.id);
        return { sceneId: scene.id, clip: clip ? this.summarizeClip(clip) : null };
      }),
    };
  }

  getClip(id: ClipId): ClipDetail {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    const { track, sceneId, clip } = found;
    return {
      ...this.summarizeClip(clip),
      trackId: track.id,
      sceneId,
      notes: clip.notes.map((n) => [...n] as Note),
    };
  }

  // -- writes ---------------------------------------------------------------

  async createTracks(specs: TrackSpec[]): Promise<TrackSummary[]> {
    return specs.map((spec) => {
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
      };
      this.tracks.push(track);
      return this.summarize(track);
    });
  }

  async updateTrack(id: TrackId, patch: TrackPatch): Promise<void> {
    const track = this.requireTrack(id);
    if (patch.name !== undefined) track.name = patch.name;
    if (patch.muted !== undefined) track.muted = patch.muted;
    if (patch.soloed !== undefined) track.soloed = patch.soloed;
    if (patch.armed !== undefined) track.armed = patch.armed;
  }

  async deleteTracks(ids: TrackId[]): Promise<void> {
    for (const id of ids) this.requireTrack(id);
    this.tracks = this.tracks.filter((t) => !ids.includes(t.id));
  }

  async createScenes(count: number): Promise<SceneSummary[]> {
    const created: SceneSummary[] = [];
    for (let i = 0; i < count; i++) {
      const id = `s${++this.counters.scene}`;
      const scene = { id, name: `Scene ${this.counters.scene}` };
      this.scenes.push(scene);
      created.push({ ...scene });
    }
    return created;
  }

  async createMidiClip(
    _trackId: TrackId,
    _sceneId: SceneId,
    _lengthBeats: number,
    _notes: Note[],
    _name?: string,
  ): Promise<ClipDetail> {
    throw new PortError("UNSUPPORTED", "createMidiClip not implemented yet");
  }

  async replaceClipNotes(_id: ClipId, _notes: Note[]): Promise<void> {
    throw new PortError("UNSUPPORTED", "replaceClipNotes not implemented yet");
  }

  async updateSong(patch: SongPatch): Promise<void> {
    if (patch.tempo !== undefined) this.tempo = patch.tempo;
  }

  async transact<T>(undoLabel: string, fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    this.undoSteps.push(undoLabel);
    return result;
  }

  // -- internals ------------------------------------------------------------

  private summarize(track: FakeTrack): TrackSummary {
    return {
      id: track.id,
      name: track.name,
      type: track.type,
      muted: track.muted,
      soloed: track.soloed,
      armed: track.armed,
      deviceNames: [],
      clipCount: track.clips.size,
    };
  }

  private summarizeClip(clip: FakeClip) {
    return {
      id: clip.id,
      name: clip.name,
      lengthBeats: clip.lengthBeats,
      looping: clip.looping,
      noteCount: clip.notes.length,
    };
  }

  protected requireTrack(id: TrackId): FakeTrack {
    const track = this.tracks.find((t) => t.id === id);
    if (!track) throw PortError.notFound("track", id);
    return track;
  }

  protected requireScene(id: SceneId): FakeScene {
    const scene = this.scenes.find((s) => s.id === id);
    if (!scene) throw PortError.notFound("scene", id);
    return scene;
  }

  protected findClip(
    id: ClipId,
  ): { track: FakeTrack; sceneId: SceneId; clip: FakeClip } | undefined {
    for (const track of this.tracks) {
      for (const [sceneId, clip] of track.clips) {
        if (clip.id === id) return { track, sceneId, clip };
      }
    }
    return undefined;
  }

  protected mintClipId(): ClipId {
    return `c${++this.counters.clip}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/adapters/fake-live.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/fake/ test/unit/adapters/
git commit -m "feat: FakeLive adapter - song, tracks, scenes"
```

---

### Task 4: FakeLive — MIDI clips and notes

**Files:**

- Modify: `src/adapters/fake/fake-live.ts` (replace the two `UNSUPPORTED` stubs)
- Test: `test/unit/adapters/fake-live-clips.test.ts`

**Interfaces:**

- Consumes: Task 3's `FakeLive` internals (`mintClipId`, `requireTrack`, `requireScene`, `findClip`).
- Produces: working `createMidiClip` / `replaceClipNotes` matching `LivePort`. Real-Live semantics mimicked: creating a clip in an occupied slot throws `CONFLICT`; creating on an audio track throws `INVALID_INPUT`; new clips default `looping: true`, name `""`.

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/fake-live-clips.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import type { Note } from "../../../src/port/types.js";

const KICK: Note[] = [
  [36, 0, 0.5, 100],
  [36, 1, 0.5, 100],
  [36, 2, 0.5, 100],
  [36, 3, 0.5, 100, { prob: 0.8 }],
];

describe("FakeLive MIDI clips", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }, { type: "audio" }]);
    await fake.createScenes(2);
  });

  it("creates a MIDI clip with notes in a session slot", async () => {
    const clip = await fake.createMidiClip("t1", "s1", 4, KICK, "Kick");
    expect(clip).toMatchObject({
      id: "c1",
      trackId: "t1",
      sceneId: "s1",
      name: "Kick",
      lengthBeats: 4,
      looping: true,
      noteCount: 4,
    });
    expect(fake.getClip("c1").notes).toEqual(KICK);
    expect(fake.getTrack("t1").slots[0].clip?.id).toBe("c1");
    expect(fake.getSet().tracks[0].clipCount).toBe(1);
  });

  it("rejects a clip in an occupied slot with CONFLICT", async () => {
    await fake.createMidiClip("t1", "s1", 4, []);
    await expect(fake.createMidiClip("t1", "s1", 4, [])).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects MIDI clips on audio tracks", async () => {
    await expect(fake.createMidiClip("t2", "s1", 4, [])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects unknown track and scene IDs", async () => {
    await expect(fake.createMidiClip("t9", "s1", 4, [])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(fake.createMidiClip("t1", "s9", 4, [])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("replaces notes wholesale", async () => {
    await fake.createMidiClip("t1", "s1", 4, KICK);
    const hats: Note[] = [[42, 0.5, 0.25, 70]];
    await fake.replaceClipNotes("c1", hats);
    expect(fake.getClip("c1").notes).toEqual(hats);
    await expect(fake.replaceClipNotes("c9", hats)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleting a track removes its clips", async () => {
    await fake.createMidiClip("t1", "s1", 4, KICK);
    await fake.deleteTracks(["t1"]);
    expect(() => fake.getClip("c1")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-clips.test.ts`
Expected: FAIL — `UNSUPPORTED createMidiClip not implemented yet`.

- [ ] **Step 3: Replace the two stubs in src/adapters/fake/fake-live.ts**

Replace `createMidiClip` and `replaceClipNotes` with:

```ts
  async createMidiClip(
    trackId: TrackId,
    sceneId: SceneId,
    lengthBeats: number,
    notes: Note[],
    name?: string,
  ): Promise<ClipDetail> {
    const track = this.requireTrack(trackId);
    this.requireScene(sceneId);
    if (track.type !== "midi") {
      throw new PortError(
        "INVALID_INPUT",
        `track ${trackId} is an audio track`,
        "MIDI clips can only be created on MIDI tracks.",
      );
    }
    if (track.clips.has(sceneId)) {
      throw new PortError(
        "CONFLICT",
        `slot ${trackId}/${sceneId} already has a clip`,
        "Delete the existing clip first, or pick an empty slot (see get_track).",
      );
    }
    const clip: FakeClip = {
      id: this.mintClipId(),
      name: name ?? "",
      lengthBeats,
      looping: true,
      notes: notes.map((n) => [...n] as Note),
    };
    track.clips.set(sceneId, clip);
    return this.getClip(clip.id);
  }

  async replaceClipNotes(id: ClipId, notes: Note[]): Promise<void> {
    const found = this.findClip(id);
    if (!found) throw PortError.notFound("clip", id);
    found.clip.notes = notes.map((n) => [...n] as Note);
  }
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS — all suites (scaffold, port, both fake-live suites).

- [ ] **Step 5: Commit**

```bash
git add src/adapters/fake/fake-live.ts test/unit/adapters/fake-live-clips.test.ts
git commit -m "feat: FakeLive MIDI clips and wholesale note replacement"
```

---

### Task 5: Domain services — validation and undo-step policy

**Files:**

- Create: `src/domain/set-inspector.ts`, `src/domain/track-service.ts`, `src/domain/clip-editor.ts`, `src/domain/song-service.ts`, `src/domain/notes.ts`
- Test: `test/unit/domain/services.test.ts`

**Interfaces:**

- Consumes: `LivePort`, DTOs, `PortError`, `FakeLive` (as test double).
- Produces (consumed by MCP tools in Task 7):
  - `class SetInspector { constructor(live: LivePort); getSet(): SetSnapshot; getTrack(id: TrackId): TrackDetail; getClip(id: ClipId): ClipDetail }`
  - `class TrackService { constructor(live: LivePort); createTracks(specs: TrackSpec[]): Promise<TrackSummary[]>; updateTrack(id: TrackId, patch: TrackPatch): Promise<TrackSummary>; deleteTracks(ids: TrackId[]): Promise<void>; createScenes(count: number): Promise<SceneSummary[]> }`
  - `class ClipEditor { constructor(live: LivePort); createMidiClip(input: { trackId: TrackId; sceneId: SceneId; lengthBeats: number; notes: Note[]; name?: string }): Promise<ClipDetail>; replaceClipNotes(clipId: ClipId, notes: Note[]): Promise<ClipDetail> }`
  - `class SongService { constructor(live: LivePort); updateSong(patch: SongPatch): Promise<void> }`
  - `function validateNotes(notes: Note[]): void` (throws `PortError INVALID_INPUT` naming the offending note index)

- [ ] **Step 1: Write the failing tests**

`test/unit/domain/services.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import { validateNotes } from "../../../src/domain/notes.js";
import { SongService } from "../../../src/domain/song-service.js";
import { TrackService } from "../../../src/domain/track-service.js";
import type { Note } from "../../../src/port/types.js";

describe("validateNotes", () => {
  it("accepts valid notes with extras", () => {
    expect(() =>
      validateNotes([
        [60, 0, 1, 100],
        [61, 0.5, 0.25, 1, { prob: 0.5 }],
      ]),
    ).not.toThrow();
  });

  it.each([
    [[[-1, 0, 1, 100]] as Note[], "pitch"],
    [[[128, 0, 1, 100]] as Note[], "pitch"],
    [[[60, -0.5, 1, 100]] as Note[], "start"],
    [[[60, 0, 0, 100]] as Note[], "duration"],
    [[[60, 0, 1, 0]] as Note[], "velocity"],
    [[[60, 0, 1, 128]] as Note[], "velocity"],
  ])("rejects %j mentioning %s and the note index", (notes, field) => {
    expect(() => validateNotes(notes)).toThrowError(
      expect.objectContaining({
        code: "INVALID_INPUT",
        message: expect.stringContaining("note 0"),
      }),
    );
    expect(() => validateNotes(notes)).toThrowError(
      expect.objectContaining({ message: expect.stringContaining(field) }),
    );
  });
});

describe("services undo policy", () => {
  let fake: FakeLive;
  let tracks: TrackService;
  let clips: ClipEditor;
  let song: SongService;

  beforeEach(() => {
    fake = new FakeLive();
    tracks = new TrackService(fake);
    clips = new ClipEditor(fake);
    song = new SongService(fake);
  });

  it("each write is exactly one named undo step", async () => {
    await tracks.createTracks([{ type: "midi" }]);
    await tracks.createScenes(1);
    await clips.createMidiClip({
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [[60, 0, 1, 100]],
    });
    await clips.replaceClipNotes("c1", [[62, 0, 1, 90]]);
    await song.updateSong({ tempo: 130 });
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "create_scenes",
      "create_midi_clip",
      "replace_clip_notes",
      "update_song",
    ]);
  });

  it("deleteTracks is all-or-nothing: one stale ID mutates nothing", async () => {
    await tracks.createTracks([{ type: "midi" }, { type: "midi" }]);
    await expect(tracks.deleteTracks(["t1", "t99"])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fake.getSet().tracks).toHaveLength(2);
    expect(fake.undoSteps).toEqual(["create_tracks"]);
  });

  it("rejects empty batches and bad counts without touching the port", async () => {
    await expect(tracks.createTracks([])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(tracks.createScenes(0)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual([]);
  });

  it("validates notes before creating a clip (no half-created clip)", async () => {
    await tracks.createTracks([{ type: "midi" }]);
    await tracks.createScenes(1);
    await expect(
      clips.createMidiClip({
        trackId: "t1",
        sceneId: "s1",
        lengthBeats: 4,
        notes: [[200, 0, 1, 100]],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.getTrack("t1").slots[0].clip).toBeNull();
  });

  it("rejects out-of-range tempo", async () => {
    await expect(song.updateSong({ tempo: 5 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("updateTrack returns the fresh summary", async () => {
    await tracks.createTracks([{ type: "midi" }]);
    const t = await tracks.updateTrack("t1", { name: "Lead" });
    expect(t.name).toBe("Lead");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/domain/services.test.ts`
Expected: FAIL — cannot find module `src/domain/...`.

- [ ] **Step 3: Write src/domain/notes.ts**

```ts
import { PortError } from "../port/errors.js";
import type { Note } from "../port/types.js";

const HINT =
  "Notes are [pitch 0-127, startBeat >= 0, durationBeats > 0, velocity 1-127, extras?].";

export function validateNotes(notes: Note[]): void {
  notes.forEach((note, i) => {
    const [pitch, start, duration, velocity] = note;
    if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) {
      throw new PortError(
        "INVALID_INPUT",
        `note ${i}: pitch ${pitch} out of range`,
        HINT,
      );
    }
    if (!(start >= 0)) {
      throw new PortError(
        "INVALID_INPUT",
        `note ${i}: start ${start} must be >= 0`,
        HINT,
      );
    }
    if (!(duration > 0)) {
      throw new PortError(
        "INVALID_INPUT",
        `note ${i}: duration ${duration} must be > 0`,
        HINT,
      );
    }
    if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) {
      throw new PortError(
        "INVALID_INPUT",
        `note ${i}: velocity ${velocity} out of range`,
        HINT,
      );
    }
  });
}
```

- [ ] **Step 4: Write src/domain/set-inspector.ts**

```ts
import type { LivePort } from "../port/live-port.js";
import type {
  ClipDetail,
  ClipId,
  SetSnapshot,
  TrackDetail,
  TrackId,
} from "../port/types.js";

export class SetInspector {
  constructor(private readonly live: LivePort) {}

  getSet(): SetSnapshot {
    return this.live.getSet();
  }

  getTrack(id: TrackId): TrackDetail {
    return this.live.getTrack(id);
  }

  getClip(id: ClipId): ClipDetail {
    return this.live.getClip(id);
  }
}
```

- [ ] **Step 5: Write src/domain/track-service.ts**

```ts
import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type {
  SceneSummary,
  TrackId,
  TrackPatch,
  TrackSpec,
  TrackSummary,
} from "../port/types.js";

export class TrackService {
  constructor(private readonly live: LivePort) {}

  // All write methods are async so validation throws surface as rejected
  // promises, matching how callers and tests consume them.
  async createTracks(specs: TrackSpec[]): Promise<TrackSummary[]> {
    if (specs.length === 0) {
      throw new PortError("INVALID_INPUT", "specs must not be empty");
    }
    return this.live.transact("create_tracks", () => this.live.createTracks(specs));
  }

  async updateTrack(id: TrackId, patch: TrackPatch): Promise<TrackSummary> {
    this.live.getTrack(id); // fail fast on stale ID before mutating
    await this.live.transact("update_track", () => this.live.updateTrack(id, patch));
    return this.live.getTrack(id);
  }

  async deleteTracks(ids: TrackId[]): Promise<void> {
    if (ids.length === 0) {
      throw new PortError("INVALID_INPUT", "ids must not be empty");
    }
    for (const id of ids) this.live.getTrack(id); // all-or-nothing
    return this.live.transact("delete_tracks", () => this.live.deleteTracks(ids));
  }

  async createScenes(count: number): Promise<SceneSummary[]> {
    if (!Number.isInteger(count) || count < 1 || count > 64) {
      throw new PortError("INVALID_INPUT", `count ${count} must be an integer 1-64`);
    }
    return this.live.transact("create_scenes", () => this.live.createScenes(count));
  }
}
```

- [ ] **Step 6: Write src/domain/clip-editor.ts**

```ts
import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { ClipDetail, ClipId, Note, SceneId, TrackId } from "../port/types.js";
import { validateNotes } from "./notes.js";

export interface CreateMidiClipInput {
  trackId: TrackId;
  sceneId: SceneId;
  lengthBeats: number;
  notes: Note[];
  name?: string;
}

export class ClipEditor {
  constructor(private readonly live: LivePort) {}

  async createMidiClip(input: CreateMidiClipInput): Promise<ClipDetail> {
    if (!(input.lengthBeats > 0)) {
      throw new PortError(
        "INVALID_INPUT",
        `lengthBeats ${input.lengthBeats} must be > 0`,
      );
    }
    validateNotes(input.notes);
    return this.live.transact("create_midi_clip", () =>
      this.live.createMidiClip(
        input.trackId,
        input.sceneId,
        input.lengthBeats,
        input.notes,
        input.name,
      ),
    );
  }

  async replaceClipNotes(clipId: ClipId, notes: Note[]): Promise<ClipDetail> {
    this.live.getClip(clipId); // fail fast on stale ID
    validateNotes(notes);
    await this.live.transact("replace_clip_notes", () =>
      this.live.replaceClipNotes(clipId, notes),
    );
    return this.live.getClip(clipId);
  }
}
```

- [ ] **Step 7: Write src/domain/song-service.ts**

```ts
import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { SongPatch } from "../port/types.js";

export class SongService {
  constructor(private readonly live: LivePort) {}

  async updateSong(patch: SongPatch): Promise<void> {
    if (patch.tempo !== undefined && (patch.tempo < 20 || patch.tempo > 999)) {
      throw new PortError("INVALID_INPUT", `tempo ${patch.tempo} must be 20-999 BPM`);
    }
    return this.live.transact("update_song", () => this.live.updateSong(patch));
  }
}
```

- [ ] **Step 8: Run tests**

Run: `npx vitest run test/unit/domain/services.test.ts`
Expected: PASS. Then run `npm test` — all suites pass.

- [ ] **Step 9: Commit**

```bash
git add src/domain/ test/unit/domain/
git commit -m "feat: domain services - validation and one-undo-step-per-write policy"
```

---

### Task 6: Tool result envelope

**Files:**

- Create: `src/mcp/envelope.ts`
- Test: `test/unit/mcp/envelope.test.ts`

**Interfaces:**

- Consumes: `PortError`, `PortErrorCode`.
- Produces (used by Task 7):
  - `type ToolResult = ({ ok: true } & Record<string, unknown>) | { ok: false; code: PortErrorCode; message: string; hint?: string }`
  - `async function runTool(fn: () => Promise<unknown>): Promise<ToolResult>` — wraps a handler; `PortError` → structured failure; any other throw → `INTERNAL` with generic message; success value (object) spread into `{ ok: true, ...value }`.

- [ ] **Step 1: Write the failing tests**

`test/unit/mcp/envelope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PortError } from "../../../src/port/errors.js";
import { runTool } from "../../../src/mcp/envelope.js";

describe("runTool", () => {
  it("spreads a successful object result into ok envelope", async () => {
    const result = await runTool(async () => ({ track: { id: "t1" } }));
    expect(result).toEqual({ ok: true, track: { id: "t1" } });
  });

  it("maps PortError to a structured failure with hint", async () => {
    const result = await runTool(async () => {
      throw PortError.notFound("track", "t9");
    });
    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "track t9 not found",
      hint: expect.stringContaining("get_set"),
    });
  });

  it("maps unexpected errors to INTERNAL without leaking details", async () => {
    const result = await runTool(async () => {
      throw new Error("secret stack detail");
    });
    expect(result).toMatchObject({ ok: false, code: "INTERNAL" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("also catches synchronous PortError throws", async () => {
    const result = await runTool(() => {
      throw new PortError("INVALID_INPUT", "bad");
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/mcp/envelope.test.ts`
Expected: FAIL — cannot find module `src/mcp/envelope.js`.

- [ ] **Step 3: Write src/mcp/envelope.ts**

```ts
import { PortError, type PortErrorCode } from "../port/errors.js";

export type ToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: PortErrorCode; message: string; hint?: string };

/**
 * Robustness boundary: tools never throw to the client. PortErrors become
 * structured, self-correcting failures; anything else becomes INTERNAL with
 * a generic message (details belong in the audit log, Plan 3).
 */
export async function runTool(fn: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    const value = await fn();
    return { ok: true, ...(value as Record<string, unknown>) };
  } catch (error) {
    if (error instanceof PortError) {
      return {
        ok: false,
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      };
    }
    console.error("[ableton-mcp] internal tool error:", error);
    return {
      ok: false,
      code: "INTERNAL",
      message: "Internal error while executing the tool.",
      hint: "This is a bug in the extension, not in your request. Try a different approach.",
    };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/mcp/envelope.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/envelope.ts test/unit/mcp/
git commit -m "feat: tool result envelope - structured errors, no throws to client"
```

---

### Task 7: Tool registry and MCP server factory

**Files:**

- Create: `src/mcp/tools/types.ts`, `src/mcp/tools/schemas.ts`, `src/mcp/tools/set.ts`, `src/mcp/tools/tracks.ts`, `src/mcp/tools/clips.ts`, `src/mcp/tools/index.ts`, `src/mcp/server.ts`
- Test: `test/unit/mcp/server.test.ts`

**Interfaces:**

- Consumes: domain services (Task 5), `runTool`/`ToolResult` (Task 6).
- Produces:
  - `interface ToolDeps { inspector: SetInspector; tracks: TrackService; clips: ClipEditor; song: SongService }`
  - `interface ToolDef { name: string; description: string; inputSchema: ZodRawShape; handler(args: Record<string, unknown>, deps: ToolDeps): Promise<unknown> }`
  - `const allTools: ToolDef[]` (10 tools)
  - `function createMcpServer(deps: ToolDeps): McpServer` — used per-request by the HTTP layer (Task 8) and by `dev:fake` (Task 10). Tool responses: `content[0].text` = `JSON.stringify(ToolResult)`, `isError` = `!result.ok`.

- [ ] **Step 1: Write the failing tests**

`test/unit/mcp/server.test.ts` (uses the MCP SDK's in-memory transport — no HTTP yet):

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import { SetInspector } from "../../../src/domain/set-inspector.js";
import { SongService } from "../../../src/domain/song-service.js";
import { TrackService } from "../../../src/domain/track-service.js";
import { createMcpServer } from "../../../src/mcp/server.js";
import type { ToolDeps } from "../../../src/mcp/tools/types.js";

function buildDeps(fake: FakeLive): ToolDeps {
  return {
    inspector: new SetInspector(fake),
    tracks: new TrackService(fake),
    clips: new ClipEditor(fake),
    song: new SongService(fake),
  };
}

async function connect(fake: FakeLive): Promise<Client> {
  const server = createMcpServer(buildDeps(fake));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  return { payload: JSON.parse(res.content[0].text), isError: res.isError ?? false };
}

describe("MCP server over in-memory transport", () => {
  let fake: FakeLive;
  let client: Client;

  beforeEach(async () => {
    fake = new FakeLive();
    client = await connect(fake);
  });

  it("lists the 10 v1 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "create_midi_clip",
        "create_scenes",
        "create_tracks",
        "delete_tracks",
        "get_clip",
        "get_set",
        "get_track",
        "replace_clip_notes",
        "update_song",
        "update_track",
      ].sort(),
    );
  });

  it("get_set returns the snapshot in an ok envelope", async () => {
    const { payload, isError } = await call(client, "get_set");
    expect(isError).toBe(false);
    expect(payload.ok).toBe(true);
    expect(payload.set.tempo).toBe(120);
  });

  it("create_tracks → create_scenes → create_midi_clip round-trip", async () => {
    await call(client, "create_tracks", { tracks: [{ type: "midi", name: "Drums" }] });
    await call(client, "create_scenes", { count: 1 });
    const { payload } = await call(client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [[36, 0, 0.5, 100]],
      name: "Kick",
    });
    expect(payload.ok).toBe(true);
    expect(payload.clip.id).toBe("c1");
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "create_scenes",
      "create_midi_clip",
    ]);
  });

  it("stale ID surfaces as structured NOT_FOUND with isError", async () => {
    const { payload, isError } = await call(client, "get_track", { trackId: "t9" });
    expect(isError).toBe(true);
    expect(payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(payload.hint).toContain("get_set");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/mcp/server.test.ts`
Expected: FAIL — cannot find module `src/mcp/server.js`.

- [ ] **Step 3: Write src/mcp/tools/types.ts**

```ts
import type { ZodRawShape } from "zod";
import type { ClipEditor } from "../../domain/clip-editor.js";
import type { SetInspector } from "../../domain/set-inspector.js";
import type { SongService } from "../../domain/song-service.js";
import type { TrackService } from "../../domain/track-service.js";

export interface ToolDeps {
  inspector: SetInspector;
  tracks: TrackService;
  clips: ClipEditor;
  song: SongService;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler(args: Record<string, unknown>, deps: ToolDeps): Promise<unknown>;
}
```

- [ ] **Step 4: Write src/mcp/tools/schemas.ts**

```ts
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
```

- [ ] **Step 5: Write src/mcp/tools/set.ts**

```ts
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
```

- [ ] **Step 6: Write src/mcp/tools/tracks.ts**

```ts
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
    description:
      "Append N scenes (1-64) to the set. Returns the created scenes with IDs.",
    inputSchema: { count: z.number().int().min(1).max(64) },
    handler: async (args, deps) => ({
      scenes: await deps.tracks.createScenes(args.count as number),
    }),
  },
];
```

- [ ] **Step 7: Write src/mcp/tools/clips.ts**

```ts
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
```

- [ ] **Step 8: Write src/mcp/tools/index.ts**

```ts
import { clipTools } from "./clips.js";
import { setTools } from "./set.js";
import { trackTools } from "./tracks.js";
import type { ToolDef } from "./types.js";

export const allTools: ToolDef[] = [...setTools, ...trackTools, ...clipTools];
```

- [ ] **Step 9: Write src/mcp/server.ts**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runTool } from "./envelope.js";
import { allTools } from "./tools/index.js";
import type { ToolDeps } from "./tools/types.js";

/**
 * Builds a fresh McpServer wired to the given services. The HTTP layer creates
 * one per request (stateless Streamable HTTP); dev:fake creates one per session.
 */
export function createMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "ableton-live", version: "0.1.0" });
  for (const tool of allTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      async (args: Record<string, unknown>) => {
        const result = await runTool(() => tool.handler(args ?? {}, deps));
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: result.ok === false,
        };
      },
    );
  }
  return server;
}
```

Note: if the installed `@modelcontextprotocol/sdk` version's `registerTool` signature differs (older versions use `server.tool(name, schema, handler)`), adapt to the installed version — check `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`. Do not downgrade the envelope contract.

- [ ] **Step 10: Run tests**

Run: `npx vitest run test/unit/mcp/server.test.ts`
Expected: PASS (4 tests). Then `npm run typecheck` — exit 0.

- [ ] **Step 11: Commit**

```bash
git add src/mcp/ test/unit/mcp/server.test.ts
git commit -m "feat: MCP tool registry and server factory (10 v1 tools)"
```

---

### Task 8: Streamable HTTP transport with auth

**Files:**

- Create: `src/mcp/http.ts`
- Test: `test/component/http-auth.test.ts`

**Interfaces:**

- Consumes: `createMcpServer` (Task 7).
- Produces (used by Tasks 9-10):
  - `interface HttpOptions { port: number; token: string; createServer(): McpServer }`
  - `async function startHttpServer(opts: HttpOptions): Promise<{ port: number; url: string; close(): Promise<void> }>` — binds 127.0.0.1; `url` is `http://127.0.0.1:<port>/mcp`. Port 0 lets the OS pick (tests use this).
  - Security: 401 on missing/wrong `Authorization: Bearer <token>`; 403 on non-localhost `Host` or `Origin`; only `/mcp` path served (404 otherwise).

- [ ] **Step 1: Write the failing tests**

`test/component/http-auth.test.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../src/domain/clip-editor.js";
import { SetInspector } from "../../src/domain/set-inspector.js";
import { SongService } from "../../src/domain/song-service.js";
import { TrackService } from "../../src/domain/track-service.js";
import { startHttpServer } from "../../src/mcp/http.js";
import { createMcpServer } from "../../src/mcp/server.js";

const TOKEN = "test-token-123";

function makeServerFactory(fake: FakeLive) {
  return () =>
    createMcpServer({
      inspector: new SetInspector(fake),
      tracks: new TrackService(fake),
      clips: new ClipEditor(fake),
      song: new SongService(fake),
    });
}

describe("HTTP transport", () => {
  let fake: FakeLive;
  let server: Awaited<ReturnType<typeof startHttpServer>>;

  beforeEach(async () => {
    fake = new FakeLive();
    server = await startHttpServer({
      port: 0,
      token: TOKEN,
      createServer: makeServerFactory(fake),
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it("serves an MCP client end-to-end with the right token", async () => {
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.length).toBe(10);
    await client.close();
  });

  it("rejects a missing token with 401", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token with 401", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-localhost Origin with 403 (DNS-rebinding defense)", async () => {
    const res = await fetch(server.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Origin: "https://evil.example.com",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(403);
  });

  it("404s unknown paths", async () => {
    const base = server.url.replace(/\/mcp$/, "/other");
    const res = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/component/http-auth.test.ts`
Expected: FAIL — cannot find module `src/mcp/http.js`.

- [ ] **Step 3: Write src/mcp/http.ts**

```ts
import {
  createServer as createNodeServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface HttpOptions {
  /** 0 = let the OS pick (tests). Production default: 20808. */
  port: number;
  token: string;
  createServer(): McpServer;
}

export interface RunningHttpServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

function isLocal(value: string): boolean {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    return (
      LOCAL_HOSTS.includes(url.hostname) || LOCAL_HOSTS.includes(`[${url.hostname}]`)
    );
  } catch {
    return false;
  }
}

function deny(res: ServerResponse, status: number, message: string): void {
  res
    .writeHead(status, { "Content-Type": "application/json" })
    .end(JSON.stringify({ error: message }));
}

/**
 * Stateless Streamable HTTP endpoint at /mcp, bound to 127.0.0.1 only.
 * Security (P2, per spec §7): loopback bind, Host/Origin validation, bearer token.
 */
export async function startHttpServer(opts: HttpOptions): Promise<RunningHttpServer> {
  const httpServer = createNodeServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const host = req.headers.host ?? "";
        const origin = req.headers.origin;
        if (!isLocal(host) || (origin !== undefined && !isLocal(origin))) {
          return deny(res, 403, "Forbidden: localhost only");
        }
        if (req.headers.authorization !== `Bearer ${opts.token}`) {
          return deny(res, 401, "Unauthorized: missing or invalid bearer token");
        }
        const url = new URL(req.url ?? "/", `http://${host}`);
        if (url.pathname !== "/mcp") {
          return deny(res, 404, "Not found");
        }

        // Stateless mode: fresh server + transport per request avoids session state.
        const mcpServer = opts.createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on("close", () => {
          void transport.close();
          void mcpServer.close();
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        console.error("[ableton-mcp] http error:", error);
        if (!res.headersSent) deny(res, 500, "Internal server error");
      }
    },
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(opts.port, "127.0.0.1", resolve);
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : opts.port;

  return {
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
```

Note: if `transport.handleRequest(req, res)` in the installed SDK version requires a pre-parsed body for POST, read the body first (`const chunks = []; for await (const c of req) chunks.push(c);` then `JSON.parse(Buffer.concat(chunks).toString())`) and pass it as the third argument. Check `node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.d.ts`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/component/http-auth.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/mcp/http.ts test/component/http-auth.test.ts
git commit -m "feat: Streamable HTTP transport - loopback only, origin check, bearer auth"
```

---

### Task 9: Component scenarios — build-a-beat, token budget, undo trail

**Files:**

- Create: `test/component/helpers.ts`, `test/component/build-a-beat.test.ts`, `test/component/token-budget.test.ts`

**Interfaces:**

- Consumes: everything (Tasks 3-8). This is the CI gate from spec §8.2.
- Produces: `test/component/helpers.ts` with `startTestStack()` and `callTool()` — reused by all future component tests (Plans 2-3).

- [ ] **Step 1: Write test/component/helpers.ts**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../src/domain/clip-editor.js";
import { SetInspector } from "../../src/domain/set-inspector.js";
import { SongService } from "../../src/domain/song-service.js";
import { TrackService } from "../../src/domain/track-service.js";
import { startHttpServer, type RunningHttpServer } from "../../src/mcp/http.js";
import { createMcpServer } from "../../src/mcp/server.js";

export const TEST_TOKEN = "component-test-token";

export interface TestStack {
  fake: FakeLive;
  server: RunningHttpServer;
  client: Client;
  close(): Promise<void>;
}

/** Full stack: real MCP client → real HTTP → real tools → real services → FakeLive. */
export async function startTestStack(fake = new FakeLive()): Promise<TestStack> {
  const server = await startHttpServer({
    port: 0,
    token: TEST_TOKEN,
    createServer: () =>
      createMcpServer({
        inspector: new SetInspector(fake),
        tracks: new TrackService(fake),
        clips: new ClipEditor(fake),
        song: new SongService(fake),
      }),
  });
  const client = new Client({ name: "component-test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(server.url), {
      requestInit: { headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
    }),
  );
  return {
    fake,
    server,
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ payload: any; isError: boolean; bytes: number }> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = res.content[0].text;
  return { payload: JSON.parse(text), isError: res.isError ?? false, bytes: text.length };
}
```

- [ ] **Step 2: Write the build-a-beat scenario test**

`test/component/build-a-beat.test.ts` (acceptance scenario 1, minus devices — devices arrive in Plan 2):

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Note } from "../../src/port/types.js";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

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

describe("scenario: AI builds a beat from an empty set", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack();
  });
  afterEach(async () => {
    await stack.close();
  });

  it("creates tracks, scenes, clips with notes, and sets the tempo", async () => {
    const { client, fake } = stack;

    const created = await callTool(client, "create_tracks", {
      tracks: [
        { type: "midi", name: "Drums" },
        { type: "midi", name: "Bass" },
      ],
    });
    expect(created.payload.ok).toBe(true);
    const [drums, bass] = created.payload.tracks;

    await callTool(client, "create_scenes", { count: 2 });
    await callTool(client, "update_song", { tempo: 124 });

    const drumClip = await callTool(client, "create_midi_clip", {
      trackId: drums.id,
      sceneId: "s1",
      lengthBeats: 4,
      notes: DRUMS,
      name: "Beat A",
    });
    expect(drumClip.payload.ok).toBe(true);

    const bassClip = await callTool(client, "create_midi_clip", {
      trackId: bass.id,
      sceneId: "s1",
      lengthBeats: 4,
      notes: BASS,
      name: "Bassline",
    });
    expect(bassClip.payload.ok).toBe(true);

    // the set reflects everything
    const { payload: setPayload } = await callTool(client, "get_set");
    expect(setPayload.set.tempo).toBe(124);
    expect(setPayload.set.tracks).toHaveLength(2);
    expect(setPayload.set.tracks[0]).toMatchObject({ name: "Drums", clipCount: 1 });

    // notes round-trip exactly
    const { payload: clipPayload } = await callTool(client, "get_clip", {
      clipId: drumClip.payload.clip.id,
    });
    expect(clipPayload.clip.notes).toEqual(DRUMS);

    // data safety: one undo step per write tool call, named after the tool
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "create_scenes",
      "update_song",
      "create_midi_clip",
      "create_midi_clip",
    ]);
  });

  it("recovers from a stale ID mid-flow", async () => {
    const { client } = stack;
    await callTool(client, "create_tracks", { tracks: [{ type: "midi" }] });
    await callTool(client, "create_scenes", { count: 1 });
    await callTool(client, "delete_tracks", { trackIds: ["t1"] });

    const stale = await callTool(client, "create_midi_clip", {
      trackId: "t1",
      sceneId: "s1",
      lengthBeats: 4,
      notes: [],
    });
    expect(stale.isError).toBe(true);
    expect(stale.payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(stale.payload.hint).toContain("get_set");
  });
});
```

- [ ] **Step 3: Write the token-budget test**

`test/component/token-budget.test.ts` (spec §8.2 budget: 50-track fixture, `get_set` < 8192 bytes):

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../src/adapters/fake/fake-live.js";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

async function bigFixture(): Promise<FakeLive> {
  const fake = new FakeLive();
  await fake.createScenes(8);
  for (let i = 0; i < 50; i++) {
    const [track] = await fake.createTracks([
      { type: "midi", name: `Track ${i + 1} Synth Layer` },
    ]);
    for (let s = 1; s <= 4; s++) {
      await fake.createMidiClip(track.id, `s${s}`, 4, [
        [60, 0, 1, 100],
        [64, 1, 1, 100],
        [67, 2, 1, 100],
      ]);
    }
  }
  return fake;
}

describe("token economy budgets (P0)", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack(await bigFixture());
  });
  afterEach(async () => {
    await stack.close();
  });

  it("get_set on a 50-track / 8-scene / 200-clip set stays under 8 KB", async () => {
    const { bytes, payload } = await callTool(stack.client, "get_set");
    expect(payload.set.tracks).toHaveLength(50);
    expect(bytes).toBeLessThan(8192);
  });

  it("get_track stays under 4 KB and does not inline note data", async () => {
    const { bytes, payload } = await callTool(stack.client, "get_track", {
      trackId: "t1",
    });
    expect(payload.track.slots).toHaveLength(8);
    expect(bytes).toBeLessThan(4096);
    expect(JSON.stringify(payload)).not.toContain('"notes"');
  });
});
```

- [ ] **Step 4: Run the component suite**

Run: `npx vitest run test/component/`
Expected: PASS (all files). If the token-budget test fails, trim the DTOs (that is the test doing its job — shrink `get_set` output, do not raise the budget).

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add test/component/
git commit -m "test: component scenarios - build-a-beat, stale-ID recovery, token budgets"
```

---

### Task 10: dev:fake loop and docs update

**Files:**

- Create: `src/dev/fake-server.ts`
- Modify: `README.md` (Status section), `docs/capability-map.md` (MCP exposure table)

**Interfaces:**

- Consumes: `startTestStack`-style wiring (but with a fixed port and generated token).
- Produces: `npm run dev:fake` — a running MCP endpoint a real Claude client can use, no Ableton needed.

- [ ] **Step 1: Write src/dev/fake-server.ts**

```ts
import { randomUUID } from "node:crypto";
import { FakeLive } from "../adapters/fake/fake-live.js";
import { ClipEditor } from "../domain/clip-editor.js";
import { SetInspector } from "../domain/set-inspector.js";
import { SongService } from "../domain/song-service.js";
import { TrackService } from "../domain/track-service.js";
import { startHttpServer } from "../mcp/http.js";
import { createMcpServer } from "../mcp/server.js";

/** Dev loop: the real MCP server against FakeLive — no Ableton required. */
async function main(): Promise<void> {
  const fake = new FakeLive();
  await fake.createScenes(4);
  await fake.createTracks([
    { type: "midi", name: "Drums" },
    { type: "midi", name: "Bass" },
    { type: "audio", name: "Vocals" },
  ]);
  await fake.createMidiClip(
    "t1",
    "s1",
    4,
    [
      [36, 0, 0.5, 100],
      [38, 1, 0.5, 100],
      [36, 2, 0.5, 100],
      [38, 3, 0.5, 100],
    ],
    "Demo Beat",
  );

  const token = process.env.ABLETON_MCP_TOKEN ?? randomUUID();
  const server = await startHttpServer({
    port: Number(process.env.ABLETON_MCP_PORT ?? 20808),
    token,
    createServer: () =>
      createMcpServer({
        inspector: new SetInspector(fake),
        tracks: new TrackService(fake),
        clips: new ClipEditor(fake),
        song: new SongService(fake),
      }),
  });

  console.log(`[ableton-mcp] FakeLive MCP server running at ${server.url}`);
  console.log(`[ableton-mcp] Connect Claude Code with:`);
  console.log(
    `  claude mcp add --transport http ableton ${server.url} --header "Authorization: Bearer ${token}"`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it runs**

Run: `npm run dev:fake` (then Ctrl-C)
Expected output: the two log lines with a URL like `http://127.0.0.1:20808/mcp` and a `claude mcp add` command. Optionally verify with a second terminal:
`curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:20808/mcp` → `401`.

- [ ] **Step 3: Update README.md Status section**

Replace the line `**Design phase.** No shippable extension yet.` with:

```markdown
**Foundation phase.** The MCP server core (10 tools) runs against an in-memory
FakeLive — try it with `npm run dev:fake`. The real Ableton adapter and the
installable extension are in progress (see `docs/plans/`).
```

- [ ] **Step 4: Update docs/capability-map.md MCP exposure table**

In the "MCP exposure status" table, split the v1 rows into shipped vs pending — change the Status column to `v1 (implemented)` for: set overview/drill-down (`get_set`, `get_track`, `get_clip`), track CRUD (`create_tracks`, `update_track`, `delete_tracks`), `create_scenes`, `create_midi_clip`, `replace_clip_notes`, `update_song`. Leave the remaining v1 tools (`create_audio_clip`, `update_clip`, `delete_clips`, `edit_clip_notes`, `update_scene`, `delete_scenes`, devices, mixer) as `v1 (planned — Plan 2)`.

- [ ] **Step 5: Full verification**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/dev/ README.md docs/capability-map.md
git commit -m "feat: dev:fake loop - real MCP endpoint against FakeLive, no Ableton needed"
```

---

## Post-plan checklist

- All 10 tasks committed; `npm test` green; `npm run typecheck` green.
- `npm run dev:fake` produces a connectable MCP endpoint (manually verified with Claude Code once).
- Next: write Plan 2 (full tool surface) against the now-real codebase.
