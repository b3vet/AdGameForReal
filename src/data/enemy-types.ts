/**
 * Schema for the enemy half of `balance.json`: what a body is, what a boss
 * does, and the two kinds Frostfell adds (D49).
 *
 * Split out of `./types.ts` in Milestone 7 for the file-size rule (CLAUDE.md),
 * on the seam that file already had: this is the *bestiary's* numbers, and
 * `./types.ts` is the road, the gates, the generator and the bots. `./types.ts`
 * re-exports every name here, so `@/data/types` is still the one import site.
 */

/**
 * Which boss stands in the arena (D49). Lives here rather than in
 * `src/sim/types.ts`, where the rest of the enemy vocabulary is, because a
 * *level recipe* names it and `src/data` may not import from `src/sim`;
 * `src/sim/types.ts` re-exports it, so the sim still reads one module.
 */
export type BossKind = 'demon' | 'rime';

export interface EnemyBalance {
  /** HP one visual unit of this block is worth; `units = ceil(hp / hpPerUnit)`. */
  hpPerUnit: number;
  speed: number;
  /** Half-width of the block's footprint along `x`, in meters. */
  footprint: number;
}

export interface BossBalance extends EnemyBalance {
  /**
   * How fast the boss walks the squad down, and with it when the fight stops
   * being a ranged trade (Milestone 6, the C2 follow-up).
   *
   * It starts `level.bossOffset` metres up the arena and stops at
   * `enemies.contactDistance`, so the seconds to contact are
   * `(bossOffset - contactDistance) / speed`: at 22 m, 1.2 m and 1.75 m/s that
   * is 11.9 s, about half of the 24 second fight the campaign is sized for.
   *
   * It used to be 0.55, which is 37.8 s — longer than any fight that is going
   * to be won — so `contactShare` below never fired at all and the whole of a
   * run's attrition was stomps. That is what made the share of the crowd that
   * walks away and the share of runs that are won the same number read two
   * ways: both were `1 - e^{-kT}` for the one decay the fight had.
   */
  speed: number;
  stompInterval: number;
  stompRange: number;
  /** Floor on the units one stomp removes, whatever the squad size. */
  stompKills: number;
  /** Share of the squad one stomp removes, above that floor. */
  stompShare: number;
  /**
   * Share of the squad standing in contact that dies every second.
   *
   * Live since the C2 follow-up (see `speed`). It is the unit sink the road did
   * not have: a fight that runs past the boss's arrival costs the crowd whether
   * or not it is eventually won, so what walks away can be pulled down without
   * pulling the clear rate down with it.
   */
  contactShare: number;
  /** Fraction of max HP at which the boss enrages. */
  enrageAt: number;
  /** Stomp interval once enraged. */
  enrageStompInterval: number;
  /** Walk speed multiplier once enraged. */
  enrageSpeedMul: number;
  /** How fast the boss slides sideways to line itself up with the squad. */
  lateralSpeed: number;
  /**
   * How deep in front of itself the boss pushes the crowd (D43's shove, Phase
   * C2). Its own `crowd.shove.reach` rather than the shared one because the
   * boss never gets within a body's length of the column: it starts
   * `level.bossOffset` away and closes at half a metre a second, so a fight it
   * loses ends with it still ten metres out. This is the depth of the push
   * field instead — the crowd starts to bow at about the range the boss can
   * stomp from, and leans harder the closer the thing gets.
   */
  shoveReach: number;
  /**
   * The Rime Fiend's lane charge (D49), on the boss block rather than beside it
   * because it is one boss's extra move and every other number it uses — the
   * stomp, the enrage, the contact grind — is the shared boss block above.
   * Read only when a level names `boss.kind: 'rime'`.
   */
  rime: RimeBalance;
}

/**
 * The Rime Fiend's charge: it picks the lane the column is standing in, runs
 * down it through the crowd, and walks back to where it stood (D49).
 *
 * What it costs is decided by where the body goes, not by a share of the crowd
 * (document 29): whoever is standing inside its footprint while it runs in is
 * under it and dies, up to the cap, and a column that has left the lane before
 * it arrives loses nobody.
 */
export interface RimeBalance {
  charge: {
    /** Seconds between charges, measured from the end of the last one. */
    interval: number;
    /** How fast it comes down the lane. Well above its walking speed. */
    speed: number;
    /** Metres past the column's front it runs before turning round. */
    depth: number;
    /**
     * Seconds between committing to a lane and setting off down it. The
     * commitment is the tell (the roar, the kick, the slide into the lane), and
     * this is the time a thumb has to answer it: without it a charge from
     * contact distance lands a tenth of a second after it is announced.
     */
    windup: number;
    /**
     * Half the width of the road the body kills on, either side of its centre.
     * Inside half a lane, so a column standing in the next lane is a column it
     * runs past.
     */
    hitHalfWidth: number;
    /** How far in front of and behind its centre the body kills, in metres. */
    hitReach: number;
    /**
     * The most one charge may kill: this share of the crowd it set off
     * against, and never less than `killFloor` soldiers. Fewer die when fewer
     * are standing in its way.
     */
    killShare: number;
    killFloor: number;
    /** How fast it walks back to the spot it charged from. */
    returnSpeed: number;
    /** How fast it slides into the lane it has picked, in m/s. */
    lateralSpeed: number;
    /** Its shove field while charging: deeper and harder than its standing one. */
    shoveReach: number;
    shoveStrength: number;
    /**
     * Whether a charge may start once the boss is enraged. False as shipped:
     * an enraged Rime Fiend already stomps on the short clock, and a charge on
     * top of that is a wipe rather than a fight (D49's "the stomp stays").
     */
    whileEnraged: boolean;
  };
}

/**
 * The charger (D49): a fast single body that stands in a lane, waits for the
 * column, then runs it down. Small enough to be shot out of the air, heavy
 * enough that walking into one costs a bite of the crowd.
 */
export interface ChargerBalance extends EnemyBalance {
  /** Metres of `z` between the column and a charger at which it sets off. */
  triggerRange: number;
  /** How fast it slides into the lane it has picked, in m/s. */
  lateralSpeed: number;
  /**
   * How many lanes it will shift to reach the column: 0 runs its own lane
   * whatever happens, 1 lets a charger one lane over come at you. That is the
   * whole mechanic — a charger in the column's lane is something to shoot, one
   * two lanes away is something to steer around.
   */
  lanePick: number;
  /** Metres of `z` its shove reaches beyond its own footprint. */
  shoveReach: number;
  /** Multiplier on `crowd.shove` while it is running. */
  shoveStrength: number;
  /** Floor on the units one charger takes on contact, whatever the squad size. */
  kills: number;
  /** Share of the crowd it takes instead, when that is more. */
  killShare: number;
  /** Units a charger block is worth, as a share of a grunt block's. */
  unitFrac: number;
}

/** The shielded brute (D49): a brute whose number will not fall until its
 *  shield is broken. */
export interface ShieldBalance {
  /** Shield hit points as a share of the body's own. */
  share: number;
  /**
   * What a hit is worth against the shield. Below 1, so the shield is slower
   * to break than the same hit points of body would be: that is the whole of
   * the kind — a wall of time rather than a wall of numbers.
   */
  damageMul: number;
}

/**
 * A portal (document 31, 3.2): a fixed point on the road a river pours from.
 * Where it stands, when it opens and how long it pours are the beat's; these
 * are the rules every portal shares.
 */
export interface PortalBalance {
  /** The pour stops once the squad is this close to the portal, in metres. */
  stopGap: number;
  /**
   * A body with less fire window than this between the moment it can be shot
   * and the moment it reaches the column is counted as the river's toll: what
   * a squad standing in the lane is expected to pay (`portalWindow`'s
   * `tollShare` in `src/sim/pressure.ts`).
   */
  tollSeconds: number;
  /** Fewest bodies a portal pours, however small the squad it is sized for. */
  minBodies: number;
  /**
   * Most bodies one beat's rivers pour between them. A beat that asks for more
   * pours this many, each tougher, so the pressure is kept and the peak of live
   * bodies stays inside the plan's 180 (4.7).
   */
  maxBodiesPerBeat: number;
  /**
   * Most bodies the rivers of a whole road may have on it at once, counted as
   * if nothing were shot: two beats' portals can pour into the same stretch,
   * and a river the column dodges walks the whole road. Held under the plan's
   * 180 with room left for the blocks.
   */
  maxLiveBodies: number;
}

/**
 * What a block a beat stands is worth where it differs from a dealt one
 * (document 31, 3.4). A per-body number rather than a change to the kind's own
 * block, so the endless road and the dealt fixtures keep the numbers they were
 * tuned on while the scripted roads are tuned in the beat lab.
 */
export interface BeatEnemyBalance {
  /**
   * Hit points per printed unit of a brute or shielded brute. Lower than a
   * dealt brute's, so a block that takes three seconds to clear prints what it
   * would take on contact.
   */
  bruteHpPerUnit: number;
  /** Share of the column a scripted charger takes on contact, above its floor. */
  chargerKillShare: number;
}
