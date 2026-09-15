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

/**
 * Which biome a level is set in (D49). Its own one-line module because the
 * render track's palette reads it without pulling in the whole schema, and
 * because two parallel tracks had to be able to write the same file.
 */
export type { BiomeId } from './biome-types';

/**
 * The enemy schema is `./enemy-types.ts` — a body, a boss and the two kinds
 * Frostfell adds (D49) — split out for the file-size rule and re-exported here
 * so every importer still reads one module.
 */
import type { BossBalance, ChargerBalance, EnemyBalance, ShieldBalance } from './enemy-types';

export type {
  BossBalance,
  BossKind,
  ChargerBalance,
  EnemyBalance,
  RimeBalance,
  ShieldBalance,
} from './enemy-types';

/**
 * The level recipes are `./level-types.ts` — the forty entries of
 * `levels.json` — split out for the file-size rule and re-exported here so
 * every importer still reads one module.
 */
import type { ValueRange } from './level-types';

export type { LevelGenConfig, ValueRange } from './level-types';

/**
 * Ember tier 3: a burning body passes the fire to what it is touching, once.
 *
 * `share` is of the source's own per-tick damage rather than of the shot that
 * lit it: the new fire is the old fire spreading, so it cannot be hotter than
 * what it came from, and a river cannot be set alight at full strength by one
 * body at the front of it.
 */
export interface WildfireBalance {
  /** Metres, centre to centre. "Touching" at a body's own scale. */
  radius: number;
  share: number;
  /** Most bodies one source may light. The hop budget, per source, for ever. */
  maxTargets: number;
}

/** Ember tier 4: a charged shot on the crowd's aim point every N seconds. */
export interface MeteorBalance {
  intervalSeconds: number;
  /** Metres ahead of the squad it lands when the lane holds nothing to aim at. */
  ahead: number;
  radius: number;
  /** Share of the damage lost at the rim, as `WeaponSplash.falloff`. */
  falloff: number;
  /**
   * What the meteor is worth, in seconds of the squad's *own* fire.
   *
   * Every other number in this block is a distance or a clock, and this one is
   * deliberately the same shape: a flat damage figure would be a wipe at level
   * 1 and a spark at level 40, because the squad's output is two orders of
   * magnitude apart across the campaign. Read against the shot rate and the
   * damage the squad actually has, a meteor is worth the same *share* of a run
   * whatever the player is carrying, which is the only way a tier price can be
   * right on every level (D54: never mandatory below 40).
   */
  secondsOfFire: number;
  /** What the impact does to the crowd, through the same push field a body uses. */
  shoveStrength: number;
  shoveSeconds: number;
}

/** Storm tier 4: every Nth volley arcs to everything in range at once. */
export interface OverchargeBalance {
  everyVolleys: number;
  /** Metres from the squad's own position. */
  radius: number;
  /** What one arc is worth, in seconds of the squad's fire (`MeteorBalance`). */
  secondsOfFire: number;
  maxTargets: number;
  /**
   * Floor on the gap between two overcharges, in seconds. A volley is a step
   * that fired at all, which at any real squad size is every step, so the
   * count alone would arc twelve times a second — a buzz rather than a beat.
   * The count is what governs a squad too small to fire every step.
   */
  minSeconds: number;
}

/** Frost tier 3: a slowed body that dies chills whatever is standing around it. */
export interface FreezePulseBalance {
  radius: number;
  seconds: number;
  /** Speed multiplier the chill applies, like `WeaponSlow.factor`. */
  factor: number;
  maxTargets: number;
  /**
   * Share of the killing hit each chilled neighbour takes with the cold.
   *
   * Added in Milestone 8's balance pass. The pulse was time and nothing else,
   * and measured end to end it was worth *less than nothing*: a slowed body
   * lives longer in front of the column, so the crowd walks into it. A share of
   * the hit makes the tier something the player can see happening, and keeps it
   * a smaller, wider version of the tier-2 shatter rather than a second one.
   */
  share: number;
}

/** Frost tier 4: a wall of ice holds one lane's river where it stands. */
export interface GlacierBalance {
  intervalSeconds: number;
  holdSeconds: number;
  /** Metres in front of the squad the wall goes up. */
  ahead: number;
  /** Bodies that have to be in the lane before it is worth a wall. */
  minBodies: number;
  /**
   * What the ice takes out of what it is holding, in seconds of the squad's
   * own fire a second, split between the bodies against the wall
   * (`MeteorBalance.secondsOfFire` is the same currency).
   *
   * A wall that only *held* was worth nothing, and the reason is the road
   * rather than the wall: the column runs forward at more than twice a
   * grunt's walking speed, so stopping a body for five seconds buys the squad
   * about a second and a half of extra fire on it and nothing else. Measured
   * end to end at a hold of eight seconds in every nine, six metres in front
   * of the column, it moved the run by under a percent. So the cold bites what
   * it holds: the river that stacks up against the wall is a river that dies
   * there, which is the thing a player is buying.
   */
  bite: number;
}

/**
 * What the six Milestone 8 evolutions are worth (D54). Which tier switches each
 * one on is `progression.json` — that is what a player *buys* — and this is how
 * far it reaches and how hard it hits, which is what gets tuned.
 */
export interface EvolutionBalance {
  ember: { wildfire: WildfireBalance; meteor: MeteorBalance };
  storm: { overcharge: OverchargeBalance };
  frost: { freezePulse: FreezePulseBalance; glacier: GlacierBalance };
}

export interface Balance {
  squad: {
    runSpeed: number;
    fireRate: number;
    damage: number;
    maxCount: number;
  };
  /**
   * The crowd (D43): every unit is an agent that seeks its slot, keeps its
   * distance, slides along fences, funnels through arches and is shoved by
   * enemies, and the leader those slots hang from. See `src/sim/crowd.ts`.
   *
   * Milestone 6 moved the head's own motion here from `squad.lateralSpeed`,
   * `lateralAccel` and `lateralSpring` (D37): the head is on the finger now,
   * so it is a stiffer spring with no acceleration cap, and it is the crowd's
   * own forces rather than the head's easing that make the motion read as
   * people.
   */
  crowd: {
    /**
     * How fast a unit closes the gap to its slot, in reciprocal seconds. The
     * seek is first order — the unit's velocity is its slot's velocity plus
     * this times the error — so there is no steady-state lag behind a column
     * running at `squad.runSpeed` and no wind-up to oscillate.
     */
    seekRate: number;
    separation: {
      /** Neighbours closer than this push each other apart, in metres. */
      radius: number;
      /** Push at full overlap, in m/s; it falls linearly to zero at `radius`. */
      force: number;
      /** Ceiling on the whole step's separation push, in m/s. */
      maxPush: number;
    };
    /** Half a unit's shoulders: what a fence, an arch leg and a spawn clear. */
    bodyRadius: number;
    /** Ceiling on a unit's speed *relative to its slot*, in m/s. */
    maxSpeed: number;
    /** The same for a unit flagged `REJOINING`, which has ground to make up. */
    rejoinSpeed: number;
    /** The head's spring, in rad/s. Critically damped, no acceleration cap. */
    leaderSpring: number;
    /** Ceiling on the head's own speed, in m/s. */
    leaderSpeed: number;
    /**
     * Steps of delay per row of the column: row `r` aims at where the leader
     * was `r * chainStepsPerRow` steps ago, so a turn travels down the column
     * and the tail whips (D43).
     */
    chainStepsPerRow: number;
    shove: {
      /** Metres per second a fully overlapping body pushes a unit backward... */
      back: number;
      /** ...and sideways, away from the body's own `x`. */
      side: number;
      /**
       * Metres of `z` a body's shove reaches beyond its own footprint. Contact
       * resolves at `enemies.contactDistance`, which is far wider than a body
       * is deep, so without this a body would kill on the step it first touched
       * anybody and the crowd would never be seen to give ground.
       */
      reach: number;
    };
    /** Most groups at once, the main column included (D44). */
    groupCap: number;
    arch: {
      /** Metres of `z` an arch's legs block at a gate row. */
      depth: number;
      /** Half the width of one leg, in metres. */
      legHalf: number;
    };
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
     * (`Run.clampLimit`). A side lane's centre, so the widest squad can always
     * stand *on* a side gate rather than merely inside the lane it is in: a
     * lane-wide column is the shape the whole choice is made with (D42), and a
     * clamp that stopped short of the centre would leave a side gate reachable
     * only by the half of the crowd that happened to be on that side.
     *
     * It costs nothing at the shipped geometry — the crowd is at most half a
     * lane wide, so the taper is 2.2 m and never reaches this floor — which is
     * the point: the floor is what fails loudly if the crowd ever widens again.
     */
    clampMin: number;
  };
  /**
   * The lane column (D42, superseding the formation half of D37). See
   * `src/sim/formation.ts`: the crowd is one lane wide and grows *backward*, so
   * it reads as a column standing in a lane rather than as a line across the
   * road — which is the only shape that makes sense once walls separate the
   * lanes, and the shape that makes the squad's fire a lane the player chooses.
   */
  formation: {
    /** Spacing between neighbours, in metres: `max` at a handful, `min` at
     *  `spacingTo` units. */
    spacing: { max: number; min: number };
    /** Squad size the spacing has finished shrinking at. */
    spacingTo: number;
    /** Gap between rows as a share of the spacing; under 1, so rows pack
     *  tighter than columns and the column stays framable at five hundred. */
    rowDepth: number;
    /** Added to the outermost unit's offset for `halfWidth`, so contact feels
     *  fair rather than pixel-exact. */
    padding: number;
    /** Offsets are cached per count and per this much available width. */
    widthBucket: number;
    /**
     * How far inside its lane's edges the crowd stands, each side: the band is
     * `road.laneWidth - 2 * laneInset`. Small, because the crowd *is* the lane
     * — the inset is only there so the column sits visibly inside the lane
     * lines and so its outermost unit clears a fence standing on one.
     */
    laneInset: number;
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
    /** The charger (D49). A shielded brute is a brute and reads `brute`. */
    charger: ChargerBalance;
    /** What a shield is worth on the brute that carries one (D49). */
    shield: ShieldBalance;
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
     * clamp ending on it, and at `crowd.leaderSpeed` over `squad.runSpeed` the
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
    /**
     * Metres of clear road between one stretch's far end and the next one's
     * start (D49's fairness re-check).
     *
     * Two stretches closer than this are a *pair* rather than two choices: a
     * player commits to the second while the first is still holding them, so
     * the second choice is made out of whatever lanes the first left open, and
     * the two guarded rows can between them offer nothing but curses however
     * payable each row is on its own. Measured on level 34 seed 5, where a
     * fence on the left ruled out an `add` and the next fence, decided six
     * metres later, then priced "a curse now and a grower next" against "a
     * grower now and a worse curse next": greedy took the arithmetic it was
     * offered and came out of the pair with 39 units of 65.
     */
    stretchGap: number;
    /**
     * First level the gap above is enforced on. The rule arrived with
     * Milestone 7 Phase B and exempted the twenty levels Milestone 6 had
     * already measured, three of which dealt a stacked pair on one seed in ten.
     * Phase D measured the exemption away — with the gap on everywhere the
     * Milestone 6 bands stay inside their targets on ten seeds — so it is 1,
     * and the only thing still holding walls off the opening is
     * `walls.fromLevel`.
     */
    stretchGapFromLevel: number;
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
    /**
     * The other half of D19's rule, for curses (Milestone 6, Phase C2): a `sub`
     * gate the squad's fire is *not* on grows while the crowd walks up to it,
     * at `perSecond` units a second scaled by the share of the squad's output
     * that is landing somewhere else.
     *
     * It needs no ceiling of its own: a gate is only in play while it is within
     * `projectiles.range` of the squad, which at the run speed is under seven
     * seconds, so the most a curse can put on is `perSecond` times that.
     * `fromLevel` keeps it off the levels D31 calls generous.
     */
    creep: {
      perSecond: number;
      fromLevel: number;
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
    /**
     * Row-kind weights for the two Frostfell kinds (D49). A charger row and a
     * shield row are threat rows like `bruteRows`: no gates, one or two bodies
     * standing in a lane, and the level's own `chargerRows` / `shieldRows`
     * counts say how many of them a level deals. These are what those bodies
     * are *worth* — the same shape as `bruteUnitFrac` above.
     */
    chargerLanes: ValueRange;
    /** A shielded brute carries this share of a plain brute's unit count, so
     *  the shield is time added rather than a second block. */
    shieldUnitFrac: number;
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
     * Rows at the end of a level that carry no gates: the gauntlet the squad
     * walks to the arena with what it has (Phase C2). See `rowKinds.ts` for
     * why `survivors / peak` cannot be tuned without it.
     */
    gauntletRows: number;
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
    /**
     * The screws a milestone level turns (D45), as one shared set of numbers
     * rather than four hand-fitted levels: levels 5, 10, 15 and 20 carry
     * `milestone: true` in `levels.json` and are otherwise built from the same
     * recipe as their neighbours.
     *
     * Every entry but `blockScale` replaces the `gen` dial of the same name on
     * such a level; `blockScale` has no ordinary twin and multiplies the size
     * of every generated block, so 1 there is "unchanged".
     */
    milestone: {
      /** A milestone curse may take this share of the expected squad. */
      curseShare: number;
      /** 1 fills all three lanes, so no row offers a free walk-through. */
      thirdGateChance: number;
      /** How often a milestone row carries two curses rather than one. */
      doubleSubChance: number;
      /** Multiplies generated block sizes. */
      blockScale: number;
    };
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
    /**
     * How far ahead a bot reads a charger that has set off (D49). Past the
     * charger's own `triggerRange`, so a bot sees one the moment it moves.
     */
    chargerLookahead: number;
    /**
     * Share of the squad's raw output a bot assumes actually lands on a
     * charger running at it. Below 1 because the river, the gates and the
     * blocks in the same lane are eating shots too, and a bot that believed
     * its whole output was on the charger would stand in the lane and lose the
     * argument.
     */
    chargerAimShare: number;
    /** The human-like bot the difficulty bands are measured on (D45). */
    human: {
      /**
       * Steps the bot's hand is behind the board. Fifteen at the sim's fixed
       * 1/60 s step is the 250 ms of the plan: long enough that a gate value
       * seen at the last moment is acted on after it, short enough that the
       * player is clearly playing rather than watching.
       */
      reactionSteps: number;
      /**
       * How fast its finger crosses the road, in metres per second. Below the
       * speed the head itself can move, so the limit is the thumb rather than
       * the crowd: a full lane takes about a third of a second to ask for and
       * a little longer than that to arrive.
       */
      swipeSpeed: number;
      /** How often it reads the row right; the rest of the time it takes the
       *  second-best lane. Seven in ten is the plan's "decent player". */
      laneAccuracy: number;
      /**
       * How far ahead of a wall's approach zone it notices the fence, in metres
       * of road. Well inside greedy's `wallCommitDistance`: a player watching
       * their own crowd starts the crossing late, and the units still outside
       * the line when the stretch begins to hold are cut off (D44).
       */
      wallReach: number;
    };
  };
  /** The six evolution mechanics D54 adds, by staff. See `EvolutionBalance`. */
  evolutions: EvolutionBalance;
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
  EvolutionMechanic,
  EvolutionTier,
  FamiliarTier,
  PlayerState,
  Progression,
  ShatterDef,
  StaffTier,
  StaffWorth,
  UpgradeId,
  WispDef,
} from './progression-types';
export { maxStaffTier } from './progression-types';

/**
 * The meta layer Milestone 8 adds (D51 to D53) and Endless (D52), re-exported
 * here for the same reason as everything above: `@/data/types` is the one
 * import site for the schema.
 */
export type {
  CosmeticSlot,
  CosmeticsState,
  EndlessState,
  KillKind,
  LevelBest,
  MissionState,
  MissionsState,
  StreakState,
} from './meta-types';
export type { EndlessConfig, EndlessDial, EndlessMix } from './endless-types';
