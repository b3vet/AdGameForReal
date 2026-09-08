/**
 * Public surface of the sim. Render, core and UI import from `@/sim` only —
 * never from a file inside it — so Phase B1 can restructure internals freely.
 */

export { Run } from './Run';
export { generateLevel, laneCenter, squadCurve, BOSS_Z_OFFSET, FIRE_RATE_GATE_WORTH } from './level';
export type { LevelDef, RowDef, RowEnemyDef, LevelGenConfig } from './level';
export { formationOffsets, halfWidth } from './formation';
export { enemyBalance, enemyFootprint } from './enemies';
export { applyGateHits, clampCount, countAfterGate, isShootable } from './gates';
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
} from './types';
