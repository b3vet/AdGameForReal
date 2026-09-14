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
export type { BossId, LevelDef, RowDef, RowEnemyDef, LevelGenConfig } from './level';
/**
 * The meta layer (D33, D35). The app owns a `PlayerState` and spends into it;
 * everything it needs to price a purchase and to pay a run out is here, so no
 * screen has to reach into `src/data/progression.json` itself.
 */
export {
  addCoins,
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  clonePlayer,
  emptyPlayer,
  evolutionOf,
  familiarCost,
  familiarPrice,
  familiarUnlocked,
  maxFamiliarTier,
  maxUpgradeLevel,
  nextUpgradeCost,
  playerMods,
  progression,
  roomOpen,
  roomUnlockLevel,
  runRewards,
  selectStaff,
  staffCost,
  staffPrices,
  upgradeCost,
  upgradeCostFor,
  upgradeIds,
  upgradeLevel,
  NO_MODS,
} from './player';
export type { PlayerMods } from './player';
export type {
  BiomeId,
  BossKind,
  FamiliarTier,
  PlayerState,
  Progression,
  StaffTier,
  UpgradeId,
} from '@/data/types';
/** Lane walls (D32): the fence the squad cannot cross. */
export { clampToWalls, generateWalls, wallAhead, wallHolds, wallLimits, wallX } from './walls';
export type { WallBoundary, WallDef, WallLimits } from './walls';
export {
  availableWidth,
  clampLimit,
  formationColumns,
  formationDepth,
  formationOffsets,
  formationRows,
  halfExtent,
  halfWidth,
  openRoadWidth,
  unitSpacing,
  wallKeep,
} from './formation';
export type { FormationOffset } from './formation';
export {
  activationRange,
  effectiveUnits,
  enemyBalance,
  enemyFootprint,
  enemyHalfWidth,
} from './enemies';
/** The two Frostfell kinds and boss 2's charge (D49), for the views that draw
 *  them: what a charger's lane pick is, what a shield is worth, what a charge
 *  costs. Render reads the state; these are the rules behind it. */
export { chargeLane, chargerKills } from './chargers';
export { shieldFor } from './shields';
/**
 * The crowd (D43, D44). Render draws `state.crowd` directly and reads the flag
 * bits for its animations; `createCrowdState` is for a caller that builds a
 * `RunState` by hand and wants the field to exist.
 */
export { createCrowdState } from './crowdState';
export {
  CROWD_JUST_SPAWNED,
  CROWD_ON_FENCE,
  CROWD_REJOINING,
  CROWD_SHOVED,
} from './types';
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
export { createBot } from './bots';
export type { BotKind } from './bots';
export { mulberry32, randomInt, randomRange, weightedIndex } from './rng';
export type { Rng } from './rng';
export type {
  CrowdState,
  EnemyKind,
  EnemyState,
  FamiliarState,
  GateDef,
  GateKind,
  GateState,
  GroupState,
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
