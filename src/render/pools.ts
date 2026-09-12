/**
 * Pool sizes: how many of each thing the renderer allocates once, at boot.
 *
 * Split out of `./theme.ts` in Milestone 3 Phase D; `theme.ts` re-exports
 * `POOL`, so every view still reads it from there. Derived from `levels.json`
 * and `balance.json` wherever the data says what the ceiling is, so a level
 * that gains rows or a horde cannot silently starve a pool and drop gates,
 * blocks or stream counts on the floor.
 */

import { balance, levels } from '@/data';

/** The longest level in `levels.json`; every per-row pool is sized off it. */
const MAX_ROWS = levels.reduce((most, level) => Math.max(most, Math.ceil(level.rows)), 1);

/** Three lanes per row, plus slack for the ones still playing their exit. */
const PER_ROW_POOL = MAX_ROWS * 3 + 6;

/**
 * Streams a level can register: one per mixed row and two per horde row (D29),
 * plus slack. They are all registered at level load, so this is the number of
 * `StreamState`s `RunState.streams` can hold, not the number live at once.
 */
const MAX_STREAMS =
  levels.reduce(
    (most, level) => Math.max(most, Math.ceil(level.mixedRows) + Math.ceil(level.hordeRows) * 2),
    1,
  ) + 4;

/**
 * Every pool is allocated once in `Renderer.init` and handed out by
 * `loadLevel`, so no mesh, material or label is ever created during a run.
 */
export const POOL = {
  gates: PER_ROW_POOL,
  enemies: PER_ROW_POOL,
  /**
   * Live stomp shockwaves. Three, not eight: a ring lives half a second of
   * *frame* time while the sim can throw one every 1.2 s of *sim* time, so a
   * fast-forwarded run (or a phone at ten frames a second) stacks them into a
   * bright portal around the boss instead of one wave leaving it.
   */
  stompRings: 3,
  /** Concurrent shrinking corpses; a big `sub` gate can kill dozens at once. */
  dyingUnits: 96,
  squad: balance.squad.maxCount,
  projectiles: balance.projectiles.max,
  /**
   * Minion instances: every live stream body on the road plus the skeletons of
   * the grunt blocks in draw range. `enemies.maxLive` is the sim's own ceiling
   * on bodies (300), and at 18 m rows about four block rows are inside
   * `ENEMY_DRAW_RANGE` at `ENEMY_MAX_INSTANCES` each. One draw call covers all
   * of them, so the only cost of the headroom is the instance buffer.
   */
  grunts: balance.enemies.maxLive + 4 * 18,
  brutes: 120,
  /** Frost rings under slowed blocks. */
  slowRings: 16,
  /**
   * Floating stream counts. `levels.json` says how many streams a level can
   * carry — one per mixed row, two per horde row — so this cannot silently run
   * short when a level gains a horde.
   */
  streams: MAX_STREAMS,
  /**
   * Simultaneous impact bursts, per the plan's cap. `EffectsView` keeps one
   * ring of twice this, because muzzle flashes and the puff a leaked body
   * leaves are the same kind of thing and share it — Milestone 2 gave impacts
   * and flashes a pool of 24 each, which is the same total.
   */
  impacts: 24,
  splashes: 12,
  chains: 12,
  /**
   * Billboarded spell quads live at once: every projectile plus its two tail
   * quads, the sparkles they shed, and the impacts and muzzle flashes — all one
   * mesh and one draw call (`./sprites.ts`).
   */
  sprites: 1024,
  /** Sparkles in the air behind the volley. */
  sparkles: 192,
} as const;
