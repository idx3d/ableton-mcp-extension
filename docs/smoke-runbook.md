# In-Live Smoke Runbook

How to validate the Ableton MCP extension inside a real Live beta before tagging a
release. The CI world (unit + component tests against FakeLive) proves the logic;
this runbook is the **only** thing that proves the real SDK adapter behaves like
FakeLive. Running it green on macOS **and** Windows is the release gate for
`v0.1.0`.

The self-test itself (`src/shell/self-test.ts`) replays the union of the three
component scenarios (build-a-beat, edit-existing-set, sound-design) plus the
FakeLive-vs-Live contract checks, against the real adapter. It creates all of its
own tracks and scenes and deletes them again in a `finally` cleanup, and restores
the tempo, so it leaves your set as it found it. Every write also runs through
`transact`, so Live's Undo can revert the run as a fallback.

## Prerequisites

- **Live beta with the Extension Host**, from the Ableton beta program.
- **Developer Mode** enabled in Live (Preferences → so unsigned extensions load).
- The **SDK tarballs in `references/`** — the `@ableton-extensions/sdk` and
  `@ableton-extensions/cli` `.tgz` files from the Ableton beta program. Nothing
  Ableton-derived is committed to this repo; you must drop these in yourself.

## Setup

```sh
npm ci
npm run setup:sdk     # installs the SDK + CLI tarballs from references/ (no-save)
npm run typecheck:sdk # optional: confirm the SDK-facing code typechecks
```

## Dev run

```sh
npm run start         # builds (dev) and runs the extension inside Live via the CLI
```

Live should load the extension; `ExtensionHost.txt` (see below) will show the
`[ableton-mcp] MCP server running at …` line.

## Run the self-test

1. In Live's **Session view**, right-click a **Scene** to open the context menu.
2. Choose **"Ableton MCP: Status…"** (the action registered by the extension).
3. In the status dialog, click **"Run self-test"**.
4. A progress dialog streams each check as it runs (`PASS: …` / `FAIL: …`).
5. When it finishes, a summary modal shows the pass/fail counts (and any failures).

## Expected result

- **Every check reports `PASS`** and the summary shows `0 failed`.
- One check may report **`SKIP`** instead of pass/fail: the audio-clip note-edit
  contract check needs a real sample on disk. To enable it, place a WAV at
  `/tmp/ableton-mcp-selftest.wav` (the path in `SELF_TEST_SAMPLE`) before running.
  A skip does **not** fail the run.
- Afterward, the set is unchanged: no `MCP Self-Test …` tracks, no extra scenes,
  original tempo restored.

## Where the logs live

- **Self-test transcript:** `<storageDirectory>/logs/selftest-<timestamp>.log`.
  The full run (every `PASS`/`FAIL`/`SKIP`/`WARN` line) is written here.
- **Extension Host log** (`ExtensionHost.txt`) — the host's stdout/stderr,
  including our `console.log`/`console.error` lines:
  - **macOS:** `~/Library/Preferences/Ableton/Live x.x.x/`
  - **Windows:** `%AppData%\Ableton\Live x.x.x\Preferences\`

`storageDirectory` is the extension's per-install storage dir (see
`docs/sdk-notes.md` §11); if the host does not provide one the extension falls
back to `tempDirectory` and then an OS-temp path, logging which it used.

## Release checklist (gate for `v0.1.0`)

- [ ] `npm test && npm run typecheck && npm run lint` green (CI world).
- [ ] `npm run typecheck:sdk` + `npm run build` + `npm run package` green with the SDK.
- [ ] `.ablx` artifact produced locally; nothing Ableton-derived committed.
- [ ] **Self-test green on macOS** (all checks PASS, 0 failed).
- [ ] **Self-test green on Windows** (all checks PASS, 0 failed).
- [ ] Only then tag `v0.1.0`.

## Deferred in-Live verifications

These are assumptions baked into the SDK adapter (all commented in code) that
FakeLive cannot prove. Tick each one off against the self-test transcript and by
inspecting the set during the first real run. If any is wrong, the fix lands in
the adapter (`src/adapters/sdk-1.0/`) before the release gate closes.

- [ ] **Clip color always present.** The adapter always emits a `color` (the SDK
      color is a bare number with no unset state), unlike FakeLive where it is
      absent until set. The self-test tolerates color on fresh clips — confirm no
      contract check trips on it.
- [ ] **Color mapping (`0xRRGGBB`).** `update_clip` with `#FF5500` must read back
      as `#FF5500` via `get_clip` (the self-test's color round-trip check). This
      validates `colorFromHex`/`colorToHex` packing against real Live.
- [ ] **Sequential-await undo grouping = one undo entry.** `deleteTracks` /
      `deleteScenes` / `createTracks` / `createScenes` issue sequential awaits
      inside `withinTransaction` (the SDK doc example uses `Promise.all`). After a
      self-test step, confirm Live's Undo history shows a **single** entry per
      write, not one per element. (The self-test does not assert undo-step counts —
      the real SDK exposes no undo array; verify by eye in Live's Edit menu.)
- [ ] **`lengthBeats` formula for session clips.** Confirm created MIDI clips have
      the expected length in beats.
- [ ] **`mixer.sends[i]` ↔ `returnTracks[i]` ordering.** The batch `set_mixer`
      send targets `returnTracks[0]`; confirm it lands on the correct return.
- [ ] **Group tracks reported as type `"audio"`.** Verify against a set with a
      group track.
- [ ] **`insertDevice` unknown-name behavior.** Confirm inserting an unknown
      device name throws (maps to `INVALID_INPUT`) rather than silently no-op'ing.
- [ ] **`valueItems` populated for quantized params only.** Confirm continuous
      params (e.g. Reverb Dry/Wet) have no `valueItems`.
- [ ] **Handle-cache referential-equality liveness** holds across a session.
- [ ] **`transact` atomicity** — a mid-transaction failure leaves the set in a
      consistent state (services validate before mutating).
