import { randomUUID } from "node:crypto";
import { FakeLive } from "../adapters/fake/fake-live.js";
import { ClipEditor } from "../domain/clip-editor.js";
import { DeviceService } from "../domain/device-service.js";
import { MixerService } from "../domain/mixer-service.js";
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
  await fake.insertDevice("t1", "Reverb");
  await fake.setDeviceParams("d1", { "Dry/Wet": 0.25 });
  await fake.setMixer("t2", { volume: 0.75, sends: [{ returnId: "r2", value: 0.2 }] });

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
        devices: new DeviceService(fake),
        mixer: new MixerService(fake),
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
