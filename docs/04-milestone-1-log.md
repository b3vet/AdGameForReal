# Milestone 1 log (append-only)

## 2026-09-08 — Kickoff

- Product owner approved Milestone 1 and set the process: the tech lead
  session orchestrates, general-purpose Opus subagents implement, the tech
  lead verifies and commits. Product owner has a Mac for later device builds;
  browser testing comes first. Working title stays Arcane Rush.
- Product owner asked that every decision and the process itself be recorded
  in the repo docs as immutable memory. `docs/README.md` sets the rules,
  `docs/DECISIONS.md` is the ledger, this file is the M1 process log.
- Tech lead wrote `03-milestone-1-plan.md` with the world model, module
  contracts, data schema, team plan, and definition of done.
- Environment facts checked: Node 22, Playwright 1.56.1 with Chromium 1194
  preinstalled, npm and GitHub reachable, Babylon 9.25 is the latest on npm,
  `vite-plugin-singlefile` 2.3.3 supports Vite 8.

## 2026-09-08 — Phase A: scaffold (verified and committed)

- Scaffold agent delivered the skeleton. Tech lead re-ran all six commands
  in the session environment: typecheck, lint, 18 unit tests, build, smoke,
  artifact build all pass. Smoke frame `t6.png` inspected: a lit orange box on
  a grey road under a blue sky, rendered headless through SwiftShader WebGL2.
- Deviations accepted: TypeScript 5.9 instead of 7 (typescript-eslint peer
  range), ESLint 10 flat config with `@eslint/js` and `globals`, `lint` runs
  with `--max-warnings 0`, a dependency-free PNG decoder in `scripts/png.mjs`
  for the smoke blank-frame check.
- Facts for later phases: the debug handle is
  `window.__arcane = { ready, app, run(), state() }` and `ready` flips after
  `renderer.init()` while still on the title screen; smoke clicks
  `#play-button`; the sim lint guard rejects any `@babylonjs` import in
  `src/sim`; Babylon runs at device pixel ratio 1 by default; the single-file
  artifact is 1.4 MB.
- Next: B1 (sim), B2 (render), B3 (app) launched in parallel with strict path
  ownership.

## 2026-09-08 — Phase B: sim, render, app (verified and committed)

Three agents worked in parallel in one working tree with strict path
ownership. No conflicts. Tech lead re-ran lint, typecheck, 71 tests and the
build after each report, reviewed screenshots, and committed each owner's
paths separately (commits f2d607d sim, c9027c5 app, this one render).

### B1 sim
- Choices: shots accumulate per tick and are assigned round-robin to
  formation slots; projectiles sweep from previous to next z against a sorted
  target list (no tunneling); above the 400-projectile cap the remainder is
  batched per lane into hitscan. Enemy footprint widens with `sqrt(units)`.
  Boss activates when the squad reaches `arenaZ`.
- Deviations accepted: `add` gate cap 250 → 30 (gates get about 2.4 hits per
  unit per row, so 250 saturated every level by row 4); the running
  squad-size estimate was replaced with a closed-form `squadCurve`; enemy
  `hpScale` runs 0.45 → 1.5 and boss hp 1800 → 12800 instead of the plan's
  guesses. Bug found: boss contact never applied because of a floating
  point equality; fixed with an epsilon.
- Balance: greedy clears all ten levels on all five seeds; random loses 4.4
  of 10; worst loses all. Full curve table is in the B1 report, summarized:
  rows 8 → 14, start 5 → 12, boss hp 1800 → 12800, level length 34 s → 70 s.
- Tech lead concern for Phase C: every level saturates near the 500 cap,
  including level 1 (5 → 430 in 34 s). Peaks must scale with level.

### B2 render
- Pools at init: 48 gates, 64 enemy boxes, 1 boss, 8 stomp rings, 192
  corpses, squad and projectile thin-instance buffers at max size. Slots bind
  by id and release after exit animations. One fullscreen GUI texture with
  pre-created labels drawn on the panel or box face (floating labels
  collided). Pixel ratio capped at 2.
- Deviation accepted: road extends to `arenaZ + 70` so it ends inside the fog.
- Babylon trap recorded: `mesh.clone()` shares geometry, and thin-instance
  buffers live on the geometry, so a cloned thin-instance mesh steals the
  original's matrices. Build meshes independently.
- Open: above ~75 units the phyllotaxis formation spills off the 6 m road.

### B3 app
- Title with level picker (save in localStorage), HUD with count bump, boss
  bar, level-1 legend, result screen, pointer and keyboard input, bots built
  once per run, query parameters, debug panel, `app.startLevel(n)` and
  `app.status()` on the debug handle.
- Open: a full greedy level-1 run takes ~205 s of wall clock under
  SwiftShader (about 6 fps at 430 units), so strict smoke needs a faster
  path; debug panel overlaps the boss bar; no route back to the title from
  the result screen; three UI constants live in code instead of balance.json.

## 2026-09-08 — Phase C: integration and tuning (verified and committed)

Tech lead re-ran typecheck, lint, 77 tests, build, the three-run smoke
(1 m 44 s wall clock) and the artifact build, and reviewed all eight frames.

- **Turbo mode** `?turbo=N` (1 to 20) advances the sim N× real time in ≤ 50 ms
  ticks; the renderer absorbs intermediate ticks' events. Smoke now runs
  greedy level 1, random level 3 (a loss), and greedy level 10 at turbo 8,
  strict by default.
- **Per-level growth targets** (`peakTarget` in levels.json: 60 → 480) replace
  the flat "0.9 × maxCount" curve. The add-gate cap is now derived per level
  from the curve's own per-row growth (`GateDef.cap`). Mul chance 0.7 → 0.18,
  mul capped at ×4, enemy-row unit budget split across lanes, and at most two
  gateless rows in a row (`gen.maxEnemyRun`), after a trace showed four
  consecutive enemy rows wiping the greedy bot at levels 7 to 10. Greedy
  average peaks: 76, 89, 111, 163, 230, 223, 272, 377, 399, 401. Boss fights
  last 9 to 11 s for a greedy squad on every level. Greedy 50/50 wins, random
  loses 7.2 of 10, worst 10 of 10.
- **Formation** is now an ellipse stretched along z with spacing that shrinks
  with count: `halfWidth(500) = 2.32 m`; capsules scale 1.0 → 0.75 with count.
- **Label collisions**: mixed-row blocks sit 6 m short of their gate row,
  enemy rows keep 4 m from gate rows, and an enemy label hides while an
  unpassed gate is within 3 m ahead of it.
- **App**: `ui` block in balance.json (resultDelay, keySpeed, legendSeconds),
  Levels button on the result screen with a verified clean title → play
  reset, debug panel bottom-left with sim and render ms, `dev/` typechecked.
- **Allocation audit** on the render steady-state path: closures and
  temporaries removed; label text and font size only set on change (Babylon's
  fontSize setter stringifies, so assigning a number every frame re-dirtied
  every label each frame).
- **Artifact**: the single-file build makes no network request beyond the
  document itself; the `fetch`/`XMLHttpRequest` references in the bundle are
  dead Babylon and Vite loader code.
- Remaining, for Phase D or later: at 500 units the crowd overhangs the road
  edge when hugging the clamp; level 10 seed 1 saturates the cap (drop its
  peakTarget to ~450); the debug panel crosses the level-1 legend; identical
  gate values side by side in one row are a non-choice; three labels in one
  far row touch each other.
