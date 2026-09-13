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
