/**
 * Types for the tuning JSON. All tuning numbers live in `src/data/*.json`,
 * never inline in code (CLAUDE.md), so these types are the schema the sim
 * and the app read against.
 */

/**
 * The staffs are `./weapon-types.ts` and the meta layer is
 * `./progression-types.ts`; both were split out in Milestone 4 Phase D for the
 * file-size rule and are re-exported here, so every importer still reads one
 * module.
 */
export type {
  WeaponChain,
  WeaponData,
  WeaponDef,
  WeaponId,
  WeaponSlow,
  WeaponSplash,
} from './weapon-types';

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
    /**
     * Ceiling on live bodies on the road at once (D29). A stream that would
     * push past it pauses spawning until the squad has thinned the river.
     */
    maxLive: number;
    /**
     * How long a dead body stays in `state.enemies` before it is compacted
     * away, so render has time to play the death it was told about.
     */
    corpseSeconds: number;
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
  /** Lane walls (D32): the fence the squad cannot cross. See `src/sim/walls.ts`. */
  walls: {
    /** Metres before a wall proper where its clamp already applies, so a
     *  straddling squad is pushed to the side its centre is on. */
    approach: number;
    /** How far off the boundary line the squad's centre is held. A point exactly
     *  on the line reads as the side lane (`laneOf`), so zero would let a
     *  clamped squad take the gate it was walled away from. */
    margin: number;
    /**
     * No wall may come within this of a gate row's `z`, either side — except
     * the row it guards, which is `gateGap` past its far end.
     */
    gateClearance: number;
    /**
     * Metres between a stretch's far end and the gate row it guards: the fence
     * stops short of the panels, and the clamp covers the gap (`wallHolds`).
     *
     * The pair is what makes a wall a decision rather than a nudge (Milestone 4
     * Phase C). The fence used to stop a whole `gateClearance` short with the
     * clamp ending on it, and at `squad.lateralSpeed` over `squad.runSpeed` the
     * squad buys 1.6 m of lane per metre of road — so it crossed the boundary
     * it had been held behind long before the panels and the wall changed
     * nothing. Now the choice is settled at the row and only the fence's last
     * half-metre is missing, which is what keeps the posts out of the panels.
     */
    gateGap: number;
    /** A stretch shorter than this is not placed at all. */
    minLength: number;
    /** How long a stretch runs, before the clearance rules trim it. */
    length: { min: number; max: number };
    /** First level that may carry walls (D32: from level 4). */
    fromLevel: number;
    /**
     * First row a wall may guard. The opening rows are where the squad is
     * smallest and a stream it cannot reach costs a share of everything it has,
     * so the road only starts taking choices away once there is a squad.
     */
    fromRow: number;
    /** From this level a stretch over a horde row may wall both boundaries. */
    bothFromLevel: number;
  };
  /** Enemy streams (D29): the river of single bodies that walks down a lane. */
  streams: {
    /**
     * Metres in front of the squad a stream body appears. The squad runs at
     * `squad.runSpeed`, so a fixed spawn point would be behind it in seconds;
     * the spawner keeps pace instead and the stream reads as a river coming on.
     * Set to `projectiles.range` so a body is shootable from the moment it
     * exists, which is what makes the pressure window well defined.
     */
    spawnAhead: number;
    speed: number;
    /** Half-width of one body: a stream is bodies, not a block-wide wall. */
    footprint: number;
    /**
     * A body that got past the squad is retired this far behind it — much
     * sooner than a block, because every body still on the road is one more
     * entry the lane sweeps walk past.
     */
    despawnBehind: number;
    /**
     * Widens a body's band for *targeting only* — not for contact, not for
     * splash. A body is a person, half a metre wide, standing somewhere in a
     * two-metre lane; without this, most of a squad's shots fly straight past
     * one and the lane's real damage is a fraction of what the pressure model
     * says it is. The wizards are aiming.
     */
    aimAssist: number;
    /** Lateral scatter around the lane centre, in metres, each way. */
    jitter: number;
    /** Bounds on the HP the generator may give one body. */
    hpPerEnemy: { min: number; max: number };
    count: { min: number; max: number };
    duration: { min: number; max: number };
    /**
     * Share of the squad's fire that lands in one lane when the crowd stands on
     * it. The squad is wider than a lane, so a single stream never takes the
     * whole output; the pressure model divides by this.
     */
    laneShare: number;
    /** The same for a horde row, where the crowd is split between two lanes. */
    hordeLaneShare: number;
    /** Bodies the average body has inside a splash, for `expectedDps`. */
    neighbours: number;
    /** Fire-rate bonus the pressure model assumes a player has picked up. */
    rateBonus: number;
    /**
     * The one empirical dial on the model: what the measured greedy leak rates
     * say the squad really lands, over what the model says it should. Every
     * other term in `pressure.ts` is derived; this absorbs the rest.
     */
    dpsTrim: number;
    /** No stream or block may stand within this many metres of a gate row. */
    gateClearance: number;
    /** How far a threat row may be nudged off the row grid, each way. */
    zJitter: number;
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
     * Below this level every gate row fills all three lanes. Level 1 has no
     * curses, so an empty lane is the only way one of its rows can give a
     * player nothing, and a player still learning to steer finds it (D31).
     */
    fullGateRowsFromLevel: number;
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
    /** Staff gates in generated levels. On since Phase C drew the staffs. */
    weaponGatesEnabled: boolean;
    /** First level that may carry one (the plan's "from level 2"). */
    weaponFromLevel: number;
    /** Staff gates allowed per level below `weaponGateManyFromLevel`... */
    weaponGatesEarly: number;
    /** ...and from that level on. */
    weaponGatesLate: number;
    weaponGateManyFromLevel: number;
    /** Lanes between the two streams of a horde row: 2 means opposite sides. */
    hordeLaneGap: number;
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
    /** How far ahead greedy looks for the stream lane it should stand in. */
    streamLookahead: number;
    /** Most bodies a staff valuation reads, so a stream cannot swamp it. */
    weaponLayoutMax: number;
    /**
     * How close to a wall's approach zone a bot commits to the side it wants
     * (D32). Inside the fence there is no changing sides, so the lane has to be
     * chosen before it, and far enough out that the crowd can cross the road in
     * time — six metres of road is a little over a second, and the squad moves
     * sideways faster than it runs.
     */
    wallCommitDistance: number;
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
    /** Hit-stop on a block kill, and the gap before another one may fire. */
    hitStopSeconds: number;
    hitStopCooldown: number;
    /** Boss kill: the plan's 0.3x for 0.6 s. */
    bossKillScale: number;
    bossKillSeconds: number;
    /** Defeat crawl, held until the result screen replaces the run. */
    defeatScale: number;
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
  /**
   * `bite` scales what a stomp and boss contact take (D31): levels 1 to 3 are
   * generous, and the Milestone 2 attrition returns at full strength from
   * level 6. The fight's *length* stays in the 18 to 32 second band on every
   * level; only what it costs changes.
   */
  boss: { hp: number; bite: number };
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

/* ------------------------------------------------------------------ */
/* Progression (Milestone 4, D33 and D35)                              */
/* ------------------------------------------------------------------ */

/**
 * The meta layer's schema is `./progression-types.ts` — it is the player rather
 * than the campaign, and this file was past the size rule. Re-exported here so
 * every importer still reads one module.
 */
export type {
  BurnDef,
  EvolutionDef,
  FamiliarTier,
  PlayerState,
  Progression,
  ShatterDef,
  StaffTier,
  UpgradeId,
  WispDef,
} from './progression-types';
