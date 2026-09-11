/**
 * Shared sim types. Contract source: docs/03-milestone-1-plan.md, extended by
 * docs/06-milestone-2-plan.md (weapons, staff gates, boss enrage).
 *
 * This module is pure data: no Babylon, no DOM, no I/O. Everything here is
 * JSON-serializable so a run can be snapshotted for debugging and replay.
 */

import type { WeaponId } from '@/data/types';

export type { WeaponId };

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

export type EnemyKind = 'grunt' | 'brute' | 'boss';

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
  | { type: 'enemyShattered'; enemyId: number; x: number; z: number }
  | { type: 'enemySlowed'; enemyId: number; seconds: number }
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
