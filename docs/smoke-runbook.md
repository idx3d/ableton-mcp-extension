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

- [x] `npm test && npm run typecheck && npm run lint` green (CI world).
- [x] `npm run typecheck:sdk` + `npm run build` + `npm run package` green with the SDK.
- [x] `.ablx` artifact produced locally; nothing Ableton-derived committed.
- [x] **Self-test green on macOS** — Live 12.4.5b8, 2026-07-24, **20/20, 0 failed**
      (required the ADR 0009 fixes: `global`→`globalThis`, custom `node:http` transport + host-globals prelude, and `toNumber` bigint coercion).
- [ ] **Self-test green on Windows** (all checks PASS, 0 failed).
- [ ] Only then tag `v0.1.0`.

## Deferred in-Live verifications

These are assumptions baked into the SDK adapter (all commented in code) that
FakeLive cannot prove. Status below reflects the **2026-07-24 macOS run (20/20)**.
The unchecked ones passed indirectly but were not _asserted_ — confirm by eye when
convenient (they are not release blockers given the green run).

- [x] **Clip color always present.** Fresh clips read back a `color`; no contract
      check tripped. (Also surfaced the bigint-color crash — fixed, ADR 0009.)
- [x] **Color mapping (`0xRRGGBB`).** `update_clip color round-trips (#FF5500)`
      passed — `colorFromHex`/`colorToHex` packing is correct against real Live.
- [ ] **Sequential-await undo grouping = one undo entry.** Not asserted (the SDK
      exposes no undo array). Verify by eye in Live's Edit menu when convenient.
- [x] **`lengthBeats` formula for session clips.** MIDI clips created and read back
      cleanly (drum/bass note round-trips + edit_clip_notes thinning all passed).
- [x] **`mixer.sends[i]` ↔ `returnTracks[i]` ordering.** `batch set_mixer send r1
→ 0.25` landed on the correct return.
- [ ] **Group tracks reported as type `"audio"`.** Not exercised (no group track in
      the self-test set). Verify against a set with a group track.
- [ ] **`insertDevice` unknown-name behavior.** Not exercised (only the known name
      "Reverb" was inserted, which passed). Confirm an unknown name → `INVALID_INPUT`.
- [x] **`valueItems` populated for quantized params only.** Reverb Dry/Wet + Decay
      Time (continuous) set cleanly with no `valueItems` shape issues.
- [x] **Handle-cache referential-equality liveness** — stale-ID-after-delete →
      `NOT_FOUND` passed, exercising handle resolution across the session.
- [ ] **`transact` atomicity** — writes ran through `withinTransaction` and the set
      was left clean, but no _mid-transaction failure_ path was forced. Optional.

### Known follow-up (not a release blocker)

The stdio-bridge connection-file write is **denied in-Live** — the host sandboxes
filesystem writes to `storageDirectory`/`tempDirectory`, but the bridge writes to a
fixed OS path (`~/Library/Application Support/ableton-mcp/`). The write is best-effort
(caught, logged), so it does not affect the extension or the self-test, but the
bridge's file-based auto-discovery does not work in-Live. Revisit the bridge's
discovery mechanism (env-var config, or write into `storageDirectory`) as a follow-up.
