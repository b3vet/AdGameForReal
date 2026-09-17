/**
 * The dealer's rules, carried over to the scripted campaign (document 31, 4.5).
 *
 * `level.test.ts`, `levelRules.test.ts` and `walls.test.ts` hold the rules
 * written for dealt levels, on the unscripted path (`dealtLevel`), and the
 * scripted rules proper are `levelDesign*.test.ts`'s. A few of the dealer's
 * rules are not about dealing at all, and carry over as they were: a level is
 * a function of its seed, rows stand on the 18 m grid, the arena is a row past
 * the last and nothing on the road reaches it, and a fence's stretch covers no
 * gate row but the one it guards (3.6: "the approach, gate gap and straggler
 * rules are unchanged"). Those are held here, on the levels the app plays.
 */

import { describe, expect, it } from 'vitest';

import { BOSS_Z_OFFSET, generateLevel } from '../level';
import type { LevelDef } from '../level';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];
const TUNING = balance.walls;

describe('the shipped scripts, as levels', () => {
  function everyScript(fn: (level: LevelDef, index: number, seed: number) => void): void {
    for (let index = 1; index <= levelCount; index++) {
      for (const seed of SEEDS) fn(generateLevel(index, levelConfig(index), seed), index, seed);
    }
  }

  it('is deterministic, and falls back to the config seed', () => {
    for (let index = 1; index <= levelCount; index++) {
      const config = levelConfig(index);
      const where = `L${String(index)}`;
      expect(`${where} ${JSON.stringify(generateLevel(index, config, 7))}`).toBe(
        `${where} ${JSON.stringify(generateLevel(index, config, 7))}`,
      );
      expect(`${where} ${JSON.stringify(generateLevel(index, config))}`).toBe(
        `${where} ${JSON.stringify(generateLevel(index, config, config.seed))}`,
      );
    }
  });

  it('stands every row on the 18 m grid, from the first', () => {
    everyScript((level, index, seed) => {
      level.rows.forEach((row, i) => {
        const where = `L${String(index)} s${String(seed)} row ${String(i)}`;
        expect(`${where} z ${String(row.z)}`).toBe(`${where} z ${String(balance.level.rowSpacing * (i + 1))}`);
      });
    });
  });

  it('puts the arena a row past the last and everything on the road short of it', () => {
    everyScript((level, index, seed) => {
      const where = `L${String(index)} s${String(seed)}`;
      const config = levelConfig(index);
      expect(level.arenaZ, where).toBeCloseTo(balance.level.rowSpacing * (level.rows.length + 1), 9);
      for (const row of level.rows) {
        for (const enemy of row.enemies) expect(row.z + (enemy.dz ?? 0), where).toBeLessThan(level.arenaZ);
        for (const stream of row.streams ?? []) expect(stream.anchorZ ?? row.z, where).toBeLessThan(level.arenaZ);
      }
      for (const wall of level.walls ?? []) expect(wall.zEnd, where).toBeLessThan(level.arenaZ);
      expect(level.bossId, where).toBe(config.boss.kind ?? 'demon');
      expect(level.boss.hp, where).toBe(config.boss.hp);
      expect(level.boss.units, where).toBe(Math.ceil(level.boss.hp / balance.enemies.boss.hpPerUnit));
      expect(BOSS_Z_OFFSET).toBe(balance.level.bossOffset);
    });
  });
});

describe('the fences a script builds', () => {
  it('covers no gate row but the one it guards, and never reaches the arena', () => {
    let seen = 0;
    for (let index = 1; index <= levelCount; index++) {
      for (const seed of SEEDS) {
        const def = generateLevel(index, levelConfig(index), seed);
        const gateRows = def.rows.filter((r) => r.gates.some((g) => g !== null));
        for (const w of def.walls ?? []) {
          seen++;
          const where = `L${String(index)} s${String(seed)} wall ${w.zStart.toFixed(1)}-${w.zEnd.toFixed(1)}`;
          expect(w.zEnd - w.zStart, where).toBeGreaterThanOrEqual(TUNING.minLength);
          expect(w.zEnd - w.zStart, where).toBeLessThanOrEqual(TUNING.length.max);
          expect(w.zEnd, where).toBeLessThanOrEqual(def.arenaZ - TUNING.gateClearance);
          for (const gateRow of gateRows) {
            const guarded = Math.abs(gateRow.z - TUNING.gateGap - w.zEnd) < 1e-6;
            const clear =
              guarded ||
              gateRow.z <= w.zStart - TUNING.gateClearance ||
              gateRow.z >= w.zEnd + TUNING.gateClearance;
            expect(`${where} vs gate ${gateRow.z.toFixed(1)}: ${String(clear)}`).toBe(
              `${where} vs gate ${gateRow.z.toFixed(1)}: true`,
            );
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(100);
  });
});
