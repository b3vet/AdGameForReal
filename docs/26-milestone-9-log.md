# Milestone 9 log (append-only)

## 2026-09-15 — Kickoff

- Product owner: plan and implement Milestone 9; icon and splash will come
  from their AI image generator (this side ships placeholders and the
  prompts); they will clone the repository on a Mac, replace the art, build
  and install on their iPhone, play the campaign through and send feedback.
  New process rule recorded in CLAUDE.md and the ledger (D56): at most
  five parallel general-purpose Opus agents.
- Plan written as document 25. Wave one launched with four agents: A art
  pipeline, B native shell polish, C project and guides, D device report.
  Wave two is one integration-and-review agent.

## 2026-09-15 — Wave one: art, shell, projects and guides, device report (verified and committed)

- A, art: `scripts/app-art.mjs` renders one palette-driven hat mark
  through headless Chromium into the icon (1024, no alpha), the Android
  adaptive layers, and the light and dark splashes (2732, subject inside
  the centre 40 percent, edges exactly the shell colour read out of
  capacitor.config.ts so launch cannot flash); every PNG under 400 KB
  and byte-identical across runs; `public/` gains the favicon, apple
  touch icon, manifest icons and a web manifest linked from index.html;
  the single-file builds carry none of it. `docs/ART.md` holds the files,
  sizes, safe zones, the regenerate command and the three prompts for
  the owner's generator (icon, splash, dark variant).
- B, shell: safe-area padding moved from the overlay root to each
  screen's column so the result sheet and the Academy paint under the
  notch and home indicator (probed at 390×844 with 47 and 34 px insets:
  every box inside the limits, the sheet covering the glass); touch
  rules on html, body and the canvas; `dvh` beside every `vh` that sizes
  layout; portrait lock at boot; pause and resume from the app-state
  plugin on native and visibility on the web through one lifecycle
  signal, the frame loop refusing to start while suspended and reporting
  a zero-length frame on the way back (a four-minute gap runs no steps),
  audio suspended and the save flushed on background; WebGL context loss
  answered with preventDefault, the rebuild hung off Babylon's own
  restore observable, and the one thing Babylon does not restore, thin
  instance buffers written once, re-uploaded from the arrays we hold (19
  meshes on level 1; without it the roadside came back as specks at the
  origin); haptics for gate pass, shield break, a charger setting off, a
  meteor, a boss charge, the wipe, and mission or tier awards, throttled
  to one impact per 120 ms. Probe scripts for the insets and the context
  loss live in `scripts/`.
- C, projects: both native projects generated here without Xcode or
  Android Studio and committed with build products ignored; Info.plist
  portrait only, full screen, status bar hidden, encryption declared,
  arm64, version and build from package.json (0.9.0 → 900, derived and
  idempotent); a privacy manifest declaring no tracking, no collected
  data, and the required-reason APIs WebKit's storage and Capacitor's
  asset handler use (user defaults, file timestamps, disk space); the
  launch storyboard painted the shell colour; iPhone only (a judgement
  call, one line to revert); plugins pinned (app, screen-orientation,
  android, the assets generator); scripts `cap:assets`, `cap:version`,
  `cap:sync`, `cap:open` and their Android twins; the preflight split
  into three files and checking art sizes from PNG headers, plist keys,
  the manifest's registration, the version stamp, plugin registration
  and freshness, and printing the owner's next command; `docs/DEVICE.md`
  rewritten for clone → install → drop art → assets → sync → open →
  sign → run; `docs/STORE.md` drafted with counted fields and two
  decisions marked for the owner. Finding: the shell colour `#bfe4f5`
  has drifted from the page background `#8fc6f2`, so launch steps
  through two blues; a preflight warning names it.
- D, report: a six-section plain-text device report (device, quality,
  capture, run, save) behind "Copy report" with a WebView fallback and
  "Show report" for a screenshot; `?perf` boots the highest reached
  level up to 20 with the bot, waits for warm-up, captures 30 s and shows
  and copies the report; version and build kind stamped into every
  bundle; the capture block now reads median and p95; the debug panel had
  been painting under the screens since the Academy shipped (fixed with
  one positioning rule). Rung 0 at native pixel ratio 3 confirmed by
  reading; the ladder's numbers are code constants rather than data.
- Verified on the quiet box: typecheck 0 errors, lint clean, build OK,
  preflight PASS, 575 tests. Under four concurrent suites on four cores
  the same suite had timed out in nine files; nothing under the sim
  changed, and each named file passed alone.
- Carried to wave two: the shell colour (decision: move the shell to the
  page's colour and regenerate the art and catalogues); a test timeout
  sized for the campaign sweeps; the smoke on the quiet tree; the
  duplicate art copy in `dist/assets/app`; the smoke server's manifest
  MIME; the orphan splash files the generator recreates; probe script
  lines in package.json; `Renderer.ts` 489, `frame.ts` 457, `App.ts` 454.

## 2026-09-15 — Wave two: integration and review (verified and committed)

- The native shell takes the page's colour: `APP_BACKGROUND` is
  `--c-sky-mid` (`#8fc6f2`) with the launch storyboard, the theme colour,
  the manifest and the asset generator's flags following; the placeholders
  and catalogues regenerated, the preflight no longer warns. Correction:
  the orphan splash files come from Capacitor's iOS template, not the
  generator; a clean-up step after `cap:assets` now removes any catalogue
  image its manifest does not name, so the command leaves the tree clean.
- A test timeout of two minutes (every test over four seconds already
  carries its own budget; the slowest without one is under four, so this is
  thirty times headroom and still fails a hang in minutes). Smoke PASS on
  the quiet tree in 21 min 21 s with a mid-run visibility pause check
  riding the shotless random run at turbo 1 (the clock held exactly across
  a second of wall time, then ran on); context loss stays a probe, both
  probes have script lines and rows in the device guide. The duplicate
  art copy filtered out of `dist` (944 KB); the manifest MIME in the
  smoke server.
- Review fixes: the frame loop's `stop` during a pause was ignored and a
  level load during a pause was lost (a start is now remembered across a
  pause and acted on at resume; a zero timestamp no longer reads as "no
  previous frame"); a native listener resolving after its stop leaked
  through a generation epoch; the report survives a throwing source with a
  dash; a renderer disposed mid-boot no longer leaves a live engine and
  two canvas listeners behind; the preflight checks the third
  required-reason category; `cap:version` rejects pre-release strings and
  overflowing parts. `frame.ts` 491 → 396 with `frameStats.ts`. Docs ART,
  ASSETS and DEVICE corrected for the colour and the filter.
- Not fixed, reported: the haptic throttle is global across weights (a
  light gate tap can swallow a heavy meteor 50 ms later; a feel call after
  the playtest); the context-loss re-upload restores matrix buffers only,
  complete today because every custom buffer is rewritten each frame (the
  invariant is written beside the code); `Renderer.ts` 502 and `App.ts`
  454 have no clean seam; the hosted build has 90 KB of headroom under
  its ceiling.
- Verified on the quiet tree: typecheck 0 errors, lint clean, 579 tests,
  build OK, hosted 11.91 MB, artifact 15.26 MB, preflight PASS with
  `next: npm run cap:open` after a sync, smoke PASS, both device probes
  PASS. Corrections to the wave-one entry: the loop remembers a start
  during a pause rather than refusing it; `frame.ts` is 396 and
  `Renderer.ts` 502.

## Milestone 9 status

| Definition of done | Status |
|---|---|
| 1. Fresh clone on a Mac: install, drop two PNGs, `cap:assets`, `cap:sync`, `cap:open`, sign, run; the guide says exactly that and the preflight proves what it can | Done here as far as a Mac-less container can prove: projects committed, plist and manifest checked, next command printed; the Xcode steps are the owner's |
| 2. Placeholders and prompts; favicon and manifest | Done |
| 3. Safe areas at 390×844 with 47 and 34 px insets; pause and resume in the smoke; context loss simulated with the run continuing | Done: probe and smoke check green |
| 4. Haptics wired and throttled with tests; the report copies | Done |
| 5. All checks, smoke, hosted build, log, ledger | Done: D56 and D57, hosted build Version 19 |

Open for the product owner: the haptic throttle across weights; iPhone
only in the project (one line to revert for iPad); the age-rating
severity and the secondary category marked in `docs/STORE.md`; the
ladder's numbers live in code rather than data if the phone needs them
moved; the generated Android landscape splash drawables are dead weight
on a portrait app.
