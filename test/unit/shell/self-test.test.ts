import { describe, expect, it } from "vitest";
import { FakeLive } from "../../../src/adapters/fake/fake-live.js";
import { ClipEditor } from "../../../src/domain/clip-editor.js";
import { DeviceService } from "../../../src/domain/device-service.js";
import { MixerService } from "../../../src/domain/mixer-service.js";
import { SetInspector } from "../../../src/domain/set-inspector.js";
import { SongService } from "../../../src/domain/song-service.js";
import { TrackService } from "../../../src/domain/track-service.js";
import type { ToolDeps } from "../../../src/mcp/tools/types.js";
import { runSelfTest } from "../../../src/shell/self-test.js";

function makeDeps(fake: FakeLive): ToolDeps {
  return {
    inspector: new SetInspector(fake),
    tracks: new TrackService(fake),
    clips: new ClipEditor(fake),
    song: new SongService(fake),
    devices: new DeviceService(fake),
    mixer: new MixerService(fake),
  };
}

describe("runSelfTest against FakeLive", () => {
  it("passes every check and reports PASS lines", async () => {
    const fake = new FakeLive();
    const lines: string[] = [];

    const result = await runSelfTest(makeDeps(fake), (line) => lines.push(line));

    expect(result.passed).toBeGreaterThan(0);
    expect(result.failed).toBe(0);
    expect(result.failures).toEqual([]);
    expect(lines.some((l) => l.startsWith("PASS:"))).toBe(true);
    expect(lines.some((l) => l.startsWith("FAIL:"))).toBe(false);
  });

  it("leaves the set as found — no leftover tracks or scenes", async () => {
    const fake = new FakeLive();

    await runSelfTest(makeDeps(fake), () => {});

    const set = await fake.getSet();
    expect(set.tracks).toEqual([]);
    expect(set.scenes).toEqual([]);
    expect(set.tracks.some((t) => t.name.startsWith("MCP Self-Test"))).toBe(false);
  });

  it("restores the original tempo", async () => {
    const fake = new FakeLive();
    await fake.updateSong({ tempo: 137 });

    await runSelfTest(makeDeps(fake), () => {});

    const set = await fake.getSet();
    expect(set.tempo).toBe(137);
  });
});
