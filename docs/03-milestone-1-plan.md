# Milestone 1 plan: greybox playable

Author: tech lead. Status: approved by product owner on 2026-09-08. Immutable.

## Goal

The core loop is fun with boxes before any real art. A browser build, playable
on a phone from a link, with ten generated levels, gate rows whose numbers you
can shoot, enemy blocks that eat units, and a boss per level.

Out of scope for M1: real character models, physics and ragdolls, sound,
meta progression beyond "which level is unlocked", Capacitor.

## Definition of done

1. `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`,
   `npm run smoke` all pass in this environment.
2. Balance tests pass: a greedy bot clears all ten levels, a random bot loses at
   least three of ten, a worst-gate bot loses at least seven of ten.
3. Smoke screenshots show: a title screen, a mid-run frame with squad, gates
   with numbers, enemies with numbers, and a result screen.
4. The single-file artifact build loads and runs with no console errors.
5. The tech lead has played the artifact build via the scripted bot and
   reviewed frames at several timestamps.
6. `docs/04-milestone-1-log.md` records each phase and its verification.

## World model (shared by every module)

- Units are meters. `+z` is forward (away from the camera), `+x` is right,
  `+y` is up.
- The road has three lanes. `laneWidth = 2`, so lane centers are at
  `x = -2, 0, +2` and the road spans `x in [-3, 3]`. The squad center is
  clamped to `[-2.6, 2.6]`.
- The squad advances along `+z` at `runSpeed` (data). Gates and enemies have
  fixed spawn positions along `z`; enemies walk toward `-z` once activated.
- The squad is a point `(x, z)` plus a `count`. The visual formation is derived
  from `count` by `formationOffsets(count)` (phyllotaxis spiral, spacing 0.35 m).
  The squad's half-width `halfWidth(count)` is derived from the same function
  and is used by the sim for gate and enemy overlap.
- Time: the sim runs a fixed timestep of 1/60 s inside `tick(dt)` with an
  accumulator. All randomness comes from a seeded mulberry32 RNG.

## Module contracts

### `src/sim` (owner: sim agent) — pure TypeScript, no Babylon

```ts
// types.ts
export type GateKind = "mul" | "add" | "sub" | "fireRate";
export interface GateDef { kind: GateKind; value: number }         // sub: value is the penalty (positive number)
export interface GateState {
  id: number; rowIndex: number; lane: -1 | 0 | 1; z: number;
  kind: GateKind; value: number; hits: number; passed: boolean;
}
export type EnemyKind = "grunt" | "brute" | "boss";
export interface EnemyState {
  id: number; kind: EnemyKind; x: number; z: number;
  hp: number; maxHp: number; units: number;                        // units = ceil(hp / hpPerUnit), visual count
  speed: number; active: boolean; alive: boolean;
}
export interface ProjectileState { id: number; x: number; z: number; alive: boolean }
export interface SquadState {
  count: number; x: number; targetX: number; z: number;
  fireRate: number; damage: number; fireRateBonus: number;         // fireRateBonus from gates, multiplier added to 1
}
export type RunStatus = "running" | "won" | "lost";
export interface RunState {
  levelIndex: number; seed: number; time: number; status: RunStatus;
  squad: SquadState; gates: GateState[]; enemies: EnemyState[];
  projectiles: ProjectileState[]; boss: EnemyState | null;
  peakCount: number; survivors: number; arenaZ: number;            // arenaZ: where the squad stops for the boss
}
```

Events (returned by `tick`, consumed by render and UI, then discarded):

```ts
export type SimEvent =
  | { type: "projectileFired"; x: number; z: number }
  | { type: "gateHit"; gateId: number; kind: GateKind; value: number }
  | { type: "gatePassed"; gateId: number; kind: GateKind; value: number; countBefore: number; countAfter: number }
  | { type: "enemyActivated"; enemyId: number }
  | { type: "enemyHit"; enemyId: number; damage: number; hp: number; x: number; z: number }
  | { type: "enemyKilled"; enemyId: number; kind: EnemyKind; x: number; z: number }
  | { type: "unitsGained"; amount: number; reason: "gate" }
  | { type: "unitsLost"; amount: number; reason: "contact" | "gate" | "stomp" }
  | { type: "bossActivated"; enemyId: number }
  | { type: "bossStomp"; x: number; z: number }
  | { type: "bossKilled" }
  | { type: "runEnded"; status: RunStatus; survivors: number; peakCount: number };
```

API:

```ts
export class Run {
  constructor(level: LevelDef, balance: Balance);
  readonly state: Readonly<RunState>;
  setTargetX(x: number): void;          // clamped to road; squad moves toward it at balance.squad.lateralSpeed
  tick(dt: number): SimEvent[];         // fixed-step accumulator inside; returns events since last call
}
export function generateLevel(index: number, config: LevelGenConfig, seed?: number): LevelDef;
export function formationOffsets(count: number): ReadonlyArray<{ x: number; z: number }>;   // cached per count
export function halfWidth(count: number): number;
export function createBot(kind: "greedy" | "random" | "worst", seed: number): (state: RunState) => number; // returns targetX
```

Rules:

- **Firing.** Each unit fires `fireRate * (1 + fireRateBonus)` shots per second
  along `+z` from its formation position. Projectiles travel at
  `projectileSpeed` and die after `projectileRange`. A projectile hits the first
  live gate or enemy whose lane or footprint contains its `x` and whose `z` it
  has reached. Cap live projectiles at `balance.projectiles.max`; when the cap
  is reached, batch remaining shots into hitscan damage applied to the nearest
  target in the unit's lane, still emitting one `projectileFired` per batch so
  the render can show something.
- **Gates.** A row places up to three gates, one per lane. A projectile hitting
  a gate increments `hits` and changes `value`: `add` +1 per hit up to
  `cap`; `sub` decreases the penalty by 1 per hit, and at 0 the gate becomes
  `add` with value 0 and keeps growing; `fireRate` +0.02 per hit up to `cap`;
  `mul` is not shootable (projectiles pass through it). When the squad's `z`
  reaches a row's `z`, the gate whose lane contains `squad.x` applies:
  `mul` sets `count = floor(count * value)`, `add` adds, `sub` subtracts,
  `fireRate` adds `value` to `fireRateBonus`. Exactly one gate per row applies.
  `count` is clamped to `[0, balance.squad.maxCount]`.
- **Enemies.** Blocks spawn with `hp = units * hpPerUnit` for their kind and
  stand idle until the squad is within `activationDistance`, then walk toward
  `-z` at `speed`. When a block's `z` is within `contactDistance` of the squad
  and its `x` footprint (`halfWidth = footprint[kind]`) overlaps the squad's
  half-width, it removes `units` (its remaining visual units) from `count` and
  dies. Blocks that pass the squad without overlap keep walking and are
  removed off-screen.
- **Boss.** One per level at `arenaZ + bossOffset`. When the squad reaches
  `arenaZ` it stops advancing (`runSpeed` becomes 0). The boss activates, walks
  toward the squad at `speed`, and every `stompInterval` seconds while within
  `stompRange` emits `bossStomp` and removes `stompKills` units. If the boss
  reaches `contactDistance` it removes `contactKillsPerSecond * dt` units
  continuously. Boss hp 0 → `bossKilled`, `status = "won"`, `survivors = count`.
- **Losing.** `count <= 0` → `status = "lost"`. `tick` on a finished run
  returns no events and changes nothing.
- **Bots.** Greedy: on the next unpassed row, pick the gate with the best
  expected count after applying it (using the current count), move to its lane
  center; between rows, center on the nearest active enemy block if it will
  overlap. Random: pick a random lane per row. Worst: pick the worst gate.
  Bots are used by tests and by `?bot=` in the app.

Data (`src/data`, owner: sim agent):

- `balance.json`: every constant named above with these starting values:
  `runSpeed 5`, `lateralSpeed 8`, `startCount` per level from the level
  config, `fireRate 2`, `damage 1`, `projectileSpeed 24`, `projectileRange 34`,
  `projectiles.max 400`, `maxCount 500`, `activationDistance 26`,
  `contactDistance 1.2`, grunt `hpPerUnit 3, speed 3, footprint 0.9`, brute
  `hpPerUnit 30, speed 2, footprint 1.1`, boss `speed 1.6, footprint 2.2,
  stompInterval 2.5, stompRange 7, stompKills 3, contactKillsPerSecond 6`,
  `rowSpacing 18`, `bossOffset 22`, gate caps `add 250, fireRate 1.0`.
- `levels.json`: `LevelGenConfig` for ten levels: `rows` (8 at level 1 to 14
  at level 10), `startCount` (5 to 12), enemy `hpScale` (1.0 to 4.5), boss
  `hp` (120 to 1500), gate value ranges per kind, row-type weights
  (gate row, enemy row, mixed row), and `seed`. The sim agent tunes these until
  the balance tests pass and records the final curve in the milestone log.
- `LevelDef` (output of the generator, also JSON-serializable):
  `{ index, seed, runSpeed, startCount, rows: RowDef[], arenaZ, boss: { hp, units } }`
  with `RowDef = { z, gates: (GateDef | null)[3], enemies: { kind, lane, units }[] }`.

Tests (`src/sim/__tests__`, Vitest): gate arithmetic, shoot-to-grow rules
including the sub-to-add flip, contact kills, boss stomp, win and loss, level
generator determinism (same seed → same level), and the balance test that runs
the three bots over all ten levels with a fixed set of seeds.

### `src/render` (owner: render agent) — Babylon.js only here

```ts
export class Renderer {
  constructor(canvas: HTMLCanvasElement);
  init(): Promise<void>;                      // engine, scene, camera, lights, fog, materials
  loadLevel(level: LevelDef): void;           // builds road, gate meshes, enemy meshes, boss, labels; resets pools
  update(state: RunState, events: SimEvent[], dt: number): void;   // called every frame after sim.tick
  resize(): void;
  dispose(): void;
}
```

- Camera: perspective, vertical FOV ~1.0 rad, positioned behind and above the
  squad at roughly `(squad.x * 0.35, 9, squad.z - 9)`, looking at
  `(squad.x * 0.35, 0.5, squad.z + 9)`, with smoothing. Pulls back slightly as
  `count` grows (`+0.01 m per unit`, capped).
- Road: one long box or plane per level from `z = -10` to `arenaZ + 40`, lane
  lines as thin emissive strips, fog fading to the sky color at ~70 m.
- Squad: capsules via thin instances of one mesh, positions from
  `formationOffsets(count)`, blue with a lighter cap. Count changes animate
  in: new units pop with a scale bounce, lost units flash red and shrink.
- Projectiles: thin instances of a small glowing sphere or elongated capsule.
- Gates: a translucent vertical panel per gate spanning the lane, tinted by
  kind (`add` green, `sub` red, `mul` blue, `fireRate` gold), with a large
  number label (Babylon GUI `TextBlock` linked to the mesh, outline for
  readability). `mul` shows `x2`, `add` `+5`, `sub` `-3`, `fireRate` `+10%`.
  Hits pulse the panel; passing shatters it (scale out and fade; no physics).
- Enemies: a red box per block, size proportional to `units` (a wider slab for
  bigger blocks), with an HP label above. Hits flash white for one frame.
  Death: scale to zero with a quick spin. Boss: a big purple box with a
  face-sized label and a stomp ring that expands on `bossStomp`.
- Everything pooled and re-used across levels. No mesh creation during a run.
- Provide `src/render/dev-scene.ts` used only by a `?scene=render-test` mode
  that drives the renderer with a fake `RunState` so the render agent can test
  without the sim being finished.

### `src/core` + `src/ui` + `src/main.ts` + `scripts` (owner: app agent)

- `App` state machine: `title → playing → result`. `playing` owns one `Run`,
  the `Renderer`, and the loop (`requestAnimationFrame`, `dt` clamped to
  50 ms). Result screen shows level, survivors, peak count, and buttons
  `Retry` and `Next` (Next only on a win). Next unlocks the following level in
  `localStorage` under `arcane-rush.save.v1`.
- Input: pointer drag on the canvas. Horizontal pointer delta in CSS pixels ×
  `balance.input.sensitivity` (road meters per screen width) becomes a delta
  on `targetX`. Arrow keys and `A`/`D` work on desktop. No tap-to-move.
- HUD: squad count (big, top center, bumps on change), level label, boss HP
  bar when the boss is active, gate legend on level 1 only.
- Query parameters: `?level=N` starts at level N; `?bot=greedy|random|worst`
  auto-plays; `?seed=N` overrides the seed; `?debug` shows FPS, sim counts,
  and event log; `?scene=render-test` runs the render dev scene.
- Debug handle: `window.__arcane = { ready: boolean, app, run(), state() }`
  used by the smoke test.
- Title screen: name, "Drag to move, your squad fires by itself", a Play
  button, and a level picker for unlocked levels.
- Styling: HTML/CSS overlay, portrait-first, safe-area aware, chunky rounded
  type using a system font stack (no web fonts in M1), all buttons in the
  bottom third.
- `scripts/smoke.mjs`: builds, serves `dist/` on a local port, launches
  Chromium from `/opt/pw-browsers` with Playwright 1.56.1 at 390×844 with
  `deviceScaleFactor 2`, loads `?bot=greedy&level=1&seed=1`, waits for
  `__arcane.ready`, clicks Play, screenshots at 1 s, 6 s, 12 s, and at run end
  into `artifacts/smoke/`, fails on any console error or uncaught exception,
  and asserts that the mid-run frames are not blank (pixel variance check).
  Use `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`.
- `scripts/build-artifact.mjs`: Vite build with `vite-plugin-singlefile`
  (compatible with Vite 8), then rewrites the output into
  `dist-artifact/arcane-rush.html` containing only `<title>`, `<style>`, body
  markup, and inline `<script>` blocks (no doctype, html, head, or body tags),
  because the hosting wrapper supplies those. Must stay under 16 MB.

## Team plan

| Phase | Agent | Scope | Depends on |
|---|---|---|---|
| A | scaffold | Repo skeleton, deps, configs, stubs for every contract above, passing empty tests, smoke pipeline proving a Babylon frame renders headless | none |
| B1 | sim | `src/sim`, `src/data`, tests, balance tuning | A |
| B2 | render | `src/render`, dev scene | A |
| B3 | app | `src/core`, `src/ui`, `src/main.ts`, `index.html`, `scripts` | A |
| C | integration | Wire everything, fix cross-module issues, tune, produce artifact build | B1, B2, B3 |
| D | review | Independent code review for bugs and simplification, fixes applied | C |

B1, B2, B3 run in parallel in the same working tree with strict path
ownership. Agents run only the checks that touch their own paths while others
are in flight; the tech lead runs the full suite at phase boundaries. Subagents
never commit; the tech lead commits at the end of each phase.

## Verification the tech lead performs

- After A: full suite passes, smoke screenshot shows a rendered frame.
- After B: sim tests and balance tests pass; render dev scene screenshot
  reviewed; app screens reviewed via smoke.
- After C: all of the definition of done; artifact published; frames reviewed
  at 1 s, 6 s, 12 s, end; log updated.
- After D: review findings and fixes recorded; final commit.
