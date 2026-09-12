# Milestone 3 log (append-only)

## 2026-09-11 — Kickoff

- Product owner answered the draft's questions: soft toon ramp without
  outlines; one soldier lost per touching enemy with streams tuned so the
  squad barely clears each wave; font is the tech lead's pick (Cinzel plus
  Nunito); a frame-rate baseline from the iPhone 17 Pro Max to follow.
- Tech lead wrote `09-milestone-3-plan.md` with the pressure bands for
  streams, the performance order, and the team plan.
- Launched in parallel: the FPS toggle task (so the baseline can be read
  without query parameters, which may not reach the game inside the hosted
  page) and the sim streams phase.

## 2026-09-11 — Task T: in-game debug toggle (verified and committed)

- Triple-tap the title wordmark or the level chip toggles the debug panel;
  taps are hit-tested from window pointer events so the targets keep
  `pointer-events: none` and a drag starting on the chip still steers.
  Persisted as `debug` in the save; `?debug` also sets it.
- "Capture 10s" records fps (wall clock, not the clamped loop dt), sim,
  render and physics ms, draw calls, rung, pixel ratio, level and squad
  range into preallocated arrays and shows a 176-character summary, copied
  to the clipboard when allowed.
- Verified on a clean checkout of the commit (the shared tree carried the
  sim phase's in-flight streams): lint clean, three-run smoke passes,
  hosted build 9.28 MB. Ten type errors remain in `debug.ts` for the stream
  event cases added ahead of the sim phase; they resolve when B1 lands.
- Published to the product owner's link as the baseline-measurement build.

## 2026-09-11 — Phase B3: fonts and HUD reduction (verified and committed)

- Cinzel and Nunito fetched from the Google Fonts CSS API (Latin subsets
  only) with OFL licences from the jsDelivr GitHub mirror. Both families are
  served as variable fonts, so one file per family covers the weight range:
  Cinzel 25.9 KB, Nunito 39.1 KB. Manifest entries of kind `font`; the
  single-file builds inline the woff2 files into the `@font-face` rules and
  skip them in the JSON manifest so glyphs never ship twice.
- `fontsReady` promise exported from `src/ui` for the renderer's digit atlas.
- HUD reduced: gate legend, title hint and staff-name flash removed; result
  copy shortened. Cinzel 900 on the wordmark and the count, Cinzel 700 on
  chips, buttons and result numbers, Nunito for body lines.
- Verified in a clean worktree: lint, 152 tests, build, smoke, hosted
  (9.38 MB) and artifact (12.78 MB) builds; both single-file builds render
  Cinzel with every non-document request blocked.
- `balance.ui.legendSeconds` is now unused (sim owner to drop it).

## 2026-09-11 — Baseline from the iPhone 17 Pro Max (Milestone 2 build)

Product owner captures, last 10 s of each level:

| | Level 1 | Level 8 |
|---|---|---|
| frames in 10 s | 566 (56.6 fps average) | 483 (48.3 fps average) |
| fps min / median / max | 34 / 59 / 143 | 23 / 59 / 100 |
| sim ms min / median / max | 0 / 0 / 1 | 0 / 0 / 1 |
| render ms min / median / max | 0 / 7 / 10 | 1 / 7 / 14 |
| physics ms | 0 | 0 to 1 |
| draw calls peak | 29 | 30 |
| ladder rung / pixel ratio (effective / device) | 1 / 1.5 of 3 | 4 / 1.0 of 3 |
| squad | 92 to 112 | 233 to 302 |

Phone warm after eight levels, not hot. Product owner likes the animations
and wants more of them.

Tech lead reading:
- The median frame is fine (59 fps) but there are hitches (minimums of 34
  and 23 fps) and the ladder keeps stepping down, reaching rung 4 (pixel
  ratio 1.0 on a 3× screen) by level 8. The ladder is reacting to spikes,
  not to steady load, and it never steps back up, so the image gets blurrier
  the longer a session runs. Two problems: the spikes, and the ladder.
- 7 ms of CPU inside `scene.render` for 30 draw calls is high; the GUI
  texture redraw and upload each frame is the prime suspect, followed by
  thin-instance buffer uploads and per-frame allocations.
- Likely spike sources: first-use shader compilation when a new effect,
  staff variant or boss material appears (no warm-up exists), garbage
  collection from per-frame allocations, and physics bursts.
- Actions added to Phase A: a shader warm-up pass at level load that force
  compiles every pooled material; ladder retune (95th percentile over 3 s
  with hysteresis, ignore the first 2 s after a level load, first rung
  never below pixel ratio 1.5 on a 3× device, and a per-level reset); the
  digit atlas as planned; allocation audit on the frame path.
- Carried to Phase B2: use more animation (casting variety, idle variety,
  boss reactions, staff swirls), since the product owner wants it.
- Target restated for re-measurement: level 8 minimum above 50 fps, rung
  stays at 0 for a full level, render median under 4 ms.

## 2026-09-11 — Phase A: digit atlas, engine flags, glow off (verified and committed)

- Number labels are one thin-instanced quad mesh reading a 512×450 glyph
  sheet (27 glyphs: digits, `+ - x % .`, the letters of Ember, Storm, Frost,
  Staff) rasterized once from Cinzel with an outline. Immediate-mode API:
  `claim()` at init, `set(id, text, x, y, z, color, scale)` per frame,
  `commit()`. Budget 600 glyphs. The fullscreen GUI texture and the
  `@babylonjs/gui` package are gone (dependency removal left for the tech
  lead); the hosted build drops the GUI CDN script.
- `preserveDrawingBuffer` off except under `?screenshot=1` (smoke URLs
  carry it); MSAA off at effective pixel ratio 1.5 and above; glow layer no
  longer constructed, bolts and impacts additive with a brightness boost;
  pointer-move picking off; road and prop materials and matrices frozen.
- Stress under SwiftShader, three 30 s runs: render median 8.8 → 6.5 ms,
  draw calls 37 → 26. Game peaks 37 / 36 / 39 (were 44 / 46 / 47). Boss
  number now sits above the demon's horns.
- Verified in the shared tree with the sim phase's in-flight streams:
  typecheck, lint, 188 tests, build, smoke, hosted build all pass.
- Follow-up sent to the same agent from the phone baseline: shader warm-up
  at level load, ladder retune, allocation audit.

## 2026-09-11 — Phase B1: enemy streams, 18 m rows, pressure bands (verified and committed)

- Streams spawn 34 m ahead of the squad (projectile range) when the squad
  reaches the row's z, so the plan's window is exact:
  `duration + spawnAhead / (enemySpeed + runSpeed)`.
- Per-body HP is 5 to 8 rather than the plan's 1 to 3: at 1 HP a pressure
  budget is about 14 bodies per soldier and a 3 percent leak would cost 40
  percent of a small squad. Body count is `streamDensity × expected squad`
  (0.8 to 1.3 per soldier) and HP divides the pressure budget across them.
  HP is never shown; the stream shows its remaining count.
- Three mechanisms were needed before pressure predicted anything: a
  targeting-only aim assist of 0.8 m (a 0.4 m body in a 2 m lane was
  otherwise missed by most shots), hitscan batch carry-over (a 300-shot
  batch used to be absorbed by one body), and an empirical `dpsTrim` of
  0.38 for fire spent on gates and the squad running under its curve.
- Pre-existing bug since M2 fixed: projectile sweeps compared against
  positions taken before targets moved, so a closing target could slip
  through the seam between two sweeps (about one encounter in eight). The
  target window now extends by the target's own step.
- Horde lanes are neighbors so the squad can answer both from between
  them; level 1 fills all three lanes on every gate row; `LevelDef.boss.bite`
  scales stomp and contact per level, the one dial that moves survivor
  share per band without touching the road. `levels.json` now declares
  gate, mixed, horde and brute rows explicitly.
- Curve: 16 to 19 rows with 8 to 12 gate rows, 6 to 8 streams per level,
  pressure 0.45 (level 1) to 0.92 (level 9), leaks per stream 0.9 to 3.1
  percent, survivor share 0.75 on levels 1 to 3, 0.41 to 0.68 from 4, boss
  19 to 27 s, road 61 to 72 s.
- Bots on ten seeds: greedy loses 4 of 100 runs (levels 6, 8, 9; clean on
  the contract seeds 1 to 5), random clears level 1 on all ten seeds and
  loses 8.7 of 10 overall, worst loses every level from 2.
- Perf: 300 live bodies plus 300 units at 0.13 ms per tick; lanes compacted
  and insertion-sorted once per step, splash and chain binary-search.
- Contract changes for render, physics, audio and app: `RunState.streams`
  is required; `state.enemies` holds stream bodies (`units: 1`) and is
  compacted 1.1 s after death; events `enemyLeaked`, `streamStarted`,
  `streamCleared`, `unitsLost` reason `leak`; `enemyActivated` fires per
  body (about 20 per second, to be throttled by audio and physics);
  `rowSpacing` 18. Tests 152 → 188.
- Open: the render enemy pool and labels are sized for blocks, not 300
  bodies (Phase B2); `dpsTrim` must be re-measured if Phase C changes how
  fire splits between gates and streams.

## 2026-09-12 — Phase A follow-up: warm-up, ladder retune, allocations (verified and committed)

- `src/render/warmup.ts` force-compiles every material in the scene with
  the thin-instance and VAT variants active (an empty disabled pool is given
  one degenerate instance for the duration so the right variant compiles),
  at init, when physics pools attach, and at run start. Smoke: 111
  materials compiled, 18 shader programs before the first frame, 0 compiled
  during a whole level, identical on all three runs; the smoke fails on any
  growth.
- Ladder: p95 of a 3 s window against 20 ms, two consecutive over-budget
  windows to step, first 2 s after a level start ignored, reset to rung 0
  at every level start, never up within a level, first step 1.5 never 1.0.
  Eleven unit tests with synthetic frame sequences: five 200 ms hitches per
  window do not step, sustained 25 ms frames do. Debug line shows rung,
  reason, p95, heap and a collection counter.
- Allocations removed: a per-frame Map iteration and rebuilt array in the
  staff-gate view, a per-frame Color3 in the boss enrage paint, a spread in
  the glow-target collector. The rest of the frame path audited clean.
- `@babylonjs/gui` uninstalled; `?quality=` documented as rungs 0 to 4;
  `?screenshot=1` documented.
- Checks: typecheck, lint, 199 tests, build, smoke (draw peaks 37 / 36 /
  40; stress 26 calls at 7.3 ms), hosted build 9.38 MB.
- Published as the smoothness-check build for the product owner.

## 2026-09-12 — Phase B2: bright look, magical projectiles, streams on screen (verified and committed)

- Daylight palette: light blue sky to a warm pale horizon, fog pushed out
  (start 46, end 130), light stone road, green field, brighter rune strips,
  hemispheric 0.7 plus a warm key 0.6, emissive lifts cut. Roadside is now
  orange pines and fences with fewer gravestones and no dead trees (a bare
  trunk at the new camera reads as a fallen log).
- Toon ramp: a material plugin injected before fog that bands its own N·L
  into three levels with smoothstep edges (banding the color would collapse
  the KayKit flat atlas), applied to every PBR material before the warm-up
  compile pass. Smoke: 21 shader programs, 0 compiled during play.
- Camera: fov 0.82, height 5.6, behind 11, look-ahead 8, look height 1;
  elevation 27°, horizon at a fifth from the top, rows at 18 and 36 m
  readable. Units 0.78 m; the hat is scaled in the merge at 0.6 (0.8 still
  owned the silhouette; a VAT is bone matrices so the bake cannot scale a
  part). Formation spacing could not be raised without breaking the road
  clamp invariant and the balance tests, so the drawn unit size follows the
  sim's own spacing curve instead (0.78 m at 8 units down to 0.47 at 100+).
  Decision left for Phase C: widening the crowd needs the road clamp or the
  road itself to move, plus a pressure re-calibration.
- Projectiles: one procedural 1024² sprite sheet (fireball, zigzag bolt,
  ice crystal, three impacts, sparkles); projectiles, tails, sparkles,
  impacts, muzzles and the leak puff share one draw call.
- Streams: a body view with no per-body state (liveness and death age come
  from the sim), grunt pool 372, gait variety and speed jitter, deaths as
  the VAT one-shot stretched to the sim's corpse window, one in ten
  reserved for physics ragdolls (`usesRagdoll(id)` in `deathStyle.ts`),
  leak puff, and a floating remaining count per stream.
- More animation: mage cast2 and idle sway, skeleton walk2, boss taunt on
  activation and more frequent hit reactions. VAT re-bake: mage 259 KB,
  minion 175 KB, warrior 127 KB; the bake fails above 300 KB.
- Draw-call peaks 35 / 34 / 38; stress 26 at 6.8 ms.
- Tech lead frame review: hats are still near-black so a large squad reads
  as a dark mass; the title picker sits on bright content without a panel.
  Both go to Phase C with the physics ragdoll rule, audio for leaks and
  stream clears, the stress scene's stream bodies, and the ASSETS.md rows
  for the re-baked files.

## 2026-09-12 — Phase C: integration of streams, audio, physics, look fixes (verified and committed)

- Physics: a stream kill ragdolls only when `usesRagdoll(enemyId)`, the
  same rule the render skips on; stream kills throw no shards; blocks,
  brutes and the boss keep their bursts. Bug found: the turbo event copier
  dropped `streamId`, so the rule could not have worked; fixed with a test.
  Burst geometry moved to `src/physics/bursts.ts`.
- Audio: stream kills reuse the hit clip at a lower pitch capped at 8 per
  second, leaks reuse the units-lost clip at 6 per second, a cleared stream
  plays a bright chime; `enemyActivated` is silent; numbers in
  `src/data/audio.json`; six tests.
- Look: the dark mass was the mages' hair, not the hat, and the hat at
  0.6 sat below the fit floor (about 0.85) so it was worn as a ring; hat at
  0.88 with per-UV-patch tints (violet crown, lighter brim, gold band,
  sandy hair). Title: purple gradient gone, frosted warm panel behind the
  picker and Play.
- Stress scene now includes 300 stream bodies in the same crowd as the
  block skeletons (25 draw calls). Bug found: the stress scene never ran
  the warm-up, so its first corpse compiled a shader inside `scene.render`
  (a reproducible 14.6 s frame); fixed. Tripwire re-baselined to 12 ms
  (twice the measured median band); `SMOKE_STRESS_RENDER_MS` overrides.
- Cleanups: glow code and rung removed everywhere, `legendSeconds` gone,
  ASSETS.md refreshed for the re-baked files (3.4 MB total).
- Numbers: draw peaks 35 / 34 / 38; stress 5.0 ms median; warm-up 103
  materials, 0 compiles during play; tests 206; hosted 9.77 MB, artifact
  13.11 MB; both verified offline at physics quality 2 with Cinzel loaded.
- Published to the product owner as the full Milestone 3 build for the
  look check and the frame-rate re-measurement.

## 2026-09-12 — Phase D: review and hardening (verified and committed)

- Fixed (medium): the renderer's mirrored physics quality started at 2
  while Havok was still loading, so early deaths it expected physics to
  handle vanished without animation; it now starts at 0 and the app raises
  it when the layer is up. The landscape layout query excluded short
  landscape phones, leaving Play below the fold; re-measured on seven
  viewports.
- Fixed (low): frost shatter on stream bodies played the shatter sound and
  drew a second impact per body; lane lists filed targets with the default
  lane width instead of the run's; a dead bot helper removed; title-screen
  frames reported the previous run's timings.
- Deferred with reasons: the thin-instance user buffers upload full size
  each frame (about 68 KB) because Babylon's partial update path would
  break after a context restore; aim assist puts many center-lane bodies
  in all three lane lists; the grunt pool of 372 can truncate a horde plus
  three block rows (now visible in `?debug`); a pooled event object drops to
  dictionary mode on block kills.
- Checked clean: stream bookkeeping is recomputed each settle, ids are
  never reused, compaction is safe, hitscan carry-over cannot double-kill,
  pressure sizing chews a weak squad rather than stalling, determinism
  intact, no per-frame allocations in the new paths, the inline plugin
  covers every asset kind.
- Stress tripwire samples three 8 s windows and fails only when two exceed
  12 ms. Splits: theme, Renderer, smoke and styles into palette, pools,
  rendererEvents, smoke-run, smoke-stress and screens. `?debug` gains live
  stream bodies and label glyph counts.
- Tests 206 → 211. Draw peaks 35 / 34 / 38; stress 26 calls at 4.8 to 9.4
  ms; hosted 9.77 MB, artifact 13.11 MB.

## Milestone 3 status

| Definition of done | Status |
|---|---|
| 1. Checks and balance bands | Done: 211 tests, greedy clean on the contract seeds, random clears level 1, bands per level as logged in B1 |
| 2. 60 fps at level 8 on the iPhone 17 Pro Max, feels smooth | Pending the product owner's re-measurement on this build |
| 3. Frames: daylight, mages read, magical projectiles, streams dying as they come, boss number above head, Cinzel, minimal HUD | Done |
| 4. Offline builds under budget with fonts embedded, no GUI texture | Done: hosted 9.77 MB, artifact 13.11 MB |
| 5. Docs and ledger D28 to D31 | Done |

Carried forward: the deferred items above; the crowd-width question
(formation spacing versus the road clamp) from Phase B2; the Phase B1
`dpsTrim` fudge to re-measure if fire splitting changes.
