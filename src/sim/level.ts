/**
 * Level generation. STUB for Phase A: emits a trivially valid `LevelDef` with
 * a few rows so the renderer and app have real geometry to build against.
 * Phase B1 replaces the body with the weighted row generator described in
 * docs/03-milestone-1-plan.md and tunes `levels.json` until the balance tests pass.
 */

import { mulberry32, randomInt } from './rng';
import type { EnemyKind, GateDef, Lane } from './types';
import type { LevelGenConfig } from '@/data/types';

export type { LevelGenConfig };

export interface RowEnemyDef {
  kind: EnemyKind;
  lane: Lane;
  units: number;
}

export interface RowDef {
  z: number;
  /** One slot per lane, in lane order `-1, 0, +1`. `null` means no gate there. */
  gates: [GateDef | null, GateDef | null, GateDef | null];
  enemies: RowEnemyDef[];
}

export interface LevelDef {
  index: number;
  seed: number;
  runSpeed: number;
  startCount: number;
  rows: RowDef[];
  /** Where the squad stops advancing to fight the boss. */
  arenaZ: number;
  boss: { hp: number; units: number };
}

/** Kept in sync with `balance.json`; Phase B1 threads the real `Balance` through. */
const ROW_SPACING = 18;
const BOSS_OFFSET = 22;
const FIRST_ROW_Z = 24;
const BOSS_HP_PER_UNIT = 10;
const RUN_SPEED = 5;

/**
 * Deterministic: the same `index`, `config` and `seed` always produce the same
 * level. `seed` defaults to the config's own seed so callers can omit it.
 */
export function generateLevel(index: number, config: LevelGenConfig, seed?: number): LevelDef {
  const resolvedSeed = seed ?? config.seed;
  const rng = mulberry32(resolvedSeed);
  const rowCount = Math.max(1, Math.floor(config.rows));

  const rows: RowDef[] = [];
  for (let i = 0; i < rowCount; i++) {
    const z = FIRST_ROW_Z + i * ROW_SPACING;

    // Placeholder shape: alternating gate rows and enemy rows. Enough structure
    // for render and app work; not balanced, and not the final generator.
    if (i % 2 === 0) {
      rows.push({
        z,
        gates: [
          { kind: 'add', value: randomInt(rng, config.gateValues.add.min, config.gateValues.add.max) },
          { kind: 'mul', value: config.gateValues.mul.min },
          { kind: 'sub', value: randomInt(rng, config.gateValues.sub.min, config.gateValues.sub.max) },
        ],
        enemies: [],
      });
    } else {
      rows.push({
        z,
        gates: [null, null, null],
        enemies: [
          { kind: 'grunt', lane: 0, units: Math.max(1, Math.round(3 * config.hpScale)) },
        ],
      });
    }
  }

  const lastRow = rows[rows.length - 1];
  const arenaZ = (lastRow?.z ?? FIRST_ROW_Z) + ROW_SPACING;

  return {
    index,
    seed: resolvedSeed,
    runSpeed: RUN_SPEED,
    startCount: config.startCount,
    rows,
    arenaZ,
    boss: {
      hp: config.boss.hp,
      units: Math.max(1, Math.ceil(config.boss.hp / BOSS_HP_PER_UNIT)),
    },
  };
}

/** Lane centre in meters. `laneWidth` is 2, so lanes sit at `x = -2, 0, +2`. */
export function laneCenter(lane: Lane, laneWidth = 2): number {
  return lane * laneWidth;
}

export const BOSS_Z_OFFSET = BOSS_OFFSET;
