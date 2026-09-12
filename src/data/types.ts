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
    /** No wall may come within this of a gate row's `z`, either side. */
    gateClearance: number;
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

/** The five training-yard upgrades. Levels run 0 to `Progression.upgrades.maxLevel`. */
export type UpgradeId = 'damage' | 'fireRate' | 'startCount' | 'gateBonus' | 'bossDamage';

/** A staff is bought at tier 1 and evolved once (D33: one evolution each). */
export type StaffTier = 1 | 2;

/** 0 is "no wisp at all"; the Sanctum sells tiers 1 to 3. */
export type FamiliarTier = 0 | 1 | 2 | 3;

/**
 * Everything the meta layer remembers. The app owns it and saves it; the sim
 * only reads it, and reads it exactly once per run (D35): every upgrade is a
 * multiplier resolved at construction, so a purchase mid-run is impossible by
 * construction and the balance bands stay defined for a player with nothing
 * bought.
 */
export interface PlayerState {
  coins: number;
  upgrades: Record<UpgradeId, number>;
  staffs: Record<WeaponId, { unlocked: boolean; tier: StaffTier }>;
  /**
   * The staff a run starts with. Added to the contract's shape because
   * `staffs` is a record and a record has no order: the Workbench has to be
   * able to say *which* unlocked staff is in hand. Weapon gates still swap it
   * mid-run.
   */
  selectedStaff: WeaponId;
  familiar: { unlocked: boolean; tier: FamiliarTier };
  /** Enemy and boss ids seen, for the bestiary. The sim never reads it. */
  bestiary: string[];
  unlockedLevel: number;
}

/** Ember's evolution: a burn that ticks for a share of the hit that lit it. */
export interface BurnDef {
  /** Share of the hit's damage the whole burn is worth. */
  share: number;
  seconds: number;
  tickSeconds: number;
}

/** Frost's evolution: a shatter that sprays its neighbours. */
export interface ShatterDef {
  radius: number;
  /** Share of the killing hit each neighbour takes. */
  share: number;
}

/** One staff's tier-2 behaviour. Exactly one field is set per staff. */
export interface EvolutionDef {
  burn?: BurnDef;
  /** Storm: further targets on top of `WeaponChain.count`. */
  extraChains?: number;
  shatter?: ShatterDef;
}

/**
 * The wisp (D33). Rate and damage are indexed by tier, so index 0 is the
 * "no wisp" slot and never read.
 */
export interface WispDef {
  /** Price of tier 1, i.e. of unlocking it at all. */
  unlock: number;
  /** Price of reaching each tier; index 0 is unused. */
  tierPrices: number[];
  /** Hover offset from the squad centre: `x + offsetX * side`, `z + offsetZ`. */
  offsetX: number;
  offsetZ: number;
  /** How far ahead it will look for a target. */
  range: number;
  /** Spark travel speed; the hit lands `distance / sparkSpeed` seconds later. */
  sparkSpeed: number;
  /** Sparks in flight at once. Pooled, so this is also the allocation. */
  maxSparks: number;
  fireRate: number[];
  damage: number[];
}

/** `src/data/progression.json`: every number the meta layer costs and pays. */
export interface Progression {
  upgrades: {
    /** `baseCost * costGrowth ^ level` coins to buy the next level. */
    baseCost: number;
    costGrowth: number;
    maxLevel: number;
    /** What one level of each upgrade is worth (a share, except `startCount`). */
    effects: Record<UpgradeId, number>;
  };
  staffs: Record<WeaponId, { unlock: number; evolve: number }>;
  evolutions: Record<WeaponId, EvolutionDef>;
  wisp: WispDef;
  rewards: {
    perSurvivor: number;
    /** Coins per level index on any clear... */
    perClear: number;
    /** ...and again, larger, the first time that level is cleared. */
    firstClear: number;
  };
}
