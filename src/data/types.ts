/**
 * Types for the tuning JSON. All tuning numbers live in `src/data/*.json`,
 * never inline in code (CLAUDE.md), so these types are the schema the sim
 * and the app read against.
 */

/** The three staffs (docs/06-milestone-2-plan.md, "Weapons"). */
export type WeaponId = 'ember' | 'storm' | 'frost';

/** Ember: every block within `radius` of the impact takes damage, falling off
 *  linearly to `1 - falloff` at the rim. */
export interface WeaponSplash {
  radius: number;
  falloff: number;
}

/** Storm: after a hit, up to `count` further blocks within `range` of the last
 *  one are struck for `damageMul` of the shot's damage. No block twice. */
export interface WeaponChain {
  count: number;
  range: number;
  damageMul: number;
}

/** Frost: the block walks at `factor` of its speed for `seconds`, and a kill
 *  while slowed shatters instead of collapsing. */
export interface WeaponSlow {
  factor: number;
  seconds: number;
  shatterOnKill: boolean;
}

/**
 * One staff. The record key in `weapons.json` is the id, so the def itself
 * carries no `id` field: a string in JSON widens to `string` and would not
 * satisfy `WeaponId` without a cast.
 */
export interface WeaponDef {
  /** Multiplier on `balance.squad.damage`. */
  damage: number;
  /** Multiplier on the squad's effective fire rate. */
  fireRateMul: number;
  projectileSpeed: number;
  splash?: WeaponSplash;
  chain?: WeaponChain;
  slow?: WeaponSlow;
}

export type WeaponData = Record<WeaponId, WeaponDef>;

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
  /** Floor on the units one stomp removes, whatever the squad size. */
  stompKills: number;
  /** Share of the squad one stomp removes, above that floor. */
  stompShare: number;
  /** Share of the squad standing in contact that dies every second. */
  contactShare: number;
  /** Fraction of max HP at which the boss enrages. */
  enrageAt: number;
  /** Stomp interval once enraged. */
  enrageStompInterval: number;
  /** Walk speed multiplier once enraged. */
  enrageSpeedMul: number;
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
    /** Fallback speed; a staff's own `projectileSpeed` overrides it. */
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
    /**
     * Smallest share of a block's units a contact can cost, however narrow the
     * overlap. A graze has to hurt, or dodging by a centimetre would be free.
     */
    contactMinShare: number;
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
    /** Absolute ceilings, whatever a gate's own cap works out to. */
    caps: {
      add: number;
      fireRate: number;
    };
    /**
     * Smallest visible step for a gate of this kind. Growth is rate-based
     * (`growthPerSecond`), so this is no longer what one hit is worth: it is the
     * granularity the generator uses to pull two gates on one row apart.
     */
    hitStep: {
      add: number;
      sub: number;
      fireRate: number;
    };
    /**
     * Shoot-to-grow, per second of the squad's *whole* output (D19): a gate
     * grows by `growthPerSecond[kind] * (its share of this step's shots)`, so a
     * 300-unit squad cannot max a gate in one volley and focus is what pays.
     */
    growthPerSecond: {
      add: number;
      sub: number;
      fireRate: number;
    };
    /** A gate can be shot up by this share of its printed value... */
    capShare: number;
    /** ...or by this much, whichever is more. */
    capFloor: {
      add: number;
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
    /** Levels below this one never generate `mul` gates. */
    mulFromLevel: number;
    /** Levels below this one cap their multipliers at x2. */
    mulX3FromLevel: number;
    /** Chance a non-`mul` positive gate is a `fireRate` gate instead of `add`. */
    fireRateChance: number;
    /** Chance a gate row has three gates rather than two. */
    thirdGateChance: number;
    /**
     * Expected share of its own printed value a well-shot `add` gate gains on
     * the way in. The generator divides it out of the value it prints, so the
     * curve lands on `peakTarget` for a player who shoots rather than one who
     * only steers.
     */
    addShotBonus: number;
    /** Multiplier on the derived `add` value: the dial for the whole curve. */
    addValueShare: number;
    /** Random spread around that derived value, so a row is a real choice. */
    addJitter: { min: number; max: number };
    /** Floor on the derived `add` value as a share of the expected squad. */
    addFracFloor: number;
    /** A curse never costs more than this share of the expected squad. */
    curseShare: number;
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
    /** Meters a mixed row's block stands short of its gate row, so labels clear. */
    mixedEnemyOffset: number;
    /** Longest run of rows with no gate at all before one is forced. */
    maxEnemyRun: number;
    /**
     * Staff gates are off until the renderer can draw them (Phase C flips this).
     * Tests turn it on explicitly.
     */
    weaponGatesEnabled: boolean;
    /** Chance an eligible row spends one of its lanes on a staff gate. */
    weaponGateChance: number;
    /** Staff gates allowed per level below `weaponGateManyFromLevel`... */
    weaponGatesEarly: number;
    /** ...and from that level on. */
    weaponGatesLate: number;
    weaponGateManyFromLevel: number;
  };
  bots: {
    /** How far ahead a scripted player looks for a block about to reach it. */
    threatLookahead: number;
    /** Inside this distance to the next gate row, a bot commits to its lane. */
    gateCommitDistance: number;
    /** Rows of enemy layout a bot reads when valuing a staff gate. */
    weaponLookaheadRows: number;
    /** How much of the squad a doubling of expected DPS is worth to a bot. */
    weaponWorth: number;
    /** What a slow is worth as a share of DPS, since it buys time not damage. */
    weaponSlowWorth: number;
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
    /** The curse range for this level, before the `curseShare` ceiling. */
    sub: ValueRange;
    fireRate: ValueRange;
  };
  rowWeights: {
    gate: number;
    enemy: number;
    mixed: number;
  };
}
