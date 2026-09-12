/**
 * Builders for hand-made levels. Tests that check one rule at a time need a
 * level with exactly that rule in it, not a generated one.
 */

import type { LevelDef, RowDef, RowEnemyDef } from '../level';
import { emptyPlayer } from '../player';
import { Run } from '../Run';
import type { GateDef, SimEvent, WallDef, WeaponId } from '../types';
import { balance } from '@/data';
import type { Balance, FamiliarTier, PlayerState, StaffTier, UpgradeId } from '@/data/types';

/** A private copy of the tuning data, so a test can bend physics safely. */
export function testBalance(): Balance {
  return structuredClone(balance);
}

export function row(
  z: number,
  gates: [GateDef | null, GateDef | null, GateDef | null],
  enemies: RowEnemyDef[] = [],
): RowDef {
  return { z, gates, enemies };
}

/** A staff gate in the middle lane, close enough to be taken immediately. */
export function staffRow(z: number, weaponId: WeaponId): RowDef {
  return row(z, [null, { kind: 'weapon', value: 0, cap: 0, weaponId }, null]);
}

export function level(overrides: Partial<LevelDef> = {}): LevelDef {
  return {
    index: 1,
    seed: 1,
    runSpeed: balance.squad.runSpeed,
    startCount: 10,
    rows: [],
    arenaZ: 1000,
    bossId: 'demon',
    walls: [],
    boss: { hp: 1_000_000, units: 100_000 },
    ...overrides,
  };
}

/** A wall on one boundary, for the clamp tests. */
export function wall(boundary: -1 | 1, zStart: number, zEnd: number): WallDef {
  return { boundary, zStart, zEnd };
}

/**
 * Steps a run for `seconds` and returns copies of every event, because the sim
 * re-uses its event objects between ticks.
 */
export function play(run: Run, seconds: number, targetX?: number): SimEvent[] {
  const collected: SimEvent[] = [];
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) {
    if (targetX !== undefined) run.setTargetX(targetX);
    for (const event of run.tick(1 / 60)) collected.push({ ...event });
  }
  return collected;
}

export function runOf(levelDef: LevelDef, balanceOverride?: Balance): Run {
  return new Run(levelDef, balanceOverride ?? testBalance());
}

/**
 * Runs `body` with staff gates turned on in the generator.
 *
 * `level.ts` reads the shared tuning object rather than taking one as an
 * argument, so this flips the real dial and puts it back. Phase C turns it on
 * for good, once render can draw a staff panel.
 */
export function withWeaponGates<T>(body: () => T): T {
  const before = balance.gen.weaponGatesEnabled;
  balance.gen.weaponGatesEnabled = true;
  try {
    return body();
  } finally {
    balance.gen.weaponGatesEnabled = before;
  }
}

/** A player with one upgrade bought to `level` and nothing else. */
export function withUpgrade(id: UpgradeId, level: number): PlayerState {
  const player = emptyPlayer();
  player.upgrades[id] = level;
  return player;
}

/** A player holding `id` at `tier`, with it selected. */
export function withStaff(id: WeaponId, tier: StaffTier): PlayerState {
  const player = emptyPlayer();
  player.staffs[id] = { unlocked: true, tier };
  player.selectedStaff = id;
  return player;
}

/** A player who owns the wisp at `tier`. */
export function withFamiliar(tier: FamiliarTier): PlayerState {
  const player = emptyPlayer();
  player.familiar = { unlocked: tier > 0, tier };
  return player;
}
