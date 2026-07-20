# Plan 2a: Devices & Mixer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the MCP server with device control (get/insert/set-params/delete) and batch mixer control (volume/pan/sends), taking the tool surface from 10 to 15 tools — still entirely against FakeLive.

**Architecture:** Same ports-and-adapters layering as Plan 1. `LivePort` gains device/mixer methods and DTOs; FakeLive gains a small built-in device catalog, per-track device chains, mixer state, and two default return tracks; new `DeviceService` and `MixerService` in the domain layer; new `devices.ts` and `mixer.ts` tool files.

**Tech Stack:** unchanged (TypeScript strict/ESM, vitest, zod v3, `@modelcontextprotocol/sdk`).

**Roadmap context:** Plan 2a of the v1 surface. Plan 2b (audio clips, update/delete clips, edit_clip_notes, scene update/delete, generated tools.md) follows. Plan 3 = real SDK adapter + extension shell.

## Global Constraints

All of Plan 1's constraints remain binding (SDK quarantine — enforced by `npm run lint`; port zero-deps; one `transact` per write labeled with the tool name; all-or-nothing batches; structured `{ok:false, code, hint}` errors; compact note tuples). Additions for this plan:

- Parameter and mixer values are **Live-internal raw values**: volume 0..1, pan -1..1, sends 0..1, device params bounded by their declared `[min, max]`. The Plan-3 SDK adapter maps these 1:1 to `DeviceParameter.getValue/setValue`.
- FakeLive's device catalog is a deliberately small stand-in (documented in code); unknown device names fail with `INVALID_INPUT` listing the known names. Real-Live name acceptance is pinned by Plan-3 contract tests.
- Token economy: `set_device_params` echoes only the changed params, never the full device; `get_track` additions (devices + mixer) must keep the existing `< 4096` bytes budget test passing.
- Every task ends with `npm test`, `npm run typecheck`, and `npm run lint` green, then a commit (Prettier style: width 90, trailing commas — run `npm run format` before committing).

---

### Task 1: Port extensions + FakeLive device/mixer state and reads

**Files:**
- Modify: `src/port/types.ts` (append new types; also extend `SetSnapshot`, `TrackDetail`)
- Modify: `src/port/live-port.ts` (imports + 5 new methods)
- Modify: `src/adapters/fake/fake-live.ts`
- Test: `test/unit/adapters/fake-live-devices.test.ts` (new)

**Interfaces:**
- Consumes: existing port DTOs and FakeLive internals (`requireTrack`, `counters`, `summarize`).
- Produces (used by Tasks 2-6):
  - Types: `DeviceId`, `ReturnTrackId`, `DeviceParam`, `DeviceRef`, `DeviceDetail`, `ReturnTrackSummary`, `SendLevel`, `MixerState`, `MixerPatch`.
  - `SetSnapshot.returnTracks: ReturnTrackSummary[]`; `TrackDetail.devices: DeviceRef[]`; `TrackDetail.mixer: MixerState`.
  - `LivePort` methods: `getDevice(id): DeviceDetail` (sync read) and async writes `insertDevice(trackId, deviceName, index?)`, `setDeviceParams(id, params: Record<string, number>)`, `deleteDevice(id)`, `setMixer(trackId, patch: MixerPatch)`.
  - FakeLive: constructor now seeds two return tracks `r1` "A-Reverb", `r2` "B-Delay"; per-track mixer defaults volume 0.85, pan 0, all sends 0. Write methods for devices/mixer are `UNSUPPORTED` stubs until Task 2.

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/fake-live-devices.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive device/mixer reads", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }]);
  });

  it("seeds two default return tracks", () => {
    expect(fake.getSet().returnTracks).toEqual([
      { id: "r1", name: "A-Reverb" },
      { id: "r2", name: "B-Delay" },
    ]);
  });

  it("tracks start with an empty device chain and default mixer", () => {
    const track = fake.getTrack("t1");
    expect(track.devices).toEqual([]);
    expect(track.deviceNames).toEqual([]);
    expect(track.mixer).toEqual({
      volume: 0.85,
      pan: 0,
      sends: [
        { returnId: "r1", value: 0 },
        { returnId: "r2", value: 0 },
      ],
    });
  });

  it("getDevice on an unknown ID throws NOT_FOUND", () => {
    expect(() => fake.getDevice("d1")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-devices.test.ts`
Expected: FAIL — `returnTracks`/`devices`/`mixer`/`getDevice` don't exist yet.

- [ ] **Step 3: Append to src/port/types.ts**

```ts
export type DeviceId = string; // "d1", ... minted per session
export type ReturnTrackId = string; // "r1", ...

/** A single device parameter with its current Live-internal raw value. */
export interface DeviceParam {
  name: string;
  value: number;
  min: number;
  max: number;
  quantized: boolean;
  /** For quantized params: display labels indexed by integer value. */
  valueItems?: string[];
}

export interface DeviceRef {
  id: DeviceId;
  name: string;
}

export interface DeviceDetail extends DeviceRef {
  trackId: TrackId;
  params: DeviceParam[];
}

export interface ReturnTrackSummary {
  id: ReturnTrackId;
  name: string;
}

export interface SendLevel {
  returnId: ReturnTrackId;
  /** 0..1 Live-internal raw value */
  value: number;
}

export interface MixerState {
  /** 0..1 Live-internal raw value (0.85 = 0 dB) */
  volume: number;
  /** -1..1 */
  pan: number;
  sends: SendLevel[];
}

export interface MixerPatch {
  volume?: number;
  pan?: number;
  sends?: SendLevel[];
}
```

Then extend the two existing interfaces in place:

```ts
export interface SetSnapshot {
  tempo: number;
  scaleName: string;
  rootNote: number;
  tracks: TrackSummary[];
  scenes: SceneSummary[];
  returnTracks: ReturnTrackSummary[];
}
```

```ts
export interface TrackDetail extends TrackSummary {
  slots: ClipSlot[];
  devices: DeviceRef[];
  mixer: MixerState;
}
```

- [ ] **Step 4: Extend src/port/live-port.ts**

Add to the type-import list: `DeviceDetail`, `DeviceId`, `MixerPatch`. Add to the interface, after `getClip`:

```ts
  getDevice(id: DeviceId): DeviceDetail;
```

and after `replaceClipNotes`:

```ts
  insertDevice(trackId: TrackId, deviceName: string, index?: number): Promise<DeviceDetail>;
  setDeviceParams(id: DeviceId, params: Record<string, number>): Promise<void>;
  deleteDevice(id: DeviceId): Promise<void>;
  setMixer(trackId: TrackId, patch: MixerPatch): Promise<void>;
```

- [ ] **Step 5: Extend src/adapters/fake/fake-live.ts**

Add to the type imports: `DeviceDetail`, `DeviceId`, `DeviceParam`, `DeviceRef`, `MixerPatch`, `MixerState`, `ReturnTrackId`, `ReturnTrackSummary`, `SendLevel`.

New internal interfaces (next to `FakeClip`/`FakeTrack`):

```ts
interface FakeDevice {
  id: DeviceId;
  name: string;
  params: DeviceParam[];
}

interface FakeMixer {
  volume: number;
  pan: number;
  sends: Map<ReturnTrackId, number>;
}
```

Extend `FakeTrack` with `devices: FakeDevice[];` and `mixer: FakeMixer;`.

Class changes:

```ts
  private returnTracks: ReturnTrackSummary[] = [
    { id: "r1", name: "A-Reverb" },
    { id: "r2", name: "B-Delay" },
  ];
```

Extend `counters` with `device: 0`. In `createTracks`, initialize each new track with:

```ts
        devices: [],
        mixer: this.defaultMixer(),
```

and add the helper (in internals):

```ts
  private defaultMixer(): FakeMixer {
    return {
      volume: 0.85,
      pan: 0,
      sends: new Map(this.returnTracks.map((r) => [r.id, 0])),
    };
  }
```

`getSet()` gains `returnTracks: this.returnTracks.map((r) => ({ ...r })),`.

`getTrack()` return gains:

```ts
      devices: track.devices.map((d) => ({ id: d.id, name: d.name })),
      mixer: this.mixerState(track),
```

with helper:

```ts
  private mixerState(track: FakeTrack): MixerState {
    return {
      volume: track.mixer.volume,
      pan: track.mixer.pan,
      sends: this.returnTracks.map((r) => ({
        returnId: r.id,
        value: track.mixer.sends.get(r.id) ?? 0,
      })),
    };
  }
```

`summarize()` changes `deviceNames: []` to `deviceNames: track.devices.map((d) => d.name),`.

New read + finder:

```ts
  getDevice(id: DeviceId): DeviceDetail {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    return {
      id: found.device.id,
      name: found.device.name,
      trackId: found.track.id,
      params: found.device.params.map((p) => ({ ...p })),
    };
  }
```

```ts
  protected findDevice(id: DeviceId): { track: FakeTrack; device: FakeDevice } | undefined {
    for (const track of this.tracks) {
      const device = track.devices.find((d) => d.id === id);
      if (device) return { track, device };
    }
    return undefined;
  }
```

Write stubs (replaced in Task 2):

```ts
  async insertDevice(
    _trackId: TrackId,
    _deviceName: string,
    _index?: number,
  ): Promise<DeviceDetail> {
    throw new PortError("UNSUPPORTED", "insertDevice not implemented yet");
  }

  async setDeviceParams(_id: DeviceId, _params: Record<string, number>): Promise<void> {
    throw new PortError("UNSUPPORTED", "setDeviceParams not implemented yet");
  }

  async deleteDevice(_id: DeviceId): Promise<void> {
    throw new PortError("UNSUPPORTED", "deleteDevice not implemented yet");
  }

  async setMixer(_trackId: TrackId, _patch: MixerPatch): Promise<void> {
    throw new PortError("UNSUPPORTED", "setMixer not implemented yet");
  }
```

- [ ] **Step 6: Run tests, typecheck, lint**

Run: `npx vitest run test/unit/adapters/fake-live-devices.test.ts` → PASS (3 tests).
Run: `npm test` → all suites pass (existing snapshot assertions are unaffected: they use `toEqual` on `tracks`/`scenes` fields or `toMatchObject`).
Run: `npm run typecheck && npm run lint` → clean.

- [ ] **Step 7: Format and commit**

```bash
npm run format
git add src/port/ src/adapters/fake/ test/unit/adapters/fake-live-devices.test.ts
git commit -m "feat: port + FakeLive device/mixer model - DTOs, return tracks, reads"
```

---

### Task 2: FakeLive device & mixer writes with a built-in catalog

**Files:**
- Modify: `src/adapters/fake/fake-live.ts` (replace the four stubs; add catalog)
- Test: `test/unit/adapters/fake-live-device-writes.test.ts` (new)

**Interfaces:**
- Consumes: Task 1's types and FakeLive internals (`findDevice`, `requireTrack`, `counters.device`).
- Produces: working `insertDevice` / `setDeviceParams` / `deleteDevice` / `setMixer` with these semantics:
  - Catalog devices: `"Reverb"`, `"Auto Filter"`, `"Compressor"`, `"Operator"`, `"Wavetable"`, `"Drum Rack"`. Unknown name → `INVALID_INPUT` whose hint lists the known names.
  - `insertDevice` index: `undefined` appends; out of `0..devices.length` → `INVALID_INPUT`.
  - `setDeviceParams`: unknown param name → `INVALID_INPUT` listing valid names; value outside `[min, max]` → `INVALID_INPUT` naming the range; quantized params require integers.
  - `setMixer`: unknown `returnId` → `NOT_FOUND`. (Range validation lives in the domain layer, Task 4.)

- [ ] **Step 1: Write the failing tests**

`test/unit/adapters/fake-live-device-writes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";

describe("FakeLive device writes", () => {
  let fake: FakeLive;
  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi", name: "Drums" }]);
  });

  it("inserts a catalog device with minted ID and default params", async () => {
    const device = await fake.insertDevice("t1", "Reverb");
    expect(device.id).toBe("d1");
    expect(device.trackId).toBe("t1");
    expect(device.params.map((p) => p.name)).toEqual([
      "Device On",
      "Dry/Wet",
      "Decay Time",
      "Room Size",
    ]);
    expect(fake.getTrack("t1").deviceNames).toEqual(["Reverb"]);
  });

  it("inserts at an index and rejects out-of-range indexes", async () => {
    await fake.insertDevice("t1", "Reverb");
    await fake.insertDevice("t1", "Compressor", 0);
    expect(fake.getTrack("t1").deviceNames).toEqual(["Compressor", "Reverb"]);
    await expect(fake.insertDevice("t1", "Reverb", 5)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("rejects unknown device names, hinting the catalog", async () => {
    await expect(fake.insertDevice("t1", "MegaSynth 9000")).rejects.toMatchObject({
      code: "INVALID_INPUT",
      hint: expect.stringContaining("Reverb"),
    });
  });

  it("sets params by name and validates name, range, quantization", async () => {
    await fake.insertDevice("t1", "Reverb");
    await fake.setDeviceParams("d1", { "Dry/Wet": 0.35 });
    expect(fake.getDevice("d1").params.find((p) => p.name === "Dry/Wet")?.value).toBe(
      0.35,
    );
    await expect(fake.setDeviceParams("d1", { Nope: 1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
      hint: expect.stringContaining("Dry/Wet"),
    });
    await expect(fake.setDeviceParams("d1", { "Dry/Wet": 2 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(fake.setDeviceParams("d1", { "Device On": 0.5 })).rejects.toMatchObject(
      { code: "INVALID_INPUT" },
    );
  });

  it("deletes devices; stale IDs then 404", async () => {
    await fake.insertDevice("t1", "Reverb");
    await fake.deleteDevice("d1");
    expect(fake.getTrack("t1").devices).toEqual([]);
    expect(() => fake.getDevice("d1")).toThrowError(
      expect.objectContaining({ code: "NOT_FOUND" }),
    );
    const d2 = await fake.insertDevice("t1", "Reverb");
    expect(d2.id).toBe("d2"); // IDs never reused
  });

  it("sets mixer volume/pan/sends and rejects unknown returnId", async () => {
    await fake.setMixer("t1", {
      volume: 0.7,
      pan: -0.25,
      sends: [{ returnId: "r1", value: 0.4 }],
    });
    expect(fake.getTrack("t1").mixer).toEqual({
      volume: 0.7,
      pan: -0.25,
      sends: [
        { returnId: "r1", value: 0.4 },
        { returnId: "r2", value: 0 },
      ],
    });
    await expect(
      fake.setMixer("t1", { sends: [{ returnId: "r9", value: 0.1 }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/adapters/fake-live-device-writes.test.ts`
Expected: FAIL — `UNSUPPORTED insertDevice not implemented yet`.

- [ ] **Step 3: Add the catalog and replace the four stubs in fake-live.ts**

At module level (after the internal interfaces):

```ts
/**
 * Deliberately tiny stand-in for Live's built-in device library — enough
 * surface for realistic tests. Real-Live name acceptance is pinned by the
 * Plan-3 contract tests; the SDK adapter passes names straight through.
 */
const onOff: DeviceParam = {
  name: "Device On",
  value: 1,
  min: 0,
  max: 1,
  quantized: true,
  valueItems: ["Off", "On"],
};

function knob(name: string, value: number, min = 0, max = 1): DeviceParam {
  return { name, value, min, max, quantized: false };
}

const CATALOG: Record<string, DeviceParam[]> = {
  Reverb: [onOff, knob("Dry/Wet", 1), knob("Decay Time", 0.6), knob("Room Size", 0.5)],
  "Auto Filter": [onOff, knob("Frequency", 1), knob("Resonance", 0)],
  Compressor: [onOff, knob("Threshold", 0.85), knob("Ratio", 0.3), knob("Attack", 0.2)],
  Operator: [onOff, knob("Volume", 0.85), knob("Filter Freq", 1)],
  Wavetable: [onOff, knob("Volume", 0.85), knob("Osc 1 Pos", 0)],
  "Drum Rack": [onOff, knob("Volume", 0.85)],
};
```

Replace the stubs:

```ts
  async insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail> {
    const track = this.requireTrack(trackId);
    const template = CATALOG[deviceName];
    if (!template) {
      throw new PortError(
        "INVALID_INPUT",
        `unknown built-in device "${deviceName}"`,
        `FakeLive knows: ${Object.keys(CATALOG).join(", ")}.`,
      );
    }
    const at = index ?? track.devices.length;
    if (!Number.isInteger(at) || at < 0 || at > track.devices.length) {
      throw new PortError(
        "INVALID_INPUT",
        `device index ${index} out of range 0..${track.devices.length}`,
      );
    }
    const device: FakeDevice = {
      id: `d${++this.counters.device}`,
      name: deviceName,
      params: template.map((p) => ({ ...p })),
    };
    track.devices.splice(at, 0, device);
    return this.getDevice(device.id);
  }

  async setDeviceParams(id: DeviceId, params: Record<string, number>): Promise<void> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    const updates: Array<{ param: DeviceParam; value: number }> = [];
    for (const [name, value] of Object.entries(params)) {
      const param = found.device.params.find((p) => p.name === name);
      if (!param) {
        throw new PortError(
          "INVALID_INPUT",
          `device ${id} has no parameter "${name}"`,
          `Valid parameters: ${found.device.params.map((p) => p.name).join(", ")}.`,
        );
      }
      if (value < param.min || value > param.max) {
        throw new PortError(
          "INVALID_INPUT",
          `parameter "${name}" value ${value} outside [${param.min}, ${param.max}]`,
        );
      }
      if (param.quantized && !Number.isInteger(value)) {
        throw new PortError(
          "INVALID_INPUT",
          `parameter "${name}" is quantized; value must be an integer`,
        );
      }
      updates.push({ param, value });
    }
    for (const { param, value } of updates) param.value = value;
  }

  async deleteDevice(id: DeviceId): Promise<void> {
    const found = this.findDevice(id);
    if (!found) throw PortError.notFound("device", id);
    found.track.devices = found.track.devices.filter((d) => d.id !== id);
  }

  async setMixer(trackId: TrackId, patch: MixerPatch): Promise<void> {
    const track = this.requireTrack(trackId);
    for (const send of patch.sends ?? []) {
      if (!this.returnTracks.some((r) => r.id === send.returnId)) {
        throw PortError.notFound("return track", send.returnId);
      }
    }
    if (patch.volume !== undefined) track.mixer.volume = patch.volume;
    if (patch.pan !== undefined) track.mixer.pan = patch.pan;
    for (const send of patch.sends ?? []) {
      track.mixer.sends.set(send.returnId, send.value);
    }
  }
```

Note `setDeviceParams` validates **all** entries before applying any (all-or-nothing at the adapter level too).

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add src/adapters/fake/fake-live.ts test/unit/adapters/fake-live-device-writes.test.ts
git commit -m "feat: FakeLive device catalog, device writes, mixer writes"
```

---

### Task 3: DeviceService + SetInspector.getDevice

**Files:**
- Create: `src/domain/device-service.ts`
- Modify: `src/domain/set-inspector.ts` (add `getDevice`)
- Test: `test/unit/domain/device-service.test.ts` (new)

**Interfaces:**
- Consumes: `LivePort` device methods (Tasks 1-2), `PortError`.
- Produces (used by Task 5):
  - `SetInspector.getDevice(id: DeviceId): DeviceDetail`
  - `class DeviceService { constructor(live: LivePort); insertDevice(trackId, deviceName, index?): Promise<DeviceDetail>; setParams(deviceId, params: Record<string, number>): Promise<DeviceDetail>; deleteDevice(deviceId): Promise<void> }` — undo labels `insert_device`, `set_device_params`, `delete_device`; `setParams` rejects empty records and returns the fresh detail.

- [ ] **Step 1: Write the failing tests**

`test/unit/domain/device-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { DeviceService } from "../../../src/domain/device-service.js";

describe("DeviceService", () => {
  let fake: FakeLive;
  let devices: DeviceService;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }]);
    devices = new DeviceService(fake);
  });

  it("insert, set params, delete - one named undo step each", async () => {
    const device = await devices.insertDevice("t1", "Reverb");
    const updated = await devices.setParams(device.id, { "Dry/Wet": 0.4 });
    expect(updated.params.find((p) => p.name === "Dry/Wet")?.value).toBe(0.4);
    await devices.deleteDevice(device.id);
    expect(fake.undoSteps).toEqual([
      "insert_device",
      "set_device_params",
      "delete_device",
    ]);
  });

  it("rejects empty param records without touching the port", async () => {
    await devices.insertDevice("t1", "Reverb");
    await expect(devices.setParams("d1", {})).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual(["insert_device"]);
  });

  it("fails fast on stale device IDs before mutating", async () => {
    await expect(devices.setParams("d9", { X: 1 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(devices.deleteDevice("d9")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fake.undoSteps).toEqual([]);
  });

  it("invalid param values leave no undo step behind", async () => {
    await devices.insertDevice("t1", "Reverb");
    await expect(devices.setParams("d1", { "Dry/Wet": 9 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(fake.undoSteps).toEqual(["insert_device"]);
  });
});
```

Note: `fake.createTracks` is called directly in `beforeEach` (not through
`TrackService`), so no `create_tracks` undo step is recorded — the expected arrays
above contain only the device-service labels.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/domain/device-service.test.ts`
Expected: FAIL — cannot find module `src/domain/device-service.js`.

- [ ] **Step 3: Write src/domain/device-service.ts**

```ts
import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { DeviceDetail, DeviceId, TrackId } from "../port/types.js";

export class DeviceService {
  constructor(private readonly live: LivePort) {}

  async insertDevice(
    trackId: TrackId,
    deviceName: string,
    index?: number,
  ): Promise<DeviceDetail> {
    this.live.getTrack(trackId); // fail fast on stale ID
    return this.live.transact("insert_device", () =>
      this.live.insertDevice(trackId, deviceName, index),
    );
  }

  async setParams(
    deviceId: DeviceId,
    params: Record<string, number>,
  ): Promise<DeviceDetail> {
    if (Object.keys(params).length === 0) {
      throw new PortError(
        "INVALID_INPUT",
        "params must not be empty",
        "Provide at least one parameter name/value pair (see get_device for names).",
      );
    }
    this.live.getDevice(deviceId); // fail fast on stale ID
    await this.live.transact("set_device_params", () =>
      this.live.setDeviceParams(deviceId, params),
    );
    return this.live.getDevice(deviceId);
  }

  async deleteDevice(deviceId: DeviceId): Promise<void> {
    this.live.getDevice(deviceId); // fail fast on stale ID
    return this.live.transact("delete_device", () => this.live.deleteDevice(deviceId));
  }
}
```

- [ ] **Step 4: Add getDevice to src/domain/set-inspector.ts**

Add `DeviceDetail`, `DeviceId` to the type imports and this method:

```ts
  getDevice(id: DeviceId): DeviceDetail {
    return this.live.getDevice(id);
  }
```

- [ ] **Step 5: Run all checks**

Run: `npm test && npm run typecheck && npm run lint` → all pass.

- [ ] **Step 6: Format and commit**

```bash
npm run format
git add src/domain/ test/unit/domain/device-service.test.ts
git commit -m "feat: DeviceService with fail-fast and per-tool undo labels"
```

---

### Task 4: MixerService — batch, all-or-nothing

**Files:**
- Create: `src/domain/mixer-service.ts`
- Test: `test/unit/domain/mixer-service.test.ts` (new)

**Interfaces:**
- Consumes: `LivePort.setMixer`, `getTrack`, `getSet` (for return-track validation), `PortError`.
- Produces (used by Task 5):
  - `interface MixerUpdate { trackId: TrackId; volume?: number; pan?: number; sends?: SendLevel[] }`
  - `class MixerService { constructor(live: LivePort); setMixer(updates: MixerUpdate[]): Promise<void> }` — one `transact("set_mixer")` for the whole batch; validates everything (IDs, ranges, returnIds) before any mutation.

- [ ] **Step 1: Write the failing tests**

`test/unit/domain/mixer-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { MixerService } from "../../../src/domain/mixer-service.js";

describe("MixerService", () => {
  let fake: FakeLive;
  let mixer: MixerService;

  beforeEach(async () => {
    fake = new FakeLive();
    await fake.createTracks([{ type: "midi" }, { type: "audio" }]);
    mixer = new MixerService(fake);
  });

  it("updates several tracks in ONE undo step", async () => {
    await mixer.setMixer([
      { trackId: "t1", volume: 0.6, sends: [{ returnId: "r1", value: 0.3 }] },
      { trackId: "t2", pan: 0.5 },
    ]);
    expect(fake.getTrack("t1").mixer.volume).toBe(0.6);
    expect(fake.getTrack("t2").mixer.pan).toBe(0.5);
    expect(fake.undoSteps).toEqual(["set_mixer"]);
  });

  it("is all-or-nothing: one bad track ID mutates nothing", async () => {
    await expect(
      mixer.setMixer([
        { trackId: "t1", volume: 0.1 },
        { trackId: "t99", volume: 0.1 },
      ]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.getTrack("t1").mixer.volume).toBe(0.85);
    expect(fake.undoSteps).toEqual([]);
  });

  it("validates ranges and return IDs before mutating", async () => {
    await expect(mixer.setMixer([{ trackId: "t1", volume: 1.5 }])).rejects.toMatchObject(
      { code: "INVALID_INPUT" },
    );
    await expect(mixer.setMixer([{ trackId: "t1", pan: -2 }])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      mixer.setMixer([{ trackId: "t1", sends: [{ returnId: "r9", value: 0.2 }] }]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      mixer.setMixer([{ trackId: "t1", sends: [{ returnId: "r1", value: 3 }] }]),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(fake.undoSteps).toEqual([]);
  });

  it("rejects empty batches", async () => {
    await expect(mixer.setMixer([])).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/domain/mixer-service.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write src/domain/mixer-service.ts**

```ts
import { PortError } from "../port/errors.js";
import type { LivePort } from "../port/live-port.js";
import type { SendLevel, TrackId } from "../port/types.js";

export interface MixerUpdate {
  trackId: TrackId;
  volume?: number;
  pan?: number;
  sends?: SendLevel[];
}

export class MixerService {
  constructor(private readonly live: LivePort) {}

  async setMixer(updates: MixerUpdate[]): Promise<void> {
    if (updates.length === 0) {
      throw new PortError("INVALID_INPUT", "updates must not be empty");
    }
    const returnIds = new Set(this.live.getSet().returnTracks.map((r) => r.id));
    for (const update of updates) {
      this.live.getTrack(update.trackId); // fail fast on stale ID
      if (update.volume !== undefined && (update.volume < 0 || update.volume > 1)) {
        throw new PortError(
          "INVALID_INPUT",
          `track ${update.trackId}: volume ${update.volume} outside [0, 1]`,
        );
      }
      if (update.pan !== undefined && (update.pan < -1 || update.pan > 1)) {
        throw new PortError(
          "INVALID_INPUT",
          `track ${update.trackId}: pan ${update.pan} outside [-1, 1]`,
        );
      }
      for (const send of update.sends ?? []) {
        if (!returnIds.has(send.returnId)) {
          throw PortError.notFound("return track", send.returnId);
        }
        if (send.value < 0 || send.value > 1) {
          throw new PortError(
            "INVALID_INPUT",
            `track ${update.trackId}: send ${send.returnId} value ${send.value} outside [0, 1]`,
          );
        }
      }
    }
    await this.live.transact("set_mixer", async () => {
      for (const update of updates) {
        await this.live.setMixer(update.trackId, update);
      }
    });
  }
}
```

- [ ] **Step 4: Run all checks**

Run: `npm test && npm run typecheck && npm run lint` → all pass.

- [ ] **Step 5: Format and commit**

```bash
npm run format
git add src/domain/mixer-service.ts test/unit/domain/mixer-service.test.ts
git commit -m "feat: MixerService - batch mixer updates as one undo step"
```

---

### Task 5: MCP tools (devices, mixer) + dependency wiring

**Files:**
- Create: `src/mcp/tools/devices.ts`, `src/mcp/tools/mixer.ts`
- Modify: `src/mcp/tools/types.ts` (ToolDeps gains `devices`, `mixer`), `src/mcp/tools/index.ts`
- Modify (wiring `ToolDeps` construction): `test/unit/mcp/server.test.ts`, `test/component/helpers.ts`, `test/component/http-auth.test.ts`, `src/dev/fake-server.ts`
- Test: extend `test/unit/mcp/server.test.ts`

**Interfaces:**
- Consumes: `DeviceService` (Task 3), `MixerService`/`MixerUpdate` (Task 4), `SetInspector.getDevice`, `runTool` envelope, `ToolDef` registry pattern.
- Produces: 5 new tools — `get_device`, `insert_device`, `set_device_params`, `delete_device`, `set_mixer` — total 15. `set_device_params` returns `{deviceId, changed}` (echo of the applied values), NOT the full device (token economy).

- [ ] **Step 1: Extend ToolDeps in src/mcp/tools/types.ts**

Add imports for `DeviceService` and `MixerService`; extend the interface:

```ts
export interface ToolDeps {
  inspector: SetInspector;
  tracks: TrackService;
  clips: ClipEditor;
  song: SongService;
  devices: DeviceService;
  mixer: MixerService;
}
```

- [ ] **Step 2: Update the failing tests first**

In `test/unit/mcp/server.test.ts`: extend `buildDeps` with

```ts
    devices: new DeviceService(fake),
    mixer: new MixerService(fake),
```

(with the two imports), extend the expected tool-name list with `"get_device"`, `"insert_device"`, `"set_device_params"`, `"delete_device"`, `"set_mixer"` (now 15 names), and add:

```ts
  it("device round-trip: insert, tweak, read, mixer", async () => {
    await call(client, "create_tracks", { tracks: [{ type: "midi", name: "Pad" }] });
    const inserted = await call(client, "insert_device", {
      trackId: "t1",
      device: "Reverb",
    });
    expect(inserted.payload.ok).toBe(true);
    const deviceId = inserted.payload.device.id;

    const tweaked = await call(client, "set_device_params", {
      deviceId,
      params: { "Dry/Wet": 0.25 },
    });
    expect(tweaked.payload).toMatchObject({
      ok: true,
      deviceId,
      changed: { "Dry/Wet": 0.25 },
    });

    const detail = await call(client, "get_device", { deviceId });
    expect(
      detail.payload.device.params.find((p: { name: string }) => p.name === "Dry/Wet")
        .value,
    ).toBe(0.25);

    const mixed = await call(client, "set_mixer", {
      updates: [{ trackId: "t1", volume: 0.5, sends: [{ returnId: "r1", value: 0.2 }] }],
    });
    expect(mixed.payload).toMatchObject({ ok: true, updated: ["t1"] });
    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "insert_device",
      "set_device_params",
      "set_mixer",
    ]);
  });
```

Run: `npx vitest run test/unit/mcp/server.test.ts` → FAIL (tool count, unknown tools).

- [ ] **Step 3: Write src/mcp/tools/devices.ts**

```ts
import { z } from "zod";
import type { ToolDef } from "./types.js";

export const deviceTools: ToolDef[] = [
  {
    name: "get_device",
    description:
      "Full detail of one device: every parameter with name, current value, min/max, " +
      "and quantized value labels. Use the deviceId from get_track or insert_device.",
    inputSchema: { deviceId: z.string() },
    handler: async (args, deps) => ({
      device: deps.inspector.getDevice(args.deviceId as string),
    }),
  },
  {
    name: "insert_device",
    description:
      "Insert a built-in Live device by name (e.g. \"Reverb\", \"Auto Filter\") onto a " +
      "track's device chain, in one undo step. Optional index positions it in the " +
      "chain (0 = first); omitted appends. Third-party plugins are not supported by " +
      "the Ableton API. Returns the new device with its parameters.",
    inputSchema: {
      trackId: z.string(),
      device: z.string(),
      index: z.number().int().min(0).optional(),
    },
    handler: async (args, deps) => ({
      device: await deps.devices.insertDevice(
        args.trackId as string,
        args.device as string,
        args.index as number | undefined,
      ),
    }),
  },
  {
    name: "set_device_params",
    description:
      "Set one or more parameters of a device by name, in one undo step. Values are " +
      "Live-internal raw values within each parameter's [min, max] from get_device. " +
      "All values are validated before any is applied. Returns only the changed " +
      "values; call get_device for the full state.",
    inputSchema: {
      deviceId: z.string(),
      params: z.record(z.string(), z.number()),
    },
    handler: async (args, deps) => {
      const params = args.params as Record<string, number>;
      await deps.devices.setParams(args.deviceId as string, params);
      return { deviceId: args.deviceId, changed: params };
    },
  },
  {
    name: "delete_device",
    description: "Remove a device from its track's chain, in one undo step.",
    inputSchema: { deviceId: z.string() },
    handler: async (args, deps) => {
      await deps.devices.deleteDevice(args.deviceId as string);
      return { deleted: args.deviceId };
    },
  },
];
```

- [ ] **Step 4: Write src/mcp/tools/mixer.ts**

```ts
import { z } from "zod";
import type { MixerUpdate } from "../../domain/mixer-service.js";
import type { ToolDef } from "./types.js";

export const mixerTools: ToolDef[] = [
  {
    name: "set_mixer",
    description:
      "Set volume, pan and/or send levels for one or more tracks in ONE undo step. " +
      "Values are Live-internal raw values: volume 0..1 (0.85 = 0 dB), pan -1..1, " +
      "sends 0..1 (returnIds from get_set). Everything is validated before anything " +
      "is applied — one bad entry means nothing changes.",
    inputSchema: {
      updates: z
        .array(
          z.object({
            trackId: z.string(),
            volume: z.number().min(0).max(1).optional(),
            pan: z.number().min(-1).max(1).optional(),
            sends: z
              .array(z.object({ returnId: z.string(), value: z.number().min(0).max(1) }))
              .optional(),
          }),
        )
        .min(1),
    },
    handler: async (args, deps) => {
      const updates = args.updates as MixerUpdate[];
      await deps.mixer.setMixer(updates);
      return { updated: updates.map((u) => u.trackId) };
    },
  },
];
```

- [ ] **Step 5: Register in src/mcp/tools/index.ts**

```ts
import { clipTools } from "./clips.js";
import { deviceTools } from "./devices.js";
import { mixerTools } from "./mixer.js";
import { setTools } from "./set.js";
import { trackTools } from "./tracks.js";
import type { ToolDef } from "./types.js";

export const allTools: ToolDef[] = [
  ...setTools,
  ...trackTools,
  ...clipTools,
  ...deviceTools,
  ...mixerTools,
];
```

- [ ] **Step 6: Wire the new deps everywhere ToolDeps is constructed**

In `test/component/helpers.ts`, `test/component/http-auth.test.ts`, and `src/dev/fake-server.ts`: add `devices: new DeviceService(fake)` and `mixer: new MixerService(fake)` (imports from `../../src/domain/device-service.js` / `mixer-service.js`, or relative `../domain/...` for fake-server). The `http-auth` test also asserts `tools.length` — update `expect(tools.length).toBe(10)` to `15`.

- [ ] **Step 7: Run all checks**

Run: `npm test && npm run typecheck && npm run lint` → all pass (server suite now 5 tests).

- [ ] **Step 8: Format and commit**

```bash
npm run format
git add src/mcp/ src/dev/ test/
git commit -m "feat: device and mixer MCP tools (15 tools total)"
```

---

### Task 6: Component scenario — sound-design flow + budget guard

**Files:**
- Create: `test/component/sound-design.test.ts`
- Modify: `test/component/token-budget.test.ts` (returnTracks/devices now in payloads — re-assert budgets still hold; add a `get_device` budget)

**Interfaces:**
- Consumes: `startTestStack`/`callTool` helpers (updated in Task 5), all 15 tools.
- Produces: the acceptance-level proof that a model can do sound-design work: discover → insert → tweak → mix, with exact undo trail and structured recovery from a stale device ID.

- [ ] **Step 1: Write test/component/sound-design.test.ts**

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool, startTestStack, type TestStack } from "./helpers.js";

describe("scenario: sound design on an existing set", () => {
  let stack: TestStack;
  beforeEach(async () => {
    stack = await startTestStack();
    const { client } = stack;
    await callTool(client, "create_tracks", {
      tracks: [
        { type: "midi", name: "Pad" },
        { type: "midi", name: "Bass" },
      ],
    });
  });
  afterEach(async () => {
    await stack.close();
  });

  it("insert reverb, dial it in, balance the mix", async () => {
    const { client, fake } = stack;

    const set = await callTool(client, "get_set");
    expect(set.payload.set.returnTracks).toEqual([
      { id: "r1", name: "A-Reverb" },
      { id: "r2", name: "B-Delay" },
    ]);

    const inserted = await callTool(client, "insert_device", {
      trackId: "t1",
      device: "Reverb",
    });
    const deviceId = inserted.payload.device.id;

    await callTool(client, "set_device_params", {
      deviceId,
      params: { "Dry/Wet": 0.3, "Decay Time": 0.8 },
    });

    await callTool(client, "set_mixer", {
      updates: [
        { trackId: "t1", volume: 0.7, pan: -0.15, sends: [{ returnId: "r2", value: 0.25 }] },
        { trackId: "t2", volume: 0.9 },
      ],
    });

    const track = await callTool(client, "get_track", { trackId: "t1" });
    expect(track.payload.track.deviceNames).toEqual(["Reverb"]);
    expect(track.payload.track.mixer).toMatchObject({ volume: 0.7, pan: -0.15 });

    const device = await callTool(client, "get_device", { deviceId });
    const byName = Object.fromEntries(
      device.payload.device.params.map((p: { name: string; value: number }) => [
        p.name,
        p.value,
      ]),
    );
    expect(byName["Dry/Wet"]).toBe(0.3);
    expect(byName["Decay Time"]).toBe(0.8);

    expect(fake.undoSteps).toEqual([
      "create_tracks",
      "insert_device",
      "set_device_params",
      "set_mixer",
    ]);
  });

  it("recovers from a stale device ID with a structured hint", async () => {
    const { client } = stack;
    const inserted = await callTool(client, "insert_device", {
      trackId: "t1",
      device: "Compressor",
    });
    await callTool(client, "delete_device", { deviceId: inserted.payload.device.id });

    const stale = await callTool(client, "set_device_params", {
      deviceId: inserted.payload.device.id,
      params: { Ratio: 0.5 },
    });
    expect(stale.isError).toBe(true);
    expect(stale.payload).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(stale.payload.hint).toContain("get_set");
  });

  it("unknown device name comes back with the catalog hint", async () => {
    const { client } = stack;
    const bad = await callTool(client, "insert_device", {
      trackId: "t1",
      device: "Sylenth1",
    });
    expect(bad.payload).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(bad.payload.hint).toContain("Reverb");
  });
});
```

- [ ] **Step 2: Extend test/component/token-budget.test.ts**

The existing two budget tests must still pass unchanged (the fixture has no devices; `returnTracks` adds ~70 bytes to `get_set`; `devices: []` + `mixer` adds ~150 bytes to `get_track`). Add one test to the describe block:

```ts
  it("get_device stays under 1.5 KB", async () => {
    await stack.fake.insertDevice("t1", "Reverb");
    const inserted = stack.fake.getTrack("t1").devices[0];
    const { bytes, payload } = await callTool(stack.client, "get_device", {
      deviceId: inserted.id,
    });
    expect(payload.device.params.length).toBeGreaterThan(2);
    expect(bytes).toBeLessThan(1536);
  });
```

- [ ] **Step 3: Run all checks**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass. If a budget test fails, shrink the DTO output — do not raise the budget.

- [ ] **Step 4: Format and commit**

```bash
npm run format
git add test/component/
git commit -m "test: sound-design component scenario and device token budget"
```

---

### Task 7: Docs + dev:fake demo device

**Files:**
- Modify: `docs/capability-map.md` (statuses), `src/dev/fake-server.ts` (demo device + mixer), `README.md` (tool count)

**Interfaces:**
- Consumes: everything shipped in Tasks 1-6.
- Produces: docs that match reality (docs policy: port/adapter changes require a capability-map update).

- [ ] **Step 1: Update docs/capability-map.md**

In the "MCP exposure status" table set Status to `v1 (implemented)` for the `Devices` row (`get_device`, `insert_device`, `set_device_params`, `delete_device`) and the `Mixer` row (`set_mixer`). Leave Plan-2b rows (`update_scene`/`delete_scenes`, audio clips, `edit_clip_notes`) as `v1 (planned — Plan 2)` but change the label to `v1 (planned — Plan 2b)` for precision.

- [ ] **Step 2: Update src/dev/fake-server.ts demo content**

After the existing demo clip creation, add:

```ts
  await fake.insertDevice("t1", "Reverb");
  await fake.setDeviceParams("d1", { "Dry/Wet": 0.25 });
  await fake.setMixer("t2", { volume: 0.75, sends: [{ returnId: "r2", value: 0.2 }] });
```

- [ ] **Step 3: Update README.md**

In the Status section, change "The MCP server core (10 tools)" to "The MCP server core (15 tools)".

- [ ] **Step 4: Verify dev:fake still runs**

Run: `npm run dev:fake` (Ctrl-C after the two log lines appear). Expected: same startup output as before.

- [ ] **Step 5: Run all checks, format, commit**

```bash
npm test && npm run typecheck && npm run lint
npm run format
git add docs/capability-map.md src/dev/fake-server.ts README.md
git commit -m "docs: devices and mixer implemented - capability map, dev demo, README"
```

---

## Post-plan checklist

- 15 tools listed by the server; all suites green; boundaries clean.
- `npm run dev:fake` demo set includes a device and mixer state to explore.
- Next: Plan 2b (audio clips, update/delete clips, edit_clip_notes, scene update/delete, generated tools.md).
