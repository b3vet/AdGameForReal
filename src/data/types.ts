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
