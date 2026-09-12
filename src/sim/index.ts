/**
 * Public surface of the sim. Render, core and UI import from `@/sim` only —
 * never from a file inside it — so the internals can be restructured freely.
 */

export { Run } from './Run';
export {
  addValueAt,
  generateLevel,
  laneCenter,
  laneOf,
  rowOffersGrowth,
  squadCurve,
  BOSS_Z_OFFSET,
  FIRE_RATE_GATE_WORTH,
} from './level';
export type { LevelDef, RowDef, RowEnemyDef, LevelGenConfig } from './level';
export { formationOffsets, halfWidth, unitSpacing } from './formation';
export { enemyBalance, enemyFootprint, enemyHalfWidth } from './enemies';
export { effectiveSpeed, overlapShare } from './contact';
export { stompKills } from './boss';
export { applyGateGrowth, clampCount, countAfterGate, gateCap, isShootable } from './gates';
export { blockGap, expectedDps, startWeapon, weaponDef, weaponIds, weaponOf } from './weapons';
export {
  dpsPerUnit,
  expectedStreamDps,
  laneShareOf,
  sizeStream,
  streamPressure,
  streamWindow,
} from './pressure';
export type { StreamShape } from './pressure';
export type { FormationOffset } from './formation';
export { createBot } from './bots';
export type { BotKind } from './bots';
export { mulberry32, randomInt, randomRange, weightedIndex } from './rng';
export type { Rng } from './rng';
export type {
  EnemyKind,
  EnemyState,
  GateDef,
  GateKind,
  GateState,
  Lane,
  ProjectileState,
  RunState,
  RunStatus,
  SimEvent,
  SquadState,
  StreamDef,
  StreamState,
  UnitLossReason,
  WeaponId,
} from './types';
