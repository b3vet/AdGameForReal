import { describe, expect, it } from 'vitest';

import { generateLevel, laneCenter, squadCurve, BOSS_Z_OFFSET } from '../level';
import type { LevelDef } from '../level';
import type { GateDef } from '../types';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/** Closer than this and a block's HP label prints over a gate's number. */
const MIN_GATE_ENEMY_GAP = 4;

function everyLevel(fn: (level: LevelDef, index: number, seed: number) => void): void {
  for (let index = 1; index <= levelCount; index++) {
    for (const seed of SEEDS) {
      fn(generateLevel(index, levelConfig(index), seed), index, seed);
    }
  }
}

function gatesOf(level: LevelDef): GateDef[] {
  return level.rows.flatMap((row) => row.gates.filter((g): g is GateDef => g !== null));
}

describe('generateLevel', () => {
  it('is deterministic: the same seed replays the same level', () => {
    for (let index = 1; index <= levelCount; index++) {
      const a = generateLevel(index, levelConfig(index), 7);
      const b = generateLevel(index, levelConfig(index), 7);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });

  it('produces different levels for different seeds', () => {
    const a = generateLevel(5, levelConfig(5), 1);
    const b = generateLevel(5, levelConfig(5), 2);
    expect(JSON.stringify(b)).not.toBe(JSON.stringify(a));
  });

  it("falls back to the config's own seed", () => {
    const config = levelConfig(3);
    expect(JSON.stringify(generateLevel(3, config))).toBe(
      JSON.stringify(generateLevel(3, config, config.seed)),
    );
  });

  it('spaces rows evenly from the first row spacing onward', () => {
    everyLevel((level) => {
      expect(level.rows).toHaveLength(levelConfig(level.index).rows);
      level.rows.forEach((row, i) => {
        expect(row.z).toBeCloseTo(balance.level.rowSpacing * (i + 1), 9);
      });
    });
  });

  it('puts the arena past the last row and the boss past the arena', () => {
    everyLevel((level) => {
      const last = level.rows[level.rows.length - 1];
      expect(level.arenaZ).toBeCloseTo((last?.z ?? 0) + balance.level.rowSpacing, 9);
      expect(BOSS_Z_OFFSET).toBe(balance.level.bossOffset);
      expect(level.boss.units).toBe(Math.ceil(level.boss.hp / balance.enemies.boss.hpPerUnit));
    });
  });

  it('never puts two mul gates or an all-negative choice on one row', () => {
    everyLevel((level) => {
      for (const row of level.rows) {
        const gates = row.gates.filter((g): g is GateDef => g !== null);
        if (gates.length === 0) continue;
        expect(gates.filter((g) => g.kind === 'mul').length).toBeLessThanOrEqual(1);
        // An empty lane is itself a non-negative choice, so only a full row of
        // three gates can trap the player.
        if (gates.length === 3) {
          expect(gates.some((g) => g.kind !== 'sub')).toBe(true);
        }
      }
    });
  });

  it('keeps level 1 free of penalties and introduces them from level 2', () => {
    for (const seed of SEEDS) {
      const first = generateLevel(1, levelConfig(1), seed);
      expect(gatesOf(first).some((g) => g.kind === 'sub')).toBe(false);
    }
    const laterHasSub = SEEDS.some((seed) =>
      gatesOf(generateLevel(2, levelConfig(2), seed)).some((g) => g.kind === 'sub'),
    );
    expect(laterHasSub).toBe(true);
  });

  it('opens every level with a plain gate row, and gives every row something', () => {
    everyLevel((level) => {
      const first = level.rows[0];
      expect(first?.enemies).toHaveLength(0);
      expect(first?.gates.some((g) => g !== null)).toBe(true);
      for (const row of level.rows) {
        expect(row.gates.some((g) => g !== null) || row.enemies.length > 0).toBe(true);
        expect(row.enemies.length).toBeLessThanOrEqual(3);
        for (const enemy of row.enemies) expect(enemy.units).toBeGreaterThan(0);
      }
    });
  });

  it('runs every level curve to its own peak target, never to the shared cap', () => {
    let previous = 0;
    for (let index = 1; index <= levelCount; index++) {
      const config = levelConfig(index);
      expect(config.peakTarget).toBeGreaterThan(previous);
      expect(config.peakTarget).toBeLessThanOrEqual(balance.squad.maxCount);
      expect(squadCurve(config, config.rows - 1)).toBeCloseTo(config.peakTarget, 6);
      previous = config.peakTarget;
    }
  });

  it('keeps every block clear of a gate row, so their labels never collide', () => {
    everyLevel((level) => {
      const gateRowZ = level.rows.filter((r) => r.gates.some((g) => g !== null)).map((r) => r.z);
      for (const row of level.rows) {
        for (const enemy of row.enemies) {
          const z = row.z + (enemy.dz ?? 0);
          for (const gateZ of gateRowZ) {
            expect(Math.abs(gateZ - z)).toBeGreaterThanOrEqual(MIN_GATE_ENEMY_GAP);
          }
        }
      }
    });
  });

  it('hides a block behind a gate on mixed rows', () => {
    let mixed = 0;
    everyLevel((level) => {
      for (const row of level.rows) {
        const gates = row.gates.filter((g) => g !== null);
        if (gates.length === 0 || row.enemies.length === 0) continue;
        mixed++;
        for (const enemy of row.enemies) {
          expect(row.gates[enemy.lane + 1]).not.toBeNull();
          // Short of the gate it guards: the player meets the block first.
          expect(enemy.dz).toBe(-balance.gen.mixedEnemyOffset);
        }
      }
    });
    expect(mixed).toBeGreaterThan(0);
  });

  it('scales gate and block sizes with the expected squad at that row', () => {
    const level = generateLevel(10, levelConfig(10), 3);
    const config = levelConfig(10);
    expect(squadCurve(config, 0)).toBeCloseTo(config.startCount, 9);
    expect(squadCurve(config, config.rows - 1)).toBeCloseTo(config.peakTarget, 6);

    const early = level.rows.slice(0, 3).flatMap((r) => r.enemies.map((e) => e.units));
    const late = level.rows.slice(-3).flatMap((r) => r.enemies.map((e) => e.units));
    if (early.length > 0 && late.length > 0) {
      expect(Math.max(...late)).toBeGreaterThan(Math.max(...early));
    }
  });
});

describe('laneCenter', () => {
  it('spaces the three lanes across the road', () => {
    expect(laneCenter(-1)).toBe(-balance.road.laneWidth);
    expect(laneCenter(0)).toBe(0);
    expect(laneCenter(1)).toBe(balance.road.laneWidth);
  });
});
