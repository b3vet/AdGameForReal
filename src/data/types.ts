/**
 * Types for the tuning JSON. All tuning numbers live in `src/data/*.json`,
 * never inline in code (CLAUDE.md), so these types are the schema the sim
 * and the app read against.
 */

export interface EnemyBalance {
  /** HP one visual unit of this block is worth; `units = ceil(hp / hpPerUnit)`. */
  hpPerUnit: number;
  speed: number;
  /** Half-width of the block's footprint along `x`, in meters. */
  footprint: number;
}

export interface BossBalance extends EnemyBalance {
  stompInterval: number;
  stompRange: number;
  stompKills: number;
  contactKillsPerSecond: number;
  /** How fast the boss slides sideways to line itself up with the squad. */
  lateralSpeed: number;
}

export interface Balance {
  squad: {
    runSpeed: number;
    lateralSpeed: number;
    fireRate: number;
    damage: number;
    maxCount: number;
  };
  projectiles: {
    speed: number;
    range: number;
    /** Above this many live projectiles the sim batches shots into hitscan. */
    max: number;
    /** Added to a target's half-width when testing whether a shot connects. */
    radius: number;
  };
  road: {
    laneWidth: number;
    /** The road spans `x in [-halfWidth, halfWidth]`. */
    halfWidth: number;
    /** The squad centre is clamped to `x in [-clampX, clampX]`. */
    clampX: number;
  };
  enemies: {
    activationDistance: number;
    contactDistance: number;
    /** A block's half-width grows by this much per `sqrt(units)`. */
    footprintPerUnit: number;
    /** Ceiling on a block's half-width, so a huge block never spans the road. */
    footprintMax: number;
    /** A block this far behind the squad is retired from the sim. */
    despawnBehind: number;
    grunt: EnemyBalance;
    brute: EnemyBalance;
    boss: BossBalance;
  };
  level: {
    rowSpacing: number;
    /** The boss stands at `arenaZ + bossOffset`. */
    bossOffset: number;
  };
  gates: {
    caps: {
      add: number;
      fireRate: number;
    };
    /** Value added to a shootable gate per projectile hit. */
    hitStep: {
      add: number;
      sub: number;
      fireRate: number;
    };
  };
  /**
   * Level generator tuning. The generator scales every number it writes by a
   * running estimate of the squad size at that row, so a level plays the same
   * shape whether the player arrives with 20 units or 400.
   */
  gen: {
    /** Chance a gate row includes its one allowed `mul` gate. */
    mulChance: number;
    /** Chance a non-`mul` positive gate is a `fireRate` gate instead of `add`. */
    fireRateChance: number;
    /** Chance a gate row has three gates rather than two. */
    thirdGateChance: number;
    /** `add` gate value as a fraction of the estimated squad size. */
    addFrac: { min: number; max: number };
    /** `sub` gate penalty as a fraction of the estimated squad size. */
    subFrac: { min: number; max: number };
    /** Block size as a fraction of the estimated squad size, before `hpScale`. */
    enemyFrac: { min: number; max: number };
    /** Chance a generated block is a brute (slow, 10x hp per unit) not a grunt. */
    bruteChance: number;
    /** A brute block carries this share of a grunt block's unit count. */
    bruteUnitFrac: number;
    /** The block guarding a good gate on a mixed row, relative to a normal block. */
    mixedBlockFrac: number;
    /** Levels below this one never generate `sub` gates. */
    negativeFromLevel: number;
    /** Chance a row that may carry penalties carries two of them. */
    doubleSubChance: number;
    /** Share of `maxCount` the expected-squad curve reaches on the last row. */
    curveTarget: number;
  };
  bots: {
    /** How far ahead a scripted player looks for a block about to reach it. */
    threatLookahead: number;
    /** Inside this distance to the next gate row, a bot commits to its lane. */
    gateCommitDistance: number;
  };
  input: {
    /** Road meters travelled for one full screen width of drag. */
    sensitivity: number;
  };
}

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
  /** Multiplier on generated enemy block sizes. */
  hpScale: number;
  boss: { hp: number };
  gateValues: {
    mul: ValueRange;
    add: ValueRange;
    sub: ValueRange;
    fireRate: ValueRange;
  };
  rowWeights: {
    gate: number;
    enemy: number;
    mixed: number;
  };
}
