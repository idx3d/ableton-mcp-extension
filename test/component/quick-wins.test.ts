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
    expect(set.payload.set.cues.map((c: { name: string }) => c.name)).toContain("Intro");

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
