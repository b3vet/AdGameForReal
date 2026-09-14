/**
 * Shared sim types. Contract source: docs/03-milestone-1-plan.md, extended by
 * docs/06-milestone-2-plan.md (weapons, staff gates, boss enrage).
 *
 * This module is pure data: no Babylon, no DOM, no I/O. Everything here is
 * JSON-serializable so a run can be snapshotted for debugging and replay.
 */

import type { WallDef } from './walls';
import type { BiomeId, BossKind, FamiliarTier, WeaponId } from '@/data/types';

export type { BiomeId, BossKind, WeaponId };
export type { WallDef, WallBoundary } from './walls';

/** Lane index. Lane centers are at `x = lane * laneWidth` (laneWidth = 2). */
export type Lane = -1 | 0 | 1;

export type GateKind = 'mul' | 'add' | 'sub' | 'fireRate' | 'weapon';

/** `sub`: value is the penalty, stored as a positive number. */
export interface GateDef {
  kind: GateKind;
  value: number;
  /**
   * Ceiling on what shooting this gate can raise it to: units for `add` and
   * `sub` (after it flips), the fire-rate bonus for `fireRate`. The generator
   * writes it from the gate's own printed value (see `gateCap`); omitted on
   * hand-made gates, which derive the same ceiling on the fly.
   */
  cap?: number;
  /** Set on `weapon` gates: the staff the squad leaves the row carrying. */
  weaponId?: WeaponId;
}

export interface GateState {
  id: number;
  rowIndex: number;
  lane: -1 | 0 | 1;
  z: number;
  kind: GateKind;
  /** A float: growth is rate-based, and rounding for display is render's job. */
  value: number;
  hits: number;
  passed: boolean;
  /** See `GateDef.cap`. Undefined means "derive it from the printed value". */
  cap?: number;
  /** See `GateDef.weaponId`. */
  weaponId?: WeaponId;
}

/**
 * What is standing on the road (D49 added `charger` and `shieldBrute`).
 *
 * A `shieldBrute` is a brute in every way the arithmetic cares about — its
 * hp per unit, its speed and its footprint all come from `enemies.brute` — and
 * differs only by carrying a `shield` the fire has to break first. A `charger`
 * has a block of its own in `enemies.charger`.
 */
export type EnemyKind = 'grunt' | 'brute' | 'charger' | 'shieldBrute' | 'boss';

export interface EnemyState {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  /** `ceil(hp / hpPerUnit)` — the visual block count shown on the label. */
  units: number;
  speed: number;
  active: boolean;
  alive: boolean;
  /**
   * Sim time until which a frost hit keeps this block at `slow.factor` speed.
   * Optional so the M1 render fixtures, which build `EnemyState` by hand,
   * still typecheck; the sim always writes it.
   */
  slowUntil?: number;
  /** Speed multiplier while `slowUntil` holds, from the staff that applied it. */
  slowFactor?: number;
  /** Boss only: past `enrageAt` of its HP it stomps faster and walks faster. */
  enraged?: boolean;
  /**
   * Set on an enemy that belongs to a stream (Milestone 3). A stream enemy is
   * one body with `units: 1` and its own HP; a block has no `streamId` at all.
   */
  streamId?: number;
  /**
   * Sim time this enemy died, so the array can keep a corpse around long enough
   * for render to play its death before it is compacted away.
   */
  diedAt?: number;
  /**
   * Ember's evolution (D33). Sim time the burn stops, what one tick costs, and
   * when the next tick is due. A second hit refreshes the clock and takes the
   * bigger tick rather than adding a second burn, so a river cannot be set on
   * fire twice over. Optional like `slowUntil`: hand-made states predate it.
   */
  burnUntil?: number;
  burnPerTick?: number;
  burnNextAt?: number;
  /** In the burn list right now, so a refresh does not file it twice. */
  burning?: boolean;
  /**
   * Shielded brute (D49): hit points left on the shield. While it is above
   * zero every hit is worth `enemies.shield.damageMul` of itself and is taken
   * from here rather than from `hp`, so the block's printed number does not
   * move until the shield breaks. Absent or zero means no shield.
   */
  shield?: number;
  /**
   * Bosses only: which boss this is (D49). Absent means `demon`, so the render
   * fixtures and the stress scene, which build an `EnemyState` by hand, are
   * still boss 1.
   */
  variant?: BossKind;
  /**
   * Set while a charger or the Rime Fiend is running a lane down (D49).
   * `lane` is the lane it has committed to and `until` is the sim time it
   * expects to have finished the run in — render's clock for the animation,
   * not a rule the sim enforces.
   */
  charge?: { until: number; lane: Lane };
}

/**
 * A river of single enemies pouring down one lane (D29).
 *
 * `count` bodies of `hpPerEnemy` each spawn evenly over `durationSeconds`, at
 * `balance.streams.spawnAhead` metres in front of the squad so the stream keeps
 * coming however fast the squad runs, and walk toward the squad at `speed` with
 * up to `jitter` metres of lateral scatter around the lane centre.
 */
export interface StreamDef {
  lane: Lane;
  kind: 'grunt';
  count: number;
  durationSeconds: number;
  hpPerEnemy: number;
  speed: number;
  jitter: number;
}

/** The live half of a `StreamDef`. Render reads `headZ` to float the count. */
export interface StreamState {
  id: number;
  lane: Lane;
  /** Where the row that carries the stream stands; the trigger, not the spawn. */
  z: number;
  /** What the stream was built to send. */
  count: number;
  /** Still to come: unspawned plus live. Zero when the stream is done. */
  remaining: number;
  spawned: number;
  /** Live right now. */
  alive: number;
  killed: number;
  /** Reached the squad; each one cost a unit. */
  leaked: number;
  /** The nearest live enemy's `z` — where the floating count rides. */
  headZ: number;
  started: boolean;
  done: boolean;
}

export interface ProjectileState {
  id: number;
  x: number;
  z: number;
  alive: boolean;
}

export interface SquadState {
  count: number;
  x: number;
  targetX: number;
  z: number;
  fireRate: number;
  /** `balance.squad.damage` scaled by the staff in hand. */
  damage: number;
  /** From `fireRate` gates; the effective rate is `fireRate * (1 + fireRateBonus)`. */
  fireRateBonus: number;
  /** The staff in hand. Optional for the same reason as `EnemyState.slowUntil`. */
  weaponId?: WeaponId;
  /**
   * Lateral velocity in m/s: the state of the damped spring `x` follows
   * `targetX` through (D37). Render reads it for the crowd's lean.
   *
   * Optional like `weaponId`, because render's dev fixtures and the stress
   * scene build a squad by hand; `Run` always writes it.
   */
  vx?: number;
  /**
   * How wide a band of road the formation was built for this step
   * (`availableWidth`): the full road between walls, narrower inside one.
   * Everything that asks for the crowd's width or its offsets passes it, so the
   * sim, the bots and render all read the same crowd. Optional, like `vx`.
   */
  formationWidth?: number;
}

/**
 * The wisp (D33), when the player owns one. It hovers beside the squad at a
 * fixed offset and fires on its own clock; `side` is which shoulder it sits on,
 * flipped only when the squad hugs the edge of the road so it never floats over
 * the grass.
 */
export interface FamiliarState {
  x: number;
  z: number;
  tier: FamiliarTier;
  /** Seconds until the next spark. */
  cooldown: number;
  side: -1 | 1;
}

/* ------------------------------------------------------------------ */
/* The crowd (D43, D44)                                                */
/* ------------------------------------------------------------------ */

/**
 * `CrowdState.flags`, one bit each, cleared and rewritten every step. Render
 * reads them to pick an animation; the sim reads `REJOINING` to give a
 * straggler its catch-up speed.
 */
export const CROWD_SHOVED = 1;
export const CROWD_ON_FENCE = 2;
export const CROWD_JUST_SPAWNED = 4;
export const CROWD_REJOINING = 8;

/** Structure-of-arrays, capacity `squad.maxCount`, never compacted: a unit
 *  keeps its index for its whole life so render instances never swap. */
export interface CrowdState {
  capacity: number;
  /** 1 while the unit is alive; 0 frees the index for the next spawn. */
  alive: Uint8Array;
  x: Float64Array;
  z: Float64Array;
  vx: Float64Array;
  vz: Float64Array;
  /** 0 is the main column; n > 0 is straggler group n. */
  group: Uint8Array;
  /** The unit's slot in its group's formation (row-major, front first). */
  slot: Uint16Array;
  /** Bit flags this step: SHOVED 1, ON_FENCE 2, JUST_SPAWNED 4, REJOINING 8. */
  flags: Uint8Array;
}

export interface GroupState {
  id: number;
  count: number;
  /** The leader the group's slots hang from. Group 0's leader is the finger. */
  leaderX: number;
  z: number;
  /** The lane the group is confined to while a wall holds it, else null. */
  lane: Lane | null;
  /** Sim time the confining wall releases the group, else 0. */
  rejoinAt: number;
}

export type RunStatus = 'running' | 'won' | 'lost';

/** `leak` is new in Milestone 3: one stream enemy walked into the squad. */
export type UnitLossReason = 'contact' | 'gate' | 'stomp' | 'leak';

export interface RunState {
  levelIndex: number;
  seed: number;
  time: number;
  status: RunStatus;
  squad: SquadState;
  gates: GateState[];
  enemies: EnemyState[];
  streams: StreamState[];
  projectiles: ProjectileState[];
  boss: EnemyState | null;
  peakCount: number;
  survivors: number;
  /** Where the squad stops advancing to fight the boss. */
  arenaZ: number;
  /**
   * Null unless the player owns a wisp (D33).
   *
   * Optional as well as nullable, like `SquadState.weaponId`: render and the
   * stress scene build `RunState` objects by hand and predate the wisp. `Run`
   * always writes it.
   */
  familiar?: FamiliarState | null;
  /**
   * The level's walls (D32), copied here so anything that only ever sees a
   * `RunState` — the bots, the debug panel — can read them without the level.
   * Optional for the same reason as `familiar`; `Run` always writes it.
   */
  walls?: readonly WallDef[];
  /**
   * Every unit as an agent (D43), and the groups their slots hang from —
   * index 0 is the main column, the rest are straggler groups (D44). The
   * groups array has a fixed length (`crowd.groupCap`); a straggler group is
   * live exactly while its `count` is above zero.
   *
   * `squad.count` stays the total alive across groups and the sim maintains
   * it, so the plaque, the gates, the balance model and the bots read as
   * before.
   *
   * Optional, like `familiar` and `walls`, and for the same reason: render's
   * dev fixture and the stress scene build a `RunState` by hand and have no
   * crowd to put in one. `Run` always writes both.
   */
  crowd?: CrowdState;
  groups?: GroupState[];
}

/** Returned by `Run.tick`, consumed by render and UI, then discarded. */
export type SimEvent =
  | { type: 'projectileFired'; x: number; z: number }
  | { type: 'projectileHit'; weaponId: WeaponId; x: number; z: number }
  | { type: 'gateHit'; gateId: number; kind: GateKind; value: number }
  | {
      type: 'gatePassed';
      gateId: number;
      kind: GateKind;
      value: number;
      countBefore: number;
      countAfter: number;
    }
  | { type: 'enemyActivated'; enemyId: number }
  | { type: 'enemyHit'; enemyId: number; damage: number; hp: number; x: number; z: number }
  | {
      type: 'enemyKilled';
      enemyId: number;
      kind: EnemyKind;
      x: number;
      z: number;
      /** Set when this body belonged to a stream; absent for a block or the boss. */
      streamId?: number;
    }
  | { type: 'enemyLeaked'; enemyId: number; streamId: number; x: number; z: number }
  | { type: 'streamStarted'; streamId: number; lane: Lane; count: number }
  | { type: 'streamCleared'; streamId: number; lane: Lane; leaked: number }
  | {
      type: 'enemyShattered';
      enemyId: number;
      x: number;
      z: number;
      /**
       * Set when this body belonged to a stream, exactly as on `enemyKilled`.
       * A stream is hundreds of single bodies (D29) and the physics layer
       * throws no debris for them, so it has to be able to tell one apart from
       * a block without holding the kill event that came just before.
       */
      streamId?: number;
    }
  | { type: 'enemySlowed'; enemyId: number; seconds: number }
  /** A shielded brute's shield reached zero. Fires once per body (D49). */
  | { type: 'shieldBreak'; enemyId: number; x: number; z: number }
  /**
   * A charger set off, or the Rime Fiend started a charge (D49). `kind` is
   * which of the two, since they look and sound nothing like each other.
   */
  | { type: 'charge'; enemyId: number; kind: EnemyKind; lane: Lane }
  /**
   * A body was set alight by an evolved ember staff. Emitted when the burn
   * *starts*, not on every tick: a tick is four a second on every burning body
   * and a river is hundreds of them, so the ticks are ordinary `enemyHit`s and
   * this is the one render needs to attach a flame for `seconds`.
   */
  | { type: 'enemyBurning'; enemyId: number; x: number; z: number; seconds: number }
  | { type: 'familiarShot'; x: number; z: number; targetId: number }
  /** The wall clamp pushed the squad this step; `boundary` is which side. */
  | { type: 'wallBlocked'; boundary: -1 | 1; x: number; z: number }
  | { type: 'splash'; x: number; z: number; radius: number }
  | { type: 'chain'; from: number; to: number }
  | { type: 'weaponChanged'; from: WeaponId; to: WeaponId }
  | { type: 'unitsGained'; amount: number; reason: 'gate' }
  | { type: 'unitsLost'; amount: number; reason: UnitLossReason }
  | { type: 'bossActivated'; enemyId: number }
  | { type: 'bossStomp'; x: number; z: number }
  | { type: 'bossEnraged'; enemyId: number }
  | { type: 'bossKilled' }
  | { type: 'runEnded'; status: RunStatus; survivors: number; peakCount: number };
