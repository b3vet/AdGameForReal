/**
 * Schema for `levels.json`: one entry per level, the recipe `generateLevel`
 * turns into a `LevelDef`.
 *
 * Split out of `./types.ts` in Milestone 7 for the file-size rule (CLAUDE.md).
 * The seam is the one the campaign already has: `./types.ts` is the *road* —
 * how fast a squad runs, what a gate does, how the generator behaves — and this
 * is the forty recipes that road is dealt from. `./types.ts` re-exports every
 * name here, so `@/data/types` is still the one import site.
 */

import type { BiomeId } from './biome-types';
import type { BossKind } from './enemy-types';

export interface ValueRange {
  min: number;
  max: number;
}

/** One entry of `levels.json`: the recipe `generateLevel` turns into a `LevelDef`. */
export interface LevelGenConfig {
  index: number;
  seed: number;
  rows: number;
  startCount: number;
  /**
   * Squad size this level is designed to peak at — the top of `squadCurve` and
   * the scale every gate and block on the level is sized against. Growth across
   * the campaign is this number rising, not the shared `maxCount` cap.
   */
  peakTarget: number;
  /** Multiplier on generated enemy block sizes. */
  hpScale: number;
  /**
   * Which biome the level is set in (D49). Absent means `meadow`, which is
   * every level of the first twenty — the field was added for Frostfell and
   * the levels that predate it are left exactly as they were written.
   */
  biome?: BiomeId;
  /**
   * `bite` scales what a stomp and boss contact take (D31): levels 1 to 3 are
   * generous, and the Milestone 2 attrition returns at full strength from
   * level 6. The fight's *length* stays in the 18 to 32 second band on every
   * level; only what it costs changes.
   *
   * `kind` is which boss stands in the arena (D49); absent means `demon`, for
   * the same reason `biome` is optional.
   */
  boss: { hp: number; bite: number; kind?: BossKind };
  gateValues: {
    mul: ValueRange;
    add: ValueRange;
    /** The curse range for this level, before the `curseShare` ceiling. */
    sub: ValueRange;
    fireRate: ValueRange;
  };
  /** How many of this level's rows carry gates (the plan's 8 to 12). */
  gateRows: number;
  /** How many of those gate rows also stand a block short of the gate. */
  mixedRows: number;
  /** Threat rows that pour two streams at once. */
  hordeRows: number;
  /** Threat rows that stand a brute block instead of a stream. */
  bruteRows: number;
  /**
   * Threat rows that stand a charger waiting in a lane (D49), and threat rows
   * that stand a shielded brute. Both are dealt out of the same pool as
   * `hordeRows` and `bruteRows`; whatever is left over is a plain stream row.
   *
   * Optional, and absent means zero, so the twenty levels of biome 1 are the
   * recipes they were written as, byte for byte.
   */
  chargerRows?: number;
  shieldRows?: number;
  /**
   * Gate rows this level guards with a lane wall (D32). Zero below
   * `balance.walls.fromLevel`; most of them from level 11.
   */
  wallRows: number;
  /**
   * The pressure a stream on this level is built to: `count * hp` over
   * `expected squad dps * window` (docs/09-milestone-3-plan.md, "Stream
   * pressure"). 0.45 to 0.6 on levels 1 to 3, 0.65 to 0.8 on 4 and 5, 0.85 to
   * 0.95 from 6.
   */
  streamPressure: number;
  /**
   * A milestone level (D45, and D48 for the list): 7, 10, 15 and 20 as
   * shipped, which the road is not meant to give up without the upgrades the
   * economy has paid for by then. Level 5 was on the list until the balance
   * report showed the set affordable by then is worth a few percent of output.
   * The generator turns `balance.gen.milestone`'s screws on it; everything
   * else about the level is the ordinary per-level tuning below.
   *
   * Optional because the render fixtures and the stress scene build a config
   * by hand and an ordinary level is the default.
   */
  milestone?: boolean;
  /**
   * Bodies one stream sends per unit of the squad the row is built for. It is
   * the density dial — and it is also what a leak costs, since a leak takes one
   * soldier per body: at 1.0 a three percent leak costs three percent of the
   * squad at any size.
   */
  streamDensity: number;
}
