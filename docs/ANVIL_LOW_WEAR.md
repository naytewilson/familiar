# Familiar ANVIL: low-wear observation design and acceptance

Status: source candidate (not installed). Base: upstream/main at
`a95bdb96ce88f1d32226ee8d0600883c72e759a4` (2026-08-04).
Target: `naytewilson/familiar`, branch `anvil/low-wear-observation-20261026`.

## Objective

Keep the useful observation stream and the existing 5-second (15-second Low Power
Mode) change-detection opportunity while reducing unnecessary WebP encoding,
Apple Vision OCR jobs, screenshot writes and redaction work on a small-memory
daily-driver Mac. Heavy engineering and test work belongs on Dell.

**Not claimed:** An unchanged CPU/GPU screenshot cost, a measured energy/SSD
endurance improvement, exact preservation of duplicate timestamped Markdown,
or full ANVIL MCP/Drive OS integration. Those are separate acceptance surfaces.

## Behavior

- Every active capture tick still requests the current display thumbnail.
- An exact SHA-256 digest of the already-produced PNG, combined with display
  source/size and a canonical snapshot of the active and visible app/window
  metadata, is compared to the last **successfully recorded** frame.
- When identical and under 30 seconds since the last saved frame, the sample
  is discarded before renderer WebP encoding, image persistence and OCR
  enqueue. There is no perceptual threshold: even one changed byte records.
- A 30-second unchanged-content checkpoint persists a fresh frame so timeline
  presence does not disappear during long static work.
- Missing PNG, missing/unstable window metadata, backwards/invalid clock time,
  changed display, changed title/window or changed PNG all follow the original
  capture path. Blacklisted applications still override capture before writes.
- The deduplicator commits a candidate only after successful image storage
  and non-failed OCR queue insertion. A failed capture must never authorize
  dropping the following sample. State resets for new sessions.
- Session-stop logs include aggregate sampled, skipped, saved and checkpoint
  counters. No per-skip log writes are needed.

## Synthetic static-window workload

At five seconds: 720 capture opportunities/hour. With unchanged screenshot
PNG and window metadata, a 30-second checkpoint records approximately 120
frames/hour instead of 720: **600 fewer stored images and OCR jobs (83.3%)**.
An eight-hour uninterrupted static window would record 960 instead of 5,760.

This is a deterministic source-level scenario, **not** a Neo power/thermal
measurement. Live motion, app notifications, pointer changes and other PNG
differences lower the actual skip ratio. The frame sampling itself continues.

## Privacy and storage

- An absent or failing rg scanner produces empty content with a drop marker,
  not unredacted text. A child scanner that exits early cannot crash the
  application from an unhandled stdin EPIPE.
- OCR markdown writer refuses scanner bypass and requeues affected work. Its
  retry loop uses a 30-second cooldown instead of repeating expensive OCR
  on every worker tick while the scanner remains down.
- Clipboard and meeting transcript writers refuse scanner bypass. Clipboard
  content dropped by the sensitive-content rules does not create a text file;
  an unavailable scanner is retried after a 30-second cooldown.
- New WebP screenshots, clipboard text, OCR Markdown and transcript initial
  files are created mode 0600. This does not encrypt screenshots or hide
  them from the owner or authorized local processes.
- Images follow the existing 2-day default/7-day optional retention policy.
  Existing OCR Markdown/transcript history is deliberately preserved for
  contextual recall. **No claim of bounded total text history** is made.
  ANVIL ingestion and receipt-proven compaction must precede text expiry.
- Do not upload raw screenshots, full clipboard histories or meeting transcripts
  to Dell, Drive OS or third-party models just to make integration easier.
  A future bridge should expose only relevant filtered, provenance-bound
  observations through the existing authorized read surface.

## Fork separation

Electron app ID: `com.nayte.familiar-anvil`.
Product name: `Familiar ANVIL`.
Updater/publisher: `naytewilson/familiar`; no upstream Familiar auto-update
feed is inherited by this forked build. No new release was published.
Existing installed upstream Familiar remains untouched.

## Validation performed on Dell

- Added a regression test that was **RED** on the original recorder: duplicate
  PNGs previously generated a second rendered image and second OCR job.
- Source-level tests cover changed PNG bytes, window titles, display switches,
  sorted window-list equivalence, 30-second checkpoint, missing context, and
  uncommitted/unstable captures.
- Security tests cover a failing rg subprocess, scanner bypass in three writer
  types, sensitive-content drops, and 30-second retry cooldowns.
- Full `npm test` on Linux with Node 22 and `FAMILIAR_RG_BINARY=/usr/bin/rg`:
  one known preexisting checkout-layout failure remains in
  `test/publish-desktopapp-local-script.test.js` because it expects a script
  outside this standalone repository. This is **not** a passing full suite.
  All other available Node tests in that run passed.

## Remaining native acceptance on Neo (not yet performed)

1. Build native Apple Vision OCR and window-list helpers with Xcode on an
   isolated candidate checkout. Do not replace the installed app.
2. Run a controlled synthetic macOS UI recording with fixed image/window
   fixtures. Compare timestamps, raw image/Markdown parity for changed frames,
   OCR output, blacklist behavior, and checkpoint frequency.
3. Compare baseline vs candidate process CPU, wakeups, memory pressure, disk
   bytes written, peak RSS and responsiveness over matched sessions. The
   performance claim is not qualified until this is measured.
4. Prove correct handling of display changes, password dialogs, screen-lock,
   sleep/wake, scanner outage/recovery, renderer failure and disk-full cases.
5. Independent source review, reproducible arm64 packaging/signing, updater
   isolation, rollback preservation and exact installed artifact readback.
6. Integrate ANVIL observations via the existing fabric's read-only,
   provenance-bound contracts; do not create a second agent authority.

## Reentry

The minimal next mission is a native macOS qualification and read-only
ANVIL observation adapter. It should not be conflated with merging this source
candidate, signing a release, or deploying a new background capture service.
