# Plan 3: SDK Adapter, Extension Shell, Packaging, Smoke Suite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 21-tool MCP server run inside real Ableton Live: a `LivePort` adapter over `@ableton-extensions/sdk`, the extension shell (activate, config, status dialog, audit log), esbuild → `.ablx` packaging, and built-in self-test smoke commands with a runbook (in-Live execution deferred until Live beta is installed).

**Architecture:** The SDK stays local-only (repo goes public soon; Ableton beta terms): tarballs live in gitignored `references/`, installed by `npm run setup:sdk` with `--no-save`. The adapter splits into **pure modules** (`codec.ts`, `id-registry.ts` — import only port types, CI-covered) and **`sdk-adapter.ts`** (the only SDK importer; typechecked locally via `npm run typecheck:sdk`, excluded from CI typecheck). All SDK signatures come from the verified local reference `docs/sdk-notes.md` (gitignored) — implementers consult it instead of the `.d.mts`.

**Tech Stack:** as before + esbuild (local), `@ableton-extensions/sdk` + `@ableton-extensions/cli` 1.0.0-beta.0 (local only).

## Global Constraints

All prior constraints remain (boundaries via lint, labeled transact per write — the **label is FakeLive/audit-only; the SDK's `withinTransaction` takes no name**, structured errors, budgets, format+checks before every commit). Additions:

- **No Ableton-derived bits enter git**: no tarballs, no `docs/sdk-notes.md`, no extracted `.d.ts`. CI (`npm ci` + checks) must stay green on a machine WITHOUT the SDK.
- `src/adapters/sdk-1.0/sdk-adapter.ts` (and only it, plus `src/extension.ts`/`src/shell/` which import it) may import `@ableton-extensions/sdk`. Update `scripts/check-boundaries.mjs` accordingly: allow `@ableton-extensions/` imports from `adapters/sdk-*`, `shell/`, and `extension.ts`; everything else still forbidden.
- **Validate-before-transaction:** the adapter performs all existence/argument checks BEFORE `withinTransaction`, so failed calls leave no empty undo step in Live.
- `withinTransaction` callbacks must start synchronously; the adapter passes our async `fn` as `() => fn()` and awaits the returned promise (per sdk-notes: the SDK awaits the returned promise before closing the undo step). A contract self-test pins this.
- Clip color hex↔number mapping is best-effort (`#RRGGBB` ↔ `0xRRGGBB`) and flagged for in-Live verification in the smoke runbook.
- After Task 2, ALL `LivePort` reads are async (`Promise<...>`) — required because `DeviceParameter.getValue()` is async in the real SDK.

---

### Task 1: Local SDK setup + CI isolation

**Files:**

- Modify: `package.json` (scripts), `tsconfig.json` (exclude sdk-1.0), `.gitignore`, `scripts/check-boundaries.mjs`
- Create: `tsconfig.sdk.json`
- Test: verification commands below (no new test files)

**Interfaces:**

- Consumes: `references/extensions-sdk-1.0.0-beta.0/*.tgz` (present locally).
- Produces: `npm run setup:sdk` (installs sdk+cli locally, no package.json change); `npm run typecheck` excludes `src/adapters/sdk-1.0/sdk-adapter.ts` and `src/shell/`+`src/extension.ts`; `npm run typecheck:sdk` includes everything; boundary script updated. CI stays green without the SDK.

- [ ] **Step 1: Add npm scripts**

In `package.json` scripts:

```json
    "setup:sdk": "npm install --no-save file:references/extensions-sdk-1.0.0-beta.0/ableton-extensions-sdk-1.0.0-beta.0.tgz file:references/extensions-sdk-1.0.0-beta.0/ableton-extensions-cli-1.0.0-beta.0.tgz",
    "typecheck:sdk": "tsc --noEmit -p tsconfig.sdk.json"
```

- [ ] **Step 2: Split typecheck configs**

`tsconfig.json`: add `"exclude": ["src/adapters/sdk-1.0/sdk-adapter.ts", "src/shell", "src/extension.ts"]` (pure adapter modules stay included).

Create `tsconfig.sdk.json`:

```json
{
  "extends": "./tsconfig.json",
  "exclude": []
}
```

- [ ] **Step 3: Gitignore local-only artifacts**

Append to `.gitignore`:

```
# Local-only Ableton SDK artifacts (beta terms: do not commit)
docs/sdk-notes.md
```

- [ ] **Step 4: Update scripts/check-boundaries.mjs**

Change the SDK-import rule: the check currently flags `@ableton-extensions/*` imports outside `adapters/sdk-*`. Extend the allowlist so files under `adapters/sdk-`, `shell/`, or the file `extension.ts` are permitted:

```js
if (
  spec.startsWith("@ableton-extensions/") &&
  !inSdkAdapter &&
  layer !== "shell" &&
  rel !== "extension.ts"
) {
  violations.push(
    `${rel}: imports ${spec} (only src/adapters/sdk-*, src/shell/, src/extension.ts may)`,
  );
}
```

Also add a rule: `mcp/`, `domain/`, `port/`, `adapters/fake/` must not import `shell/` (keep the shell an outer ring): for those layers flag relative imports resolving to `shell/`.

- [ ] **Step 5: Verify both worlds**

Run: `npm run setup:sdk` → installs 2 packages, `git status` shows NO change to package.json/package-lock.json.
Run: `npm test && npm run typecheck && npm run lint` → green (CI world unaffected).
Run: `rm -rf node_modules && npm ci && npm test && npm run typecheck && npm run lint` → green WITHOUT the SDK (proves CI isolation), then `npm run setup:sdk` again to restore.

- [ ] **Step 6: Format and commit**

```bash
npm run format
git add package.json tsconfig.json tsconfig.sdk.json .gitignore scripts/check-boundaries.mjs
git commit -m "chore: local-only SDK setup with CI isolation and boundary updates"
```

---

### Task 2: Async-reads port migration

**Files:**

- Modify: `src/port/live-port.ts` (4 read signatures), `src/adapters/fake/fake-live.ts`, all of `src/domain/*.ts`, `src/mcp/tools/*.ts`, and every test that calls reads directly.

**Interfaces:**

- Consumes: everything existing.
- Produces: `getSet()/getTrack()/getClip()/getDevice()` return `Promise<...>` on `LivePort`, `FakeLive`, and `SetInspector`. Domain fail-fast reads become `await`ed. Tool handlers `await` inspector calls. **No behavioral change** — every test keeps its assertions, only adding `await`/`async` where reads are consumed.

- [ ] **Step 1: Change the port**

In `src/port/live-port.ts`, the four reads become:

```ts
  getSet(): Promise<SetSnapshot>;
  getTrack(id: TrackId): Promise<TrackDetail>;
  getClip(id: ClipId): Promise<ClipDetail>;
  getDevice(id: DeviceId): Promise<DeviceDetail>;
```

Update the interface doc comment: "Reads are async because some SDK values (device parameters) require async host calls; implementations must not mutate state in reads."

- [ ] **Step 2: Mechanical migration**

- `FakeLive`: mark the four reads `async` (bodies unchanged). Internal calls like `this.getClip(clip.id)` at the end of create methods now need `await` (methods are already async).
- `src/domain/*`: every `this.live.getSet()/getTrack()/getClip()/getDevice()` gets `await` (fail-fast lines included); `SetInspector` methods become async passthroughs. `ClipEditor.editClipNotes` keeps read+compute BEFORE `transact` (unchanged structure).
- `src/mcp/tools/*`: handlers `await deps.inspector.*`.
- Tests: add `await` where reads are called directly (`fake.getSet()` → `await fake.getSet()`, `expect(() => fake.getClip(...)).toThrow(...)` → `await expect(fake.getClip(...)).rejects.toMatchObject({ code: "NOT_FOUND" })` — rewrite sync-throw assertions as rejection assertions with the same codes).

- [ ] **Step 3: Verify zero behavioral drift**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all 91 tests pass with unchanged assertions (only async plumbing changed). If any test's expected VALUES changed, that's a bug in the migration — fix the migration, not the test.

- [ ] **Step 4: Format and commit**

```bash
npm run format
git add -A src/ test/
git commit -m "refactor: async LivePort reads (SDK device params require async access)"
```

---

### Task 3: Adapter pure modules — codecs + ID registry (CI-covered)

**Files:**

- Create: `src/adapters/sdk-1.0/codec.ts`, `src/adapters/sdk-1.0/id-registry.ts`
- Test: `test/unit/adapters/sdk-codec.test.ts`, `test/unit/adapters/id-registry.test.ts`

**Interfaces:**

- Consumes: port types ONLY (these files must NOT import `@ableton-extensions/sdk` — they stay in CI).
- Produces (used by Task 4-5):
  - `codec.ts`: `interface SdkNote { pitch: number; startTime: number; duration: number; velocity?: number; muted?: boolean; probability?: number; velocityDeviation?: number; releaseVelocity?: number }` (structurally matches the SDK's `NoteDescription` — kept local so this file needs no SDK import); `noteToSdk(note: Note): SdkNote`; `noteFromSdk(sdk: SdkNote): Note` (extras only when non-default: probability≠1 → `prob`, velocityDeviation≠0 → `velDev`, muted=true → `muted`, releaseVelocity≠64 → `relVel`); `colorToHex(n: number): string` (`#RRGGBB`, uppercase, masked to 24 bits); `colorFromHex(hex: string): number`.
  - `id-registry.ts`: `class IdRegistry<T extends object>` with `constructor(prefix: string)`, `idFor(obj: T): string` (mints `prefix+n` on first sight, stable afterwards, never reused), `resolve(id: string): T | undefined`, `forget(obj: T): void`. Backed by a `Map<T, string>` + `Map<string, T>`.

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/sdk-codec.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  colorFromHex,
  colorToHex,
  noteFromSdk,
  noteToSdk,
} from "../../../src/adapters/sdk-1.0/codec.js";
import type { Note } from "../../../src/port/types.js";

describe("note codec", () => {
  it("round-trips a plain note", () => {
    const note: Note = [60, 1.5, 0.25, 100];
    expect(noteFromSdk(noteToSdk(note))).toEqual(note);
  });

  it("round-trips extras and omits defaults", () => {
    const note: Note = [60, 0, 1, 90, { prob: 0.5, velDev: 10, muted: true, relVel: 30 }];
    const sdk = noteToSdk(note);
    expect(sdk).toEqual({
      pitch: 60,
      startTime: 0,
      duration: 1,
      velocity: 90,
      probability: 0.5,
      velocityDeviation: 10,
      muted: true,
      releaseVelocity: 30,
    });
    expect(noteFromSdk(sdk)).toEqual(note);
  });

  it("maps SDK defaults back to a 4-tuple", () => {
    expect(
      noteFromSdk({
        pitch: 60,
        startTime: 0,
        duration: 1,
        velocity: 100,
        probability: 1,
        velocityDeviation: 0,
        muted: false,
        releaseVelocity: 64,
      }),
    ).toEqual([60, 0, 1, 100]);
  });

  it("defaults missing SDK velocity to 100", () => {
    expect(noteFromSdk({ pitch: 60, startTime: 0, duration: 1 })).toEqual([
      60, 0, 1, 100,
    ]);
  });
});

describe("color codec", () => {
  it("round-trips", () => {
    expect(colorToHex(colorFromHex("#FF5500"))).toBe("#FF5500");
  });
  it("pads and masks", () => {
    expect(colorToHex(0x000042)).toBe("#000042");
    expect(colorToHex(0xff000042 & 0xffffff)).toBe("#000042");
  });
});
```

`test/unit/adapters/id-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IdRegistry } from "../../../src/adapters/sdk-1.0/id-registry.js";

describe("IdRegistry", () => {
  it("mints stable, sequential IDs per object", () => {
    const reg = new IdRegistry<object>("t");
    const a = {};
    const b = {};
    expect(reg.idFor(a)).toBe("t1");
    expect(reg.idFor(b)).toBe("t2");
    expect(reg.idFor(a)).toBe("t1");
    expect(reg.resolve("t2")).toBe(b);
  });

  it("never reuses IDs after forget", () => {
    const reg = new IdRegistry<object>("c");
    const a = {};
    reg.idFor(a);
    reg.forget(a);
    expect(reg.resolve("c1")).toBeUndefined();
    expect(reg.idFor({})).toBe("c2");
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

`src/adapters/sdk-1.0/codec.ts`:

```ts
import type { Note, NoteExtras } from "../../port/types.js";

/**
 * Structural twin of the SDK's NoteDescription — declared locally so this
 * module stays SDK-import-free (and therefore CI-checkable).
 */
export interface SdkNote {
  pitch: number;
  startTime: number;
  duration: number;
  velocity?: number;
  muted?: boolean;
  probability?: number;
  velocityDeviation?: number;
  releaseVelocity?: number;
}

export function noteToSdk(note: Note): SdkNote {
  const [pitch, startTime, duration, velocity] = note;
  const extras = note.length === 5 ? note[4] : undefined;
  return {
    pitch,
    startTime,
    duration,
    velocity,
    ...(extras?.prob !== undefined ? { probability: extras.prob } : {}),
    ...(extras?.velDev !== undefined ? { velocityDeviation: extras.velDev } : {}),
    ...(extras?.muted !== undefined ? { muted: extras.muted } : {}),
    ...(extras?.relVel !== undefined ? { releaseVelocity: extras.relVel } : {}),
  };
}

export function noteFromSdk(sdk: SdkNote): Note {
  const extras: NoteExtras = {};
  if (sdk.probability !== undefined && sdk.probability !== 1)
    extras.prob = sdk.probability;
  if (sdk.velocityDeviation !== undefined && sdk.velocityDeviation !== 0)
    extras.velDev = sdk.velocityDeviation;
  if (sdk.muted) extras.muted = true;
  if (sdk.releaseVelocity !== undefined && sdk.releaseVelocity !== 64)
    extras.relVel = sdk.releaseVelocity;
  const base: [number, number, number, number] = [
    sdk.pitch,
    sdk.startTime,
    sdk.duration,
    sdk.velocity ?? 100,
  ];
  return Object.keys(extras).length > 0 ? [...base, extras] : base;
}

/** Best-effort 0xRRGGBB mapping — verify against real Live (smoke runbook). */
export function colorToHex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}

export function colorFromHex(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}
```

`src/adapters/sdk-1.0/id-registry.ts`:

```ts
/** Session-stable minted IDs for SDK objects (ADR 0003). IDs are never reused. */
export class IdRegistry<T extends object> {
  private counter = 0;
  private readonly byObject = new Map<T, string>();
  private readonly byId = new Map<string, T>();

  constructor(private readonly prefix: string) {}

  idFor(obj: T): string {
    const existing = this.byObject.get(obj);
    if (existing) return existing;
    const id = `${this.prefix}${++this.counter}`;
    this.byObject.set(obj, id);
    this.byId.set(id, obj);
    return id;
  }

  resolve(id: string): T | undefined {
    return this.byId.get(id);
  }

  forget(obj: T): void {
    const id = this.byObject.get(obj);
    if (id !== undefined) {
      this.byObject.delete(obj);
      this.byId.delete(id);
    }
  }
}
```

- [ ] **Step 3: Run all checks; format; commit**

```bash
npm test && npm run typecheck && npm run lint
npm run format
git add src/adapters/sdk-1.0/ test/unit/adapters/
git commit -m "feat: SDK adapter pure modules - note/color codecs and ID registry"
```

---

### Task 4: SdkAdapter — session, reads, core writes (local typecheck)

**Files:**

- Create: `src/adapters/sdk-1.0/sdk-adapter.ts`
- Verify: `npm run typecheck:sdk` (requires `npm run setup:sdk` run first)

**Interfaces:**

- Consumes: `docs/sdk-notes.md` (authoritative signatures — READ IT FIRST and follow its exact API shapes; where this plan's code disagrees with sdk-notes, sdk-notes wins), codec + IdRegistry (Task 3), port types/errors.
- Produces: `class SdkAdapter implements LivePort` covering: `getSet`, `getTrack`, `getClip`, `createTracks`, `updateTrack`, `deleteTracks`, `createScenes`, `updateScene`, `deleteScenes`, `createMidiClip`, `createAudioClip`, `updateClip`, `deleteClips`, `replaceClipNotes`, `updateSong`, `transact`. Device/mixer methods throw `UNSUPPORTED` until Task 5. Constructor: `constructor(private readonly context: ExtensionContext<"1.0.0">)`.

Key required behaviors (encode these even where exact SDK calls differ per sdk-notes):

- **ID strategy:** four `IdRegistry` instances (tracks `t`, scenes `s`, clips `c`, devices `d`); return-track IDs `r` from a fifth registry over `song.returnTracks`. Reads walk the live object graph (`context.application.song`) and mint IDs on sight. `resolveTrack(id)` etc. re-walk the current graph; if the resolved object is no longer present, `forget` it and throw `PortError.notFound(kind, id)` (same hints as FakeLive).
- **Slot addressing:** our port addresses session slots by `(trackId, sceneId)`; the SDK exposes `track.clipSlots` as an array parallel to `song.scenes` — index lookup via the scene's position in `song.scenes`.
- **Notes:** `MidiClip.notes` is a sync getter/setter of `NoteDescription[]` — map through `noteToSdk`/`noteFromSdk`.
- **Kind detection:** instance checks per sdk-notes (e.g. `clip instanceof MidiClip`), mapped to our `kind` field; `filePath` from `AudioClip.filePath`.
- **`transact(label, fn)`:** label is not supported by the SDK — ignore it here (audit log records it at the shell layer). Implementation:

```ts
  async transact<T>(_undoLabel: string, fn: () => Promise<T>): Promise<T> {
    // withinTransaction requires a synchronous callback; it awaits the
    // returned promise before closing the undo step (see docs/sdk-notes.md).
    return this.context.withinTransaction(() => fn());
  }
```

- **Validate-before-transaction:** all NOT_FOUND/INVALID_INPUT checks happen in the adapter method BEFORE any SDK mutation — since domain services already fail fast via reads, adapter methods resolve IDs first and only then mutate; adapter-level state checks (occupied slot → CONFLICT, wrong track type → INVALID_INPUT) also run before the first mutating SDK call, so a throwing call inside `transact` cannot leave an empty undo step. Match FakeLive's error codes/hints exactly (FakeLive is the behavioral reference; contract self-tests compare them in Task 8).
- **updateSong tempo:** `song.tempo = value` (sync setter per sdk-notes).
- **Unsupported in SDK 1.0.0:** track color, scene tempo write — not in our port; nothing to do.

- [ ] **Step 1: Read docs/sdk-notes.md fully.** Then write `sdk-adapter.ts` implementing the list above with the real signatures. Where the SDK offers no direct equivalent (e.g. deleting a clip: per sdk-notes use `track.deleteClip(clip)` or `clipSlot.deleteClip()` — pick what sdk-notes documents), follow sdk-notes.

- [ ] **Step 2: Verify**

Run: `npm run setup:sdk` (if not already), then `npm run typecheck:sdk` → clean.
Run: `npm test && npm run typecheck && npm run lint` → green (CI world untouched — sdk-adapter.ts excluded).

- [ ] **Step 3: Format and commit**

```bash
npm run format
git add src/adapters/sdk-1.0/sdk-adapter.ts
git commit -m "feat: SdkAdapter core - session graph, reads, track/scene/clip/note/song writes"
```

---

### Task 5: SdkAdapter — devices and mixer

**Files:**

- Modify: `src/adapters/sdk-1.0/sdk-adapter.ts` (replace the UNSUPPORTED stubs)
- Verify: `npm run typecheck:sdk`

**Interfaces:**

- Consumes: sdk-notes device/mixer sections; Task 4 internals.
- Produces: `getDevice`, `insertDevice`, `setDeviceParams`, `deleteDevice`, `setMixer` on `SdkAdapter`.

Required behaviors:

- `getDevice(id)`: resolve device; build `DeviceDetail` — param metadata (name/min/max/isQuantized/valueItems) is sync; **values need `await param.getValue()` — fetch all in parallel with `Promise.all`**.
- `getTrack` mixer block (added now, replacing Task 4's placeholder zeros if any): `track.mixer.volume/panning/sends` are `DeviceParameter`s — `await Promise.all` their `getValue()`s; sends map onto return-track IDs by index order of `song.returnTracks`.
- `insertDevice(trackId, name, index?)`: `track.insertDevice(name, index ?? track.devices.length)` per sdk-notes signature; unknown-name errors from the SDK surface as `INVALID_INPUT` with the SDK's message (wrap thrown SDK errors: if it's not a `PortError`, wrap as `INVALID_INPUT` for insert-by-name failures with hint "Use exact built-in Live device names, e.g. Reverb, Auto Filter.").
- `setDeviceParams(id, params)`: resolve device; validate ALL names/ranges/quantization against sync metadata BEFORE the transaction (mirror FakeLive's messages); then inside the caller's `transact`, `await Promise.all(updates.map(u => u.param.setValue(u.value)))`.
- `setMixer(trackId, patch)`: validate returnIds first; then `setValue` on the mixer DeviceParameters.

- [ ] **Step 1: Implement per sdk-notes. Step 2: `npm run typecheck:sdk` clean; CI suite still green. Step 3:**

```bash
npm run format
git add src/adapters/sdk-1.0/sdk-adapter.ts
git commit -m "feat: SdkAdapter devices and mixer via DeviceParameter get/setValue"
```

---

### Task 6: Extension shell — activate, config, audit log, status dialog

**Files:**

- Create: `src/extension.ts`, `src/shell/config.ts`, `src/shell/audit-log.ts`, `src/shell/status-dialog.ts`, `manifest.json`
- Test: `test/unit/shell/audit-log.test.ts` (audit-log is SDK-free — CI-covered; put it in `src/shell/audit-log.ts` with NO SDK imports, taking a directory path)

**Interfaces:**

- Consumes: SdkAdapter, domain services, `createMcpServer`, `startHttpServer`, sdk-notes §ui/§environment/§commands/§entry.
- Produces:
  - `manifest.json`: `{ "name": "Ableton MCP", "author": "Denys Lieukhyn", "entry": "dist/extension.js", "version": "0.1.0", "minimumApiVersion": "1.0.0" }`
  - `src/shell/config.ts` (SDK-free): `loadOrCreateConfig(storageDir: string): { port: number; token: string }` — reads/writes `config.json` in storageDir; defaults port 20808; token `crypto.randomUUID()` minted once and persisted.
  - `src/shell/audit-log.ts` (SDK-free): `class AuditLog { constructor(dir: string); record(entry: { tool: string; ok: boolean; code?: string; durationMs: number }): void; recent(n: number): entries }` — appends JSONL to `logs/audit.jsonl` (fs sync append is fine), keeps a small in-memory ring for the dialog. Wire it in `src/mcp/server.ts` via an optional `onToolResult` callback in `createMcpServer` deps (add the optional field to `ToolDeps` or a second options arg — keep it optional so tests/dev:fake don't change).
  - `src/shell/status-dialog.ts`: builds a `data:` URL HTML page showing server URL, masked token with the full `claude mcp add` command, the last 10 audit entries, and a Close button posting `close_and_send` (per sdk-notes webview messaging).
  - `src/extension.ts`: `export async function activate(activation)` → `initialize(activation, "1.0.0")`; build SdkAdapter → services → `createMcpServer` deps; `startHttpServer` with config; `ui.registerContextMenuAction` (scope per sdk-notes — use a broadly available scope, e.g. Scene) + `commands.registerCommand` opening the status dialog; catch-all: activation errors are logged (console → ExtensionHost.txt) without rethrowing crash loops.

- [ ] **Step 1: TDD the SDK-free pieces** (config + audit-log): failing tests for token persistence across two `loadOrCreateConfig` calls (temp dir via `fs.mkdtempSync`), JSONL append + `recent()` ordering. Implement. CI-covered.
- [ ] **Step 2: Write manifest.json, status-dialog.ts, extension.ts** per sdk-notes signatures. `npm run typecheck:sdk` → clean.
- [ ] **Step 3: All checks green (CI world + typecheck:sdk); format; commit**

```bash
git add src/extension.ts src/shell/ manifest.json test/unit/shell/ src/mcp/
git commit -m "feat: extension shell - activate, persisted config/token, audit log, status dialog"
```

---

### Task 7: Build and packaging

**Files:**

- Create: `build.ts`
- Modify: `package.json` (scripts + esbuild devDep), `README.md`, `CONTRIBUTING.md`, `.gitignore` (dist/ already ignored — verify)

**Interfaces:**

- Produces: `npm run build` (esbuild → `dist/extension.js`, CJS, platform node, bundled incl. SDK), `npm run start` (build + `extensions-cli run .`), `npm run package` (build + `extensions-cli package . -o dist/`) → `dist/Ableton MCP-0.1.0.ablx`. All local-only (need `setup:sdk`); CI does NOT run them.

- [ ] **Step 1: Install esbuild + tsx already present**

```bash
npm install -D esbuild
```

(esbuild is generic tooling — committing it to package.json is fine.)

- [ ] **Step 2: Write build.ts**

```ts
import { build } from "esbuild";

await build({
  entryPoints: ["src/extension.ts"],
  outfile: "dist/extension.js",
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcemap: process.argv.includes("--dev"),
  minify: !process.argv.includes("--dev"),
});
console.log("built dist/extension.js");
```

- [ ] **Step 3: Scripts**

```json
    "build": "tsx build.ts",
    "build:dev": "tsx build.ts --dev",
    "start": "npm run build:dev && extensions-cli run .",
    "package": "npm run build && extensions-cli package . -o dist"
```

- [ ] **Step 4: Verify locally**

Run: `npm run build` → `dist/extension.js` exists; `node -e "require('./dist/extension.js')"` loads without throwing on import (activate is only exported, not called).
Run: `npm run package` → a `.ablx` file appears in `dist/`.
Run: `npm test && npm run typecheck && npm run lint` → CI world still green.

- [ ] **Step 5: Update README + CONTRIBUTING** — document the two-tier workflow: CI/contributors without Ableton (`npm ci`, tests, dev:fake) vs. extension development (`npm run setup:sdk`, `typecheck:sdk`, `start`, `package`), and that the SDK tarballs must be obtained from Ableton's beta program into `references/` (never committed).

- [ ] **Step 6: Format and commit**

```bash
git add build.ts package.json package-lock.json README.md CONTRIBUTING.md
git commit -m "feat: esbuild bundle and .ablx packaging scripts (local-only)"
```

---

### Task 8: Self-test smoke commands + runbook + docs closure

**Files:**

- Create: `src/shell/self-test.ts`, `docs/smoke-runbook.md`
- Modify: `src/shell/status-dialog.ts` + `src/extension.ts` (trigger self-test from the dialog), `docs/capability-map.md`, `README.md`

**Interfaces:**

- Consumes: domain services over the real SdkAdapter; `ui.withinProgressDialog`; both component scenarios as the script source.
- Produces: an in-Live self-test runner + a human runbook. Execution deferred until Live beta is installed.

- [ ] **Step 1: Write src/shell/self-test.ts**

A `runSelfTest(deps: ToolDeps, report: (line: string) => void): Promise<{ passed: number; failed: number; failures: string[] }>` that replays, against the REAL adapter, the union of the component scenarios (steps, not vitest): build-a-beat (tracks, scenes, tempo, MIDI clips with exact note round-trip), edit-existing-set (filter thinning, rename/color, scene ops), sound-design (insert Reverb, set params, batch mixer), plus contract checks pinning FakeLive-vs-Live semantics: occupied slot → CONFLICT, MIDI clip on audio track → INVALID_INPUT, stale ID after delete → NOT_FOUND, audio clip note edit → INVALID_INPUT, color round-trip (`update_clip` `#FF5500` → `get_clip` returns same hex — the flagged color-mapping verification). Each step: try/catch, compare, `report()` a ✓/✗ line, collect failures. **The self-test creates its own tracks/scenes and deletes everything it created at the end (in one final cleanup), leaving the user's set as found — plus every step ran through `transact`, so Live's undo history can also revert it.**

- Wire into the status dialog: a "Run self-test" button (dialog returns `"selftest"` via `close_and_send`; extension.ts then runs it inside `ui.withinProgressDialog`, streaming step lines via `update()`, writing the full report to `storageDirectory/logs/selftest-<n>.log`, and showing pass/fail in a final dialog).

- [ ] **Step 2: Write docs/smoke-runbook.md** (tracked — our own text): prerequisites (Live beta with Extension Host, Developer Mode on, SDK tarballs in `references/`), setup (`npm ci && npm run setup:sdk`), dev run (`npm run start`), how to open the status dialog and run the self-test, expected results (N steps green), where logs live (`storageDirectory/logs/`, `ExtensionHost.txt` paths for macOS/Windows), the release checklist (self-test green on macOS + Windows before tagging), and the deferred verification list (color mapping, audio clip length semantics, transact atomicity).

- [ ] **Step 3: Docs closure** — capability map: add a "Runtime status" note (v1 surface implemented; in-Live validation pending — see smoke runbook). README status section: extension builds and packages; in-Live validation pending Live beta install.

- [ ] **Step 4: All checks (CI world + `npm run typecheck:sdk` + `npm run build`); format; commit**

```bash
git add src/shell/ src/extension.ts docs/smoke-runbook.md docs/capability-map.md README.md
git commit -m "feat: in-Live self-test runner and smoke runbook; v1 pending in-Live validation"
```

---

## Post-plan checklist

- CI green without the SDK; `typecheck:sdk` + `npm run build` + `npm run package` green with it.
- `.ablx` artifact produced locally; nothing Ableton-derived committed.
- Self-test runner + runbook ready; **actual in-Live smoke execution is deferred** until the Live beta is installed — that run is the release gate for v0.1.0.
