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

import type { ScriptBeat } from './beat-types';
import type { BiomeId } from './biome-types';
import type { BossKind } from './enemy-types';

export interface ValueRange {
  min: number;
  max: number;
}

/**
 * Yard rungs by upgrade: the kit a scripted level's curve expects. Only the
 * two upgrades that shape a level are read (`startCount`, `gateBonus`; the
 * rest shape the run, which the beats' measured fire already carries).
 */
export interface ExpectedKit {
  startCount?: number;
  gateBonus?: number;
}

/**
 * One entry of `levels.json`: the recipe `generateLevel` turns into a `LevelDef`.
 *
 * Two kinds of recipe since the level-design plan (document 31, D70). A level
 * with a `script` is composed from designed beats (`src/sim/beats`), and its
 * row count, gates, threats and fences all come out of the script. A level
 * without one is *dealt* the way every level was before: the per-kind row
 * counts and the dials in `DealtFields` say what it holds and the seed says
 * where. The render fixtures, the stress scene and the endless road are dealt,
 * so those fields stay, optional here and required on `DealtLevelConfig`.
 */
export interface LevelGenConfig extends Partial<DealtFields> {
  index: number;
  seed: number;
  /**
   * The level as designed beats, in order (document 31, 3.9). Present means
   * the composer builds the level and every field of `DealtFields` is ignored.
   */
  script?: ScriptBeat[];
  /** How many curses the script may print (3.5); the rest print a small plus. */
  curses?: number;
  /**
   * Scales the squad the composer expects at the prep beat, fitted per level
   * so the expectation matches the human bot's median count (3.4). Absent is 1.
   */
  curveTrim?: number;
  /**
   * The Yard rungs the composer's curve expects the player to hold on
   * arriving (document 31, 3.4; D49): Frostfell is sized for the armed hand,
   * so its curve starts from the start-count rung and reads each plus as the
   * gate-bonus rung prints it. The player's own rungs are applied on top, as
   * on every level. Absent is a hand that bought nothing.
   */
  kit?: ExpectedKit;
  startCount: number;
  /**
   * Squad size this level is designed to peak at — the top of `squadCurve` and
   * the scale every gate and block on the level is sized against. Growth across
   * the campaign is this number rising, not the shared `maxCount` cap.
   */
  peakTarget: number;
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
}

/**
 * The recipe a level is *dealt* from (Milestones 3 to 9): read only on the
 * unscripted path.
 */
export interface DealtFields {
  /** How many rows the level deals. */
  rows: number;
  /** Multiplier on generated enemy block sizes. */
  hpScale: number;
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
   * Bodies one stream sends per unit of the squad the row is built for. It is
   * the density dial — and it is also what a leak costs, since a leak takes one
   * soldier per body: at 1.0 a three percent leak costs three percent of the
   * squad at any size.
   */
  streamDensity: number;
}

/**
 * A recipe the dealer can build: every dealt field present. `dealtConfig` in
 * `./index.ts` narrows a `LevelGenConfig` to it, and the dealt path in
 * `src/sim` (the row dealer, the gate rules, the stream sizing, the curve)
 * takes nothing looser.
 */
export type DealtLevelConfig = LevelGenConfig & DealtFields;

/**
 * The recipe as the dealer reads it, or null when the level is scripted or a
 * dealt field is missing.
 *
 * Checked field by field rather than trusted, because `levels.json` is edited
 * by hand and a level that lost its `gateRows` in an edit should fail where it
 * is read, not deal a level of `NaN` rows.
 */
export function dealtConfig(config: LevelGenConfig): DealtLevelConfig | null {
  if (config.script !== undefined) return null;
  const {
    rows,
    hpScale,
    gateValues,
    gateRows,
    mixedRows,
    hordeRows,
    bruteRows,
    wallRows,
    streamPressure,
    streamDensity,
  } = config;
  if (
    rows === undefined ||
    hpScale === undefined ||
    gateValues === undefined ||
    gateRows === undefined ||
    mixedRows === undefined ||
    hordeRows === undefined ||
    bruteRows === undefined ||
    wallRows === undefined ||
    streamPressure === undefined ||
    streamDensity === undefined
  ) {
    return null;
  }
  return {
    ...config,
    rows,
    hpScale,
    gateValues,
    gateRows,
    mixedRows,
    hordeRows,
    bruteRows,
    wallRows,
    streamPressure,
    streamDensity,
  };
}

/** `dealtConfig`, for a caller that has nothing to fall back on. */
export function requireDealt(config: LevelGenConfig): DealtLevelConfig {
  const dealt = dealtConfig(config);
  if (dealt === null) {
    throw new Error(
      `level ${String(config.index)} is ${config.script === undefined ? 'missing a dealt field' : 'scripted'}; it cannot be dealt`,
    );
  }
  return dealt;
}
