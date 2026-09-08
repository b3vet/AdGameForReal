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
    /**
     * Floor on that clamp once the crowd's own half-width is taken off it
     * (`Run.clampLimit`). It has to stay at or inside a lane centre so the
     * widest squad can still reach a side lane's gate.
     */
    clampMin: number;
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
    /**
     * Share of a gate row's growth budget that shooting one gate can supply.
     * The budget itself comes from the level's own curve (see `addCap` in
     * `level.ts`); this dial says how much of it a player who shoots well gets,
     * with the rest coming from `mul` gates. Below 1 the level needs its
     * multipliers; above 1 add gates alone outrun the curve.
     */
    addCapShare: number;
    /** Smallest gate growth budget, as a share of the expected squad. */
    addCapFloor: number;
    /** Meters a mixed row's block stands short of its gate row, so labels clear. */
    mixedEnemyOffset: number;
    /** Longest run of rows with no gate at all before one is forced. */
    maxEnemyRun: number;
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
  /** Numbers the shell needs. Timings are in seconds unless the name says else. */
  ui: {
    /** Seconds the result screen waits so the killing blow plays out. */
    resultDelay: number;
    /** CSS pixels per second of held steering key, matched to a brisk drag. */
    keySpeed: number;
    /** How long the level-1 gate legend stays on screen. */
    legendSeconds: number;
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
  /**
   * Squad size this level is designed to peak at — the top of `squadCurve` and
   * the scale every gate and block on the level is sized against. Growth across
   * the campaign is this number rising, not the shared `maxCount` cap.
   */
  peakTarget: number;
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
