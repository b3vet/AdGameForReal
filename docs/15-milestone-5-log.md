# Milestone 5 log (append-only)

## 2026-09-15 — Kickoff

- Product owner asked for a design and graphics milestone: line-filling
  horde, smooth movement, long view, native resolution, a coherent palette,
  crafted road and gates, and a game UI. Tech lead made the design calls
  (palette in `src/data/palette.json`, Kenney Fantasy UI Borders for the
  UI kit, KayKit Dungeon pieces for gates and walls, ambientCG cobblestone
  for the road) and launched four tracks in parallel.

## 2026-09-13 — Phase B: line formation and spring movement (verified and committed)

- Formation rewritten as hex-packed staggered rows across the available
  band, anchor at the front center, depth extending backward only; spacing
  0.42 → 0.28 m on the square root of count; cached per width bucket,
  allocation-free on hits. Open road band 4.4 m: 10 to 16 columns, half
  width saturating at 2.2 m, depth 7.2 m at 500 units (33 rows). Under a
  wall the band drops to 2.35 m or 1.2 m and the keep-off includes the
  unit's half extent, so no unit ever stands through a fence.
- Deviation: the plan's 0.6 m clamp floor makes side gates unreachable
  (lane resolution needs |x| ≥ 1); the floor is 1.2 m, so the widest crowd
  overhangs the verge by 0.4 m, the figure accepted in Milestone 4.
- Lateral motion is a critically damped spring (12 rad/s) capped by speed 8
  and acceleration 40; the caps shape most of the motion so campaign
  timings survive; velocity zeroes against a wall.
- Balance re-measured: a crowd twice as wide at small counts spreads fire
  over three lanes and makes blocks undodgeable, so `dpsTrim` 0.38 → 0.26,
  weapon worth 0.8 → 0.5, enrage at 0.27; three bot fixes were required
  (reachability through the real tapered clamp, side choice scoring the
  guarded row, staff value damped by road remaining). Greedy 100 of 100,
  survivors 0.72 to 0.77 early and 0.45 to 0.64 late, boss 19.5 to 26 s.
  Goldens re-captured for levels 1 to 3 with the reason noted.
- Render: per-unit first-order follow with rate 26 → 8 by row over ten
  rows, yaw lean from lateral velocity, a 1.2 m snap leash that covers
  turbo; hop, sway and pop-in preserved. Sim tests 221 → 234.
- For the render core and Phase E: the crowd is 7.2 m deep at 500 units
  and runs off the bottom of the frame; the camera needs the extra depth.

## 2026-09-13 — Phase A: rendering quality core (verified and committed)

- `palette.ts` reads `palette.json` and exposes every role as a cached
  `Color3` with a typed dotted-path accessor; every Milestone 3 export name
  survives as a role lookup; no hex or color literal left in `palette.ts` or
  `theme.ts`.
- Rungs: pixel ratio 3 / 2 / 1.5 / 1 / 1 / 1 with physics 2, 2, 2, 2, 1, 0;
  rung 0 is native with no device sniffing; the debug rung line shows the
  effective ratio. 13 ladder tests.
- Long view: fog 120 to 260, road constants moved to theme, camera far
  plane 520; a hand-built sky dome with vertex-color gradient crowded at
  the horizon, a seeded hill ridge in the haze color, and a tileable cloud
  cylinder from normalized fbm noise scrolling slowly; both frozen and
  warmed.
- Tone mapping in materials: ACES at exposure 1.45, contrast 1.1, a
  multiply vignette. A swatch harness measures palette fidelity: rms 17 of
  255 (worst 40 on the deep danger red); KHR PBR Neutral at exposure 1.185
  measures rms 11 and is one constant away. Warm-up 108 materials, 0
  compiles during play.
- Blob shadows: one thin-instanced disc with a radial texture, wired for
  props and the boss; the squad and enemy views call it in Phase E.
- Camera: a critically damped lateral spring and a small roll from lateral
  velocity; the Academy backdrop capped at 30 fps.
- Draw peaks 37 / 36 / 39 / 40 (sky and shadows add 2, the far plane adds
  the arena band on long levels); stress first-window median 7.4 → 4.3 ms.
- Open: `query.ts` comments still say five rungs; the prop view caps at 56
  per kind so a 440 m road runs out of dressing; the swatch harness could
  move into `scripts/`.

## 2026-09-13 — Phase D: game UI kit (verified in a clean worktree and committed)

- Frames and buttons lifted from Kenney's vector sheets as individual SVGs
  with palette colors baked in (gold gradient frames, parchment fills):
  eight files, 10 KB. Icons are a hand-drawn symbol sprite in the page.
  Licences recorded; ASSETS.md rows added.
- `scripts/palette-css.mjs` generates the checked-in `src/ui/palette.css`
  with one variable per palette leaf; a test regenerates and asserts no
  literal color anywhere else in `src/ui` (translucency through
  `color-mix`). Confetti reads the palette too.
- Nine-slice frames for panel, card, plaque, bar and inset; buttons whose
  press compresses the bevel; the count on an ornate plaque with the staff
  icon; framed coins, level chip and boss bar with a gem; a gold-gradient
  wordmark with an ink stroke; Academy and rooms as parchment boards with
  framed cards and icon rows; the result with a notched ribbon and framed
  stats. Sheets split into tokens, styles, kit and result.
- Verified in a clean worktree because the shared tree carried the art
  track's in-flight gate work: typecheck, lint, 301 tests, smoke, hosted
  10.46 MB and artifact 13.80 MB, both offline at pixel ratio 3; portrait
  390 and 360 and landscape 568×320 on all five screens.

## 2026-09-13 — Phase C: road, gates, walls, arena, props (verified and committed)

- Assets (452 KB): five KayKit Dungeon Remastered pieces (column, half
  barrier, pillar, blue banner, lit torch) through the jsDelivr mirror; an
  ambientCG cobblestone albedo (color × ambient occlusion, 1024 px) and a
  grass albedo (512 px), both CC0 1.0, resized in Chromium because Node has
  no image decoder and no image dependency is allowed. `assets/` is 3.9 MB.
- Gates: two pillar legs, a seven-piece semicircular arch with a proud
  keystone and a parapet, baked into one mesh in one material (one draw
  call for every arch on screen); a dark rune plaque carries the atlas
  number with the label API unchanged; a kind-tinted shimmer drifts across
  each opening from a per-instance-tinted quad batch shared with the motes;
  vines, thorns, crown and crystals as one merged mesh per kind within 34
  m; a box arch stands in if a model fails.
- Road: a vertex-colored grid with lane wear and kerb-gutter shadow baked
  into vertex colors (free), the cobble albedo at a 2.2 m tile, chamfered
  kerb stones thin-instanced along both edges, a grass fringe with an
  opacity ramp, runs past the fog end with a filler strip. Arena markers
  are a pillar and banner; walls are a carved column-and-parapet piece with
  the rune cap and approach marker kept; props re-tinted from palette
  roles; the torch replaces the lantern from level 6.
- Draw peaks 40 / 40 / 41 / 42 (art budget 45); stress 34 calls; 36
  shader programs warmed, 0 compiles during play; 316 tests; hosted
  10.49 MB, artifact 13.84 MB.
- Tech lead frame review: the look is coherent now (cobble road with
  kerbs, arches with plaques, ornate plaque HUD, framed coins, gold
  wordmark, parchment board, line formation, long view with clouds). For
  Phase E: the cobble reads slightly olive; the crowd's rear rows run off
  the bottom of the frame at 100+ units; wire `road.load()` and
  `walls.load()` into the views' load so a slow load cannot miss the
  warm-up; label clearance should use the plaque height; unused theme
  constants; blob shadows for squad, streams and blocks.

## 2026-09-13 — Phase E: integration, hero shots, builds (verified and committed)

- Wiring: `SceneViews.load()` now awaits `road.load()` and `walls.load()`
  so a slow texture or model load can no longer miss the shader warm-up;
  blob shadows under the squad, the enemy streams and the blocks (one
  thin-instanced disc for all of them); label clearance measures against
  the plaque height instead of the old panel; the dead theme constants
  from Milestone 3 are gone; the prop cap is derived from the road length
  so a 440 m road stays dressed; `query.ts` describes the six rungs.
- Camera: a depth-driven pull-back (back 1.15 × crowd depth capped at 8.4 m,
  lift 0.38 × depth capped at 2.8 m) so the rear rows of a 500-unit crowd
  stay inside the frame instead of running off the bottom.
- Look: the cobble albedo was reading olive against the grass; it is cooled
  in the fetch step (saturation 0.72, hue −14°). Tone mapping moved from
  ACES to KHR PBR Neutral at exposure 1.185, the constant Phase A measured:
  palette fidelity rms 11 of 255 (was 17). The gate shimmer fades at the
  opening's edge instead of clipping. `scripts/swatch-check.mjs` keeps the
  fidelity measurement runnable.
- Hero set: `scripts/smoke-hero.mjs` runs last in the smoke and photographs
  title, mid-run, a gate row close-up, boss, result, academy and yard at
  pixel ratio 2 and 3 (14 frames in `artifacts/smoke/hero/`). The gate
  close-up needs the sim slowed as the row comes into reach, so the debug
  handle gained `setTurbo`.
- Verified: typecheck 0 errors, lint clean, 316 tests, smoke PASS in
  5 min 57 s (draw peaks 40 to 42, 0 shader compiles during play), hosted
  11.0 MB and artifact 14.5 MB both PASS.
- Tech lead frame review against the plan checklist: one palette (the
  cobble, grass, gold frames and arcane blues read as one family now);
  numbers readable on the plaques and blocks at both ratios; the road and
  the arch gates have craft; the crowd stands in lines and is fully framed
  at the boss; the long view shows the ridge and clouds; the HUD, Academy
  and result read as game UI. Left for review: the stress scene still uses
  the old camera rig, the widest crowd touches the frame edge at the
  bottom on 360-wide portrait, and the smoke sits close to its 7 min
  ceiling.

## 2026-09-13 — Phase F: independent review and fixes (verified and committed)

- Review of the whole milestone diff (113 files) by a fresh agent, then a
  bounded fix batch for the calls the tech lead made on its findings.
- Fixed by the reviewer: the formation cache was keyed by count and width
  only, so a `Run` on a modified balance was handed the shipped crowd for any
  count another caller had warmed (now a `WeakMap` per balance, test added);
  `gateStaffs` allocated a target object every frame a weapon gate was on
  screen (slots built once, rewritten in place); blob shadows sat 8 mm
  *under* the lane runes and were depth-cut into four stripes (now 0.026 m);
  the stress scene now poses the camera through the game's rig (500 units
  framed 1.6 m clear instead of six ranks off the bottom; draw calls and the
  12 ms tripwire unchanged); dead code (`retireLegacyDome`, `MotesView.
  recentre`) and two stale comments removed; `gates.ts` 465 → 371 lines with
  the slot pool in `gateSlots.ts` (165); `color-mix` tokens get an
  `@supports` fallback for iOS 15 to 16.1 (D41).
- Fixed by the fix batch: arch parapets shortened by half a leg each side so
  neighbouring gates leave 0.44 m of daylight instead of 12 cm (a row read as
  one lintel two rows out; box-arch stand-in matched); the label clearance
  band is 1.25 × the plaque height so a stream count no longer rests on a
  plaque's top rail; bots and `wallLimits`/`wallAhead` read the run's balance
  instead of the shipped one (two tests); `lateralFollow` 0.35 → 0.45,
  measured headless at 500 units pinned to a side: the outer column's centre
  went from 1 px to 8 px inside the edge at 390×844 and 33 px to 38 px at
  360×640.
- Open item 5c (smoke time): phase breakdown printed at the end of every run
  (runs 184 s, stress 40 s, hero 120 s); two scripted runs at a time drops the
  run phase to about 105 s but two attempts failed at page boot under
  SwiftShader load, so the default stays serial with `SMOKE_RUN_CONCURRENCY`
  and `SMOKE_HERO_SCALES` as documented levers; the ready timeout is 90 s.
- Correction to the Phase B entry: the balance diff also carried
  `gen.hpPerEnemy.min` 1 → 0.2 (stream bodies may carry fractional HP so the
  pressure budget divides evenly at small counts).
- Not fixed, noted: `botScore.ts` and `generateWalls` still read the shipped
  balance (valuation and level generation, not the clamp); `SHADOW.y` is
  still under the arena band at 0.04; at the widest crowd pinned to one side
  the outermost column still touches the edge on tall phones (the remaining
  levers are `road.clampMin`, `formation.inset` or the field of view, all
  whole-game framing calls); files still over ~400 lines all predate the
  milestone (App 461, effects 449, Renderer 442, squad 439, debug 423,
  spritePainters 418, stress 414, Run 412, labels 403, theme 400).
- Verified: typecheck 0 errors, lint clean, 319 tests, smoke PASS in
  5 min 45 s (draw peaks 40 / 40 / 41 / 42, 0 shader compiles during play,
  stress 34 calls), UI clean at 360×640, 390×844 and 568×320 across six
  screens. Tech lead frame review of the refreshed hero set: three separate
  arches, readable plaques and stream counts, crowd framed at the boss.

## Milestone 5 status

| Definition of done | Status |
|---|---|
| 1. All checks; smoke with the hero set at pixel ratio 2 and 3 | Done: 319 tests, smoke PASS 5:45, 14 hero frames |
| 2. Tech lead frame review: one palette, readable numbers, crafted road and gates, crowd in lines, long view, game UI | Done, Phases E and F |
| 3. Product owner reads it as studio-designed; phone holds rung 0 at native with render median under 8 ms | Awaiting the product owner's read and a phone capture |
| 4. Bands and golden tests pass with the new formation and spring | Done, Phase B |
| 5. Docs, ASSETS.md rows, ledger entries | Done: D36 to D41, ASSETS.md rows for Dungeon pieces, textures and the UI kit |

## 2026-09-13 — Product owner read: the formation was misread

- The owner's Milestone 4 note "linear line-filling rather than circular"
  meant a vertical column one lane wide, not a horizontal line across the
  road; it is the shape that makes sense once walls separate the lanes.
  Testing waits on the fix. Plan in `docs/16-lane-column-formation.md`,
  ledger D42 supersedes the formation half of D37. Two tracks launched in
  parallel: sim (lane band, clamp, keep-off, spacing floor, balance
  re-measure) and render (camera framing of the column's front, flock lag
  down the column, stress scene).

## 2026-09-13 — Lane-column formation (verified and committed)

- Sim: the crowd's band is a constant one lane less `formation.laneInset`
  0.2 m each side, 1.6 m, on the open road and inside a fence alike
  (`openRoadWidth` returns it; `availableWidth` can only narrow below it);
  `spacing.min` 0.28 → 0.25 and `rowDepth` 0.8 → 0.7 put 500 units at
  13.3 m deep in 77 rows of up to 7 (10 units 0.56 m, 100 units 5.4 m, 200
  units 8.0 m); half width saturates at 0.8 m from four units. The centre
  reaches ±2.2 at every count, so both side-lane centres are reachable with
  no overhang (`road.clampMin` 1.2 → 2 as the assertion that the crowd is
  one lane wide); under a fence the centre range in the walled lane is
  1.85 to 2.2 m, and no unit crosses a line at any count.
- Balance re-measured with the bots: fire concentrates in one lane, so
  `dpsTrim` returns to 0.38 and `enrageAt` to 0.3; `weaponWorth` stays 0.5
  (0.8 costs a clear on level 10); `stompShare` 0.06 → 0.07 because a
  dodgeable column clears its river and the survivor share is settled at the
  arena (late levels lost 141 to 171 of a 470 peak to stomps and single
  digits to everything else). Greedy 100 of 100; survivors 0.72 to 0.76 on
  levels 1 to 3, 0.60 and 0.62 on 4 to 5, 0.47 to 0.60 on 6 to 10, 0.56 to
  0.61 on 11 to 20; boss 18.1 to 22.2 s, mean 20.1. Goldens re-captured for
  levels 1 to 3.
- Bot fixes forced by the column: stream coverage counted lane centres
  against a reach that spanned every lane, so greedy never moved to a
  river (now counts the bodies each stand reaches); greedy held its ground
  through a block because the old crowd could not dodge (now takes the
  cheapest reachable stand). `bots.ts` 426 → 321 with `botStand.ts` (165).
  A new end-to-end test pins a consequence of concentrated fire: a column
  standing on a curse counts it to zero and flips it (D19).
- Render: the pull-back saturates at 3 m of depth (`backMax` 8.4 → 3.4,
  `liftMax` 2.8 → 0.62, `liftPerDepth` 0.38 → 0.21) so the frame's bottom
  edge sits 6 m behind the anchor and the tail runs off it; the front rank
  at 500 is 74% of its size at 50 (was 48%), with `CROWD_SCALE_MIN` 0.6 →
  0.7. `lateralFollow` 0.45 → 0.55 for the wider clamp: the outer column is
  18 px inside the edge when pinned at 390×844. The follow lag is by metres
  of depth (`UNIT_FOLLOW_DEPTH` 1.6) on a curve that keeps falling to the
  tail, so a turn ripples down all 77 rows instead of the front ten; the
  gate hop is a wave down the column; the yaw, clip offset and caster picks
  are scrambled rather than `index % k`, which drew diagonals on a
  seven-wide column. `squad.ts` 439 → 396 with `squadCorpses.ts` (102).
- Stress: the scene became a column on its own and poses through the rig;
  draws 33 to 34, first-window medians 4.1 to 5.1 ms, unchanged in kind.
- Verified: typecheck 0 errors, lint clean, 325 tests, smoke PASS in
  6 min 25 s (runs 210 s, stress 40 s, hero 133 s; draw peaks 40 / 41 / 41 /
  42, 0 shader compiles during play). Hero frames: a compact column at 26
  units, the lane filled and the tail off the bottom at 129, one arch
  entered at a time.
- Open: the smoke is 35 s from its 7 min ceiling (the column runs are
  slower to clear); a large `mul` gate re-spaces the column so ranks deeper
  than about 2.5 m snap rather than slide; blob shadows merge into a ribbon
  under a packed column (`SHADOW.mage` was sized for 0.28 m spacing); the
  stress scene slows within a page session from 0.7 to 1.9 s a frame in
  both builds, which starves its later windows.

## 2026-09-13 — Product owner read of Version 14; Milestone 6 draft

- "Looks a bit better." Movement still not smooth or responsive, wizards do
  not move as individuals or interact with each other or the walls; levels
  too easy and money too easy; Capacitor and device testing held until
  closer to final. Milestone 5's definition-of-done item 3 (the phone
  capture) is therefore parked. Milestone 6 draft written as
  `docs/17-milestone-6-plan-draft.md` with the diagnosis and six questions.
