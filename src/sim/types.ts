/**
 * Shared sim types. Contract source: docs/03-milestone-1-plan.md.
 *
 * This module is pure data: no Babylon, no DOM, no I/O. Everything here is
 * JSON-serializable so a run can be snapshotted for debugging and replay.
 */

/** Lane index. Lane centers are at `x = lane * laneWidth` (laneWidth = 2). */
export type Lane = -1 | 0 | 1;

export type GateKind = 'mul' | 'add' | 'sub' | 'fireRate';

/** `sub`: value is the penalty, stored as a positive number. */
export interface GateDef {
  kind: GateKind;
  value: number;
}

export interface GateState {
  id: number;
  rowIndex: number;
  lane: -1 | 0 | 1;
  z: number;
  kind: GateKind;
  value: number;
  hits: number;
  passed: boolean;
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
  damage: number;
  /** From `fireRate` gates; the effective rate is `fireRate * (1 + fireRateBonus)`. */
  fireRateBonus: number;
}

export type RunStatus = 'running' | 'won' | 'lost';

export interface RunState {
  levelIndex: number;
  seed: number;
  time: number;
  status: RunStatus;
  squad: SquadState;
  gates: GateState[];
  enemies: EnemyState[];
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
  | { type: 'enemyKilled'; enemyId: number; kind: EnemyKind; x: number; z: number }
  | { type: 'unitsGained'; amount: number; reason: 'gate' }
  | { type: 'unitsLost'; amount: number; reason: 'contact' | 'gate' | 'stomp' }
  | { type: 'bossActivated'; enemyId: number }
  | { type: 'bossStomp'; x: number; z: number }
  | { type: 'bossKilled' }
  | { type: 'runEnded'; status: RunStatus; survivors: number; peakCount: number };
