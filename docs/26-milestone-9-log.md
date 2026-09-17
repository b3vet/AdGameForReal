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

## 2026-09-16 — After the close: the first device run (doc 27)

- The owner ran the app on their iPhone (6.9-inch Pro Max, iOS 27.0 beta)
  and reported a stretched scene and no way to pause. Before either, Xcode
  refused `LaunchScreen.storyboard`: a comment held `--c-sky-mid`, and XML
  forbids a double hyphen inside a comment. Reworded; every storyboard,
  plist and XML file under `ios/` and `android/` checked with `xmllint`.
- A, stretched scene: the screenshot's detail is native along x and about
  a 2x upscale along y, which is a 1320×1320 backing store on a 440×956
  canvas. Babylon sizes the store only when told; the only caller was a
  window `resize` listener attached after the boot, seconds in on a phone.
  No iOS 27 simulator exists here and iOS 26.3 launched correctly, so the
  mechanism was reproduced instead: a window started square and resized a
  second later fired its `resize` 270 ms before the app listened, and
  the square store stayed for the whole session, matching the owner's
  frame down to its spectrum. Fixed by `src/render/backingStore.ts`
  (D58), started when the engine exists; the device report and the debug
  panel now print the canvas's three sizes and a shape verdict. Why iOS 27
  resizes the web view during launch is not established; the next report
  says whether the shape is right.
- B, pause: a round button under the sound button on a portrait phone
  (beside it from 540 px up; side by side, the staff badge ran over it
  with a three-digit count at 375 and 320 px), a menu with Resume,
  Restart level and Home over the dimmed frozen frame, P and Escape on a
  keyboard, and a return from the background mid-run landing on the menu
  (D59). Abandoning pays nothing, held by `abandon.test.ts` with a
  control case that does pay. The frozen frame survives a resize, a
  return and a context restore; after a restore it is redrawn until the
  scene is ready, because one redraw left the trees missing for 4 s.
- C, sound (found on the way): all seventeen clips logged `failed to load
  {}` in the simulator. The real error was `HTTP 0`: Capacitor's iOS file
  server answers media extensions with a bare `URLResponse`, no status,
  and Babylon's sound loader refuses anything not `ok`. Clips now come
  through `assetBytes` (status 0 with a body accepted, one `Range` retry,
  which that server answers as a proper 206) and reach Babylon as bytes;
  failed clips retry once on unlock; warnings print `name: message`
  (D60). In the simulator: 17 loaded, `play()` reached with the context
  running. Heard on a phone: not yet.
- Verified: typecheck 0 errors, lint clean, 649 tests (6 skipped), smoke
  PASS in 460 s including the new pause check and the visibility check
  now landing on the menu, preflight PASS after `cap:sync`. On the
  simulator (iPhone 17 Pro Max, iOS 26.3) by the tech lead: a level 3 run
  in the web build's proportions, Pause freezing the frame (two shots 3 s
  apart byte-identical), Resume, background and return landing on the
  menu over a correct frame, Home back to the Academy, no crashes and no
  app errors in the log.
- Environment: Playwright's browser cache under `~/Library/Caches`
  vanished mid-session (not by an agent's command as far as the reports
  show) and was reinstalled with `npx playwright install chromium`.
- Left: the owner's next device run (shape line in the report, sound on
  the phone, pause feel); `Renderer.ts` is 547 lines and `debug.ts` 440,
  both past the file-size rule and due a split; at 320 px with a
  three-digit count the level chip wraps and the sound button touches the
  staff badge (older than this change). The owner's new art and their
  Xcode signing changes are in the working tree and were not committed.

## 2026-09-17 — Playtest rounds 2 and 3 (docs 28 to 31)

- Round 2 (doc 28), twelve notes from the owner's phone, four agents with a
  slot kept free.
  - UI-1: the two replay buttons never walked different roads (campaign
    levels have a fixed seed; Endless "Again" re-rolled to the seed "Same
    road" pinned), so one Retry, with Continue and Home. No purse line, no
    next-unlock row, no scrolling at 375×667, 390×844 and 440×956 (the
    fullest sheet still scrolls its bonus list in landscape). One coin chip,
    pinned top left under the safe area on every non-run screen. On the way:
    the confetti canvas had been sizing the won sheet's grid on a landscape
    phone. D61.
  - UI-2: the kit button's press shrank its bottom border by 5 px and moved
    the panel; the depth is now painted outside the box (measured 0 px of
    movement for every control kind). Scroll bars hidden everywhere; every
    radius square except the round buttons, held by a test. The picker leads
    with a Play card; Endless is a quiet card locked until level 3. D62.
  - SIM: the double gate was one path, 18 rows in 4,946 on the human bot:
    stragglers cut off on the step the column crossed a row, placed behind
    it, took a second gate. One gate per row now; level 19 and 34 retuned by
    one number each to keep their boss-duration bands. Endless gets a boss
    at the end of every span and steeper batches; the human bot on the
    level-20 kit went from a 1,964 m median to 1,169 m (then 1,083 m with
    round 3's charge), nine runs in ten ending between the second and fourth
    boss. D63, D64.
  - PERF: on the Mac's GPU at the phone's 1320×2868, about 70 percent of a
    busy frame was the crowd's triangles (up to 4 M a frame), and resolution
    steps barely moved it; Havok's step hid inside `scene.render`; a 120 Hz
    display doubled the work. Crowd culling and a load-time low-polygon copy,
    a 60 fps pacer, a leaner Havok step and a ladder that drops crowd detail
    and then ratio 2.5 before 2: GPU time 31 to 41 percent lower in every
    busy scene, frame JS 16 to 37 percent lower under a 4× CPU throttle. The
    phone is the judge; the report now says where the time goes. D65, D66.
    The Endless smoke run peaks at 54 draw calls (the mid-road boss and its
    ragdolls); its ceiling is 56, the campaign's stays 52. D67.
- Round 3 (doc 29), asked for while round 2 was being integrated.
  - FIX-PICKER: one mutable level did three jobs, and only Continue moved it
    forward, so Home after a clear reopened the picker on the old level. The
    URL's level, the picker's level and the walked level now have one owner
    each; 16 tests over every path. D68.
  - FIX-CHARGE: the Rime Fiend's charge took 6 percent of the squad spread
    along its whole path from its stand, 43 percent of those deaths before
    the body reached the column, nothing extra at impact, and no lane check.
    It now kills whoever is under its body when it lands, up to 7 percent,
    after a 0.6 s lane commitment a thumb can answer; the landing has its own
    ring, burst, shake, haptic and voice. Frostfell bands hold (clear 0.725).
    D69.
  - DESIGN (game-expert): 560 bot runs measured the owner's complaint: the
    boss takes 74 to 81 percent of the human bot's losses, 62 to 67 percent
    of threats cost greedy nothing, blocks wake 26 m out, 98 to 100 percent
    of gate rows carry a curse greedy never takes, and threats land in the
    best lane at chance. Draft plan: document 30. The owner answered its
    questions with the recommended defaults on 2026-09-17; the approved plan
    is document 31. D70.
- Verified on the integrated tree: typecheck and lint clean, 754 tests (6
  skipped), smoke PASS in 330 s (after D67), preflight PASS after
  `cap:sync`, a Release simulator build (iPhone 17 Pro Max, iOS 26.3) on the
  home, the picker opening on the newest level, a level 3 run to a lost
  sheet with Retry and Home and the chip in place, and no app errors in the
  log.
- Left: the owner's device report after rounds 2 and 3; the bots never dodge
  the Rime Fiend, so Frostfell bands describe a player who never does; old
  Endless bests above about 1,600 m are now out of reach; `Run.ts` 500
  lines, `crowd.ts` 406, `Renderer.ts` 514, `academy.ts` 403, `overlay.ts`
  408, `boss.ts` 397 are at or past the file-size rule. Phase 1 of document
  31 starts on this commit.

## 2026-09-17 — Level design Phase 1 (docs 31 and 32), integrated

- The owner answered document 30's questions with its defaults (hard road,
  same clears; authored scripts; bests and stars kept; all 40 levels at
  once) and asked for a TestFlight build when this lands, as version 1.0.
  Release setup went in first (f81d1b7): 1.0.0, build 10000, the owner's
  art, their signing team and the App Store export options.
- Wave one (checkpoint 3328d22): the beat composer, portals, per-enemy wake
  and share-of-squad rates (SIM-GRAMMAR); priced bots, the beat lab and the
  design readout (BOTS-LAB); eight beats as eleven ids and 40 scripts held
  by static tests (CONTENT); sight lines, portal rings, wake cues,
  see-through plaques and `?beat=` (RENDER-CORE). Found on the way: the
  staff pass took the designed plus (staffs now stand on open and rest
  beats only; 18 levels offer one staff), and the new human bot plays the
  old campaign as well as greedy (0.71 to 1.00 clears), its handicap now
  timing and sight.
- Wave two. BEAT-FIX: beats could be sidestepped (a column waited next door
  and slid in behind a walking guard or a cut pour), so guards hold the
  gateway and rivers are timed by their tail; the fork got a real choice;
  river sizing counts bunching; the curve reads shot-up pluses (measured
  arrival over E from up to 1.86 to at most 1.24). TESTS-BANDS: section 5
  as tests, with rulings (sizes per used tier; greedy's worst under the top
  band; the block end-gap row retired by the hold line). TUNE-SHARED: beat
  lab Meadow 19 to 96 of 96 cells in band, Frostfell 20 to 121 of 123;
  brute hit points per unit 12 to 120; a lab road that started inside
  greedy's read fixed. RENDER-FIX: held blocks braced, label ink measured,
  the beat hero page wired in.
- The wall: TUNE-MEADOW showed no boss numbers hold clears, survivors and
  road share together, because squads reached the boss at 0.92 to 1.00 of a
  capped peak with a 5 to 15 percent spread. Ruling, document 32: growth
  earlier, peaks under the cap, a prep gauntlet, a threat after the last
  multiplier, a flipped curse that pays. Then D76: the priced bot is no
  stand-in for 70 to 80 percent, so ordinary clears are held at 0.88 to
  0.98 on it until the owner's device run. D77 re-priced the Yard.
  TUNE-FROST put the Yard kit into the curve (arrival 1.09 to 1.23 of E
  down to 0.87 to 1.13) and landed on one frontier a hair outside four
  bands; D78 holds them at that edge.
- Where it landed (human bot; Meadow / Frostfell): ordinary clears 0.976 /
  0.988; road share of losses 0.454 / 0.450 (was 0.27 / 0.37 on the dealt
  roads); survivors 0.425 / 0.501 (was 0.72 / 0.46); boss fights 22 to 28 s
  / 20 to 29 s; dents per level 4.3 / 4.7; greedy takes a red lane 0.062 /
  0.077 (was 0.004); milestones armed 0.5 to 0.6 and bare 0.0 to 0.2 on
  every one; peak live enemies at most 122. Cadence 1.67 runs per purchase
  on levels 1 to 5 and 2.6 to 3.7 on 6 to 10; the campaign reaches level 40.
- SMOKE-FIX: three shot plans were pinned to the dealt levels (the Rime
  Fiend enraged before its first charge on level 23; level 16 has no fence
  now); the Frostfell run and hero page moved to level 27 seed 29 with the
  campaign's real kit, the swipe page to level 15.
- Verified: typecheck and lint clean; 961 tests (8 skipped) with the
  scripted pins recorded by `RECORD=1` (dealt pins unmoved); smoke PASS in
  374 s.
- Left: the owner's device run is now the judge of every band D76 and D78
  hold at the bot; the prep ring is not visible behind a plaque inside
  45 m; 18 levels offer one staff; Phase 2 (set pieces, Endless on beats)
  when the owner asks.
