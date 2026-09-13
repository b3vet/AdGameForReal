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
