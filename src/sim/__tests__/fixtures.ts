/**
 * Builders for hand-made levels. Tests that check one rule at a time need a
 * level with exactly that rule in it, not a generated one.
 */

import type { LevelDef, RowDef, RowEnemyDef } from '../level';
import { Run } from '../Run';
import type { GateDef, SimEvent } from '../types';
import { balance } from '@/data';
import type { Balance } from '@/data/types';

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

export function level(overrides: Partial<LevelDef> = {}): LevelDef {
  return {
    index: 1,
    seed: 1,
    runSpeed: balance.squad.runSpeed,
    startCount: 10,
    rows: [],
    arenaZ: 1000,
    boss: { hp: 1_000_000, units: 100_000 },
    ...overrides,
  };
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
