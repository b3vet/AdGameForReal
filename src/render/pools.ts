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
import { progression } from '@/sim';

import { ENEMY_DRAW_RANGE, LABEL_BEHIND } from './rangeLook';

/**
 * The most beats any scripted level is written in (document 31, 3.8). A
 * scripted level's rows, rivers, chargers and fences all come out of its
 * script rather than out of the per-kind counts a dealt level carries, so the
 * pools below take the larger of the two answers: the dealt counts as they
 * stand, and what a script of this many beats can hold at the most.
 */
const MAX_SCRIPT_BEATS = levels.reduce(
  (most, level) => Math.max(most, level.script?.length ?? 0),
  0,
);
/** Rows one beat is (3.3): two, and three for the Phase 2 gauntlet. */
const BEAT_ROWS_MAX = 3;
/** Chargers one beat can stand: one a lane (the charger fork). */
const BEAT_CHARGERS_MAX = 3;
/** Fence stretches one beat can stand: both boundaries (the gauntlet). */
const BEAT_FENCES_MAX = 2;

/** The longest level in `levels.json`; every per-row pool is sized off it. */
const MAX_ROWS = Math.max(
  levels.reduce((most, level) => Math.max(most, Math.ceil(level.rows ?? 0)), 1),
  MAX_SCRIPT_BEATS * BEAT_ROWS_MAX,
);

/** Three lanes per row, plus slack for the ones still playing their exit. */
const PER_ROW_POOL = MAX_ROWS * 3 + 6;

/**
 * Charger rows the longest level can carry (D49). Optional on a level recipe —
 * biome 1 has none — so an absent count is zero.
 */
const MAX_CHARGER_ROWS = levels.reduce(
  (most, level) => Math.max(most, Math.ceil(level.chargerRows ?? 0)),
  0,
);
/** Chargers a level can stand, dealt or scripted. */
const MAX_CHARGERS = Math.max(
  MAX_CHARGER_ROWS * Math.ceil(balance.gen.chargerLanes.max),
  MAX_SCRIPT_BEATS * BEAT_CHARGERS_MAX,
);
/**
 * Skeletons drawn for one block, however many units it is worth.
 *
 * Here rather than in `./theme.ts` with the rest of the look, because the
 * minion pool below is derived from it and `theme.ts` imports *this* file; it
 * is re-exported from `theme.ts`, so the views still read one module.
 */
export const ENEMY_MAX_INSTANCES = 18;

/**
 * Rows of blocks the enemy view can have in its draw range at once: the range
 * ahead plus the stretch behind the squad a body is still drawn over, at the
 * sim's row spacing.
 */
const BLOCK_ROWS_IN_RANGE = Math.ceil(
  (ENEMY_DRAW_RANGE + LABEL_BEHIND * 2) / balance.level.rowSpacing,
);

/**
 * Metres between one fence post and the next (D32).
 *
 * Here rather than in `./theme.ts` with the rest of the look, because the wall
 * pool below is derived from it and `theme.ts` imports *this* file; it is
 * re-exported from `theme.ts` so the views still read one module.
 */
export const WALL_POST_SPACING = 2;

/**
 * Fence pieces a level can need, and the posts in them.
 *
 * `wallRows` is how many stretches the generator may place, and from
 * `walls.bothFromLevel` a stretch over a horde is mirrored onto the other
 * boundary — so the ceiling is twice the declared count. Each stretch is at
 * most `walls.length.max` long and carries a post every `WALL_POST_SPACING`
 * metres plus the one that closes it.
 */
const MAX_WALLS =
  Math.max(
    levels.reduce((most, level) => Math.max(most, Math.ceil(level.wallRows ?? 0)), 0) * 2,
    MAX_SCRIPT_BEATS * BEAT_FENCES_MAX,
  ) + 2;
const POSTS_PER_WALL = Math.ceil(balance.walls.length.max / WALL_POST_SPACING) + 1;

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
   * on bodies (300), and at 18 m rows `BLOCK_ROWS_IN_RANGE` block rows (five,
   * since the range reached 74 m) are inside `ENEMY_DRAW_RANGE` at
   * `ENEMY_MAX_INSTANCES` each. One draw call covers all of them, so the only
   * cost of the headroom is the instance buffer.
   */
  grunts: balance.enemies.maxLive + BLOCK_ROWS_IN_RANGE * ENEMY_MAX_INSTANCES,
  /**
   * Warrior instances, *per variant*: the plain brute and the shielded one are
   * two meshes out of one parse and one baked texture (D49, `loadCrowds`), and
   * each carries an instance buffer of this size. A level deals at most one
   * shield row, so the second buffer is mostly headroom — 120 matrices is 7 KB,
   * and the alternative is a second capacity nobody would keep in step.
   */
  brutes: 120,
  /**
   * Chargers alive at once (D49): every row the longest level deals, each of
   * them up to `gen.chargerLanes.max` bodies — or every beat of the longest
   * script a charger fork — plus the ones still playing a death. One instance
   * each — a charger is a runner, not a block.
   */
  chargers: MAX_CHARGERS + 4,
  /** Frost rings under slowed blocks. */
  slowRings: 16,
  /**
   * Floating stream counts on screen at once. Each is handed out a frame at a
   * time to the rivers in range (`./streamBodies.ts`), so this is what the draw
   * range can hold rather than what a level registers: two lanes of river on
   * each of the rows in `ENEMY_DRAW_RANGE`, with two to spare. One label per
   * registered river was what this used to be, sized off the longest level's
   * rivers (19) — and the endless road registers twice that many (38), so
   * every river past its 1,390 m mark walked with no count over it.
   */
  streams: BLOCK_ROWS_IN_RANGE * 2 + 2,
  /**
   * Simultaneous impact bursts, per the plan's cap. `EffectsView` keeps one
   * ring of twice this, because muzzle flashes and the puff a leaked body
   * leaves are the same kind of thing and share it — Milestone 2 gave impacts
   * and flashes a pool of 24 each, which is the same total.
   */
  impacts: 24,
  splashes: 12,
  /**
   * Live chain arcs. Half as many again as Milestone 3's twelve: storm's
   * evolution is one more link on every arc (D33), so a volley that filled the
   * pool before now overruns it by exactly the hop the upgrade was bought for —
   * and the extra link is the last one pushed, so it is the one that would be
   * dropped.
   */
  chains: 18,
  /**
   * Billboarded spell quads live at once: every projectile plus its two tail
   * quads, the sparkles they shed, and the impacts and muzzle flashes — all one
   * mesh and one draw call (`./sprites.ts`).
   */
  sprites: 1024,
  /** Sparkles in the air behind the volley. */
  sparkles: 192,
  /**
   * Fence pieces (D32): every post of every wall stretch a level can carry, so
   * the longest level's walls are drawn whole rather than truncated. The
   * glowing edge rides the same count plus a cap and a road rune per stretch.
   */
  wallPosts: MAX_WALLS * POSTS_PER_WALL,
  wallRunes: MAX_WALLS * (POSTS_PER_WALL + 2),
  /**
   * Wisp sparks in flight (D33). The sim's own pool is `wisp.maxSparks`, so a
   * render pool that matches it can never drop a spark the sim is about to
   * resolve — the one thing the visual may not do, since the damage lands when
   * the spark arrives.
   */
  wispSparks: progression.wisp.maxSparks,
  /** Motes shed behind the wisp, and the flashes its sparks land with. */
  wispTrail: 24,
  wispBursts: 12,
  /**
   * Bodies drawn alight at once (D33, ember tier 2). A river can have three
   * hundred burning and a flame each would be six hundred quads and most of the
   * sprite budget, so the view draws the nearest this many and rotates which
   * ones through the rest (`./burn.ts`).
   */
  burning: 48,
} as const;
