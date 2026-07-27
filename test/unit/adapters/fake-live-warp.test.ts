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
