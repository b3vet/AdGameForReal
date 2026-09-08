import { describe, expect, it } from 'vitest';

import { generateLevel, laneCenter, laneOf, rowOffersGrowth, squadCurve, BOSS_Z_OFFSET } from '../level';
import type { LevelDef, RowDef } from '../level';
import type { GateDef } from '../types';
import { withWeaponGates } from './fixtures';
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

function laneOfKind(row: RowDef, kind: string): number | null {
  for (const lane of [-1, 0, 1]) {
    if (row.gates[lane + 1]?.kind === kind) return lane;
  }
  return null;
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

  it('never puts two mul gates on one row', () => {
    everyLevel((level) => {
      for (const row of level.rows) {
        const gates = row.gates.filter((g): g is GateDef => g !== null);
        expect(gates.filter((g) => g.kind === 'mul').length).toBeLessThanOrEqual(1);
      }
    });
  });

  it('never builds a row whose every gate is a penalty', () => {
    // Not only the three-gate rows: a two-gate row of two penalties is just as
    // much of a trap, because the player still has to pick one of them.
    everyLevel((level, index, seed) => {
      for (const row of level.rows) {
        const gates = row.gates.filter((g): g is GateDef => g !== null);
        if (gates.length === 0) continue;
        const where = `L${String(index)} seed ${String(seed)} row z=${String(row.z)}`;
        const kinds = gates.map((g) => g.kind).join(',');
        expect(`${where}: ${String(gates.some((g) => g.kind !== 'sub'))}`).toBe(`${where}: true`);
        expect(kinds.length).toBeGreaterThan(0);
      }
    });
  });

  it('never prints the same number twice on one row', () => {
    // Two lanes offering `+3` are not a choice, they are a wasted row.
    everyLevel((level, index, seed) => {
      for (const row of level.rows) {
        const keys = row.gates
          .filter((g): g is GateDef => g !== null)
          .map((g) => `${g.kind}:${String(g.value)}`);
        expect(`L${String(index)} s${String(seed)} z${String(row.z)}: ${new Set(keys).size}`).toBe(
          `L${String(index)} s${String(seed)} z${String(row.z)}: ${keys.length}`,
        );
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
      expect(first?.gates.some((g) => g?.kind === 'mul' || g?.kind === 'weapon')).toBe(false);
      for (const row of level.rows) {
        expect(row.gates.some((g) => g !== null) || row.enemies.length > 0).toBe(true);
        expect(row.enemies.length).toBeLessThanOrEqual(3);
        for (const enemy of row.enemies) expect(enemy.units).toBeGreaterThan(0);
      }
    });
  });

  it('offers a way to grow on every row, and a real gate on every gate row', () => {
    everyLevel((level, index, seed) => {
      for (const row of level.rows) {
        const where = `L${String(index)} s${String(seed)} z${String(row.z)}`;
        expect(`${where}: ${String(rowOffersGrowth(row))}`).toBe(`${where}: true`);
        // Stronger than the rule: a row with gates on it always carries one the
        // player can come out of bigger, not merely an empty lane.
        if (!row.gates.some((g) => g !== null)) continue;
        const grows = row.gates.some(
          (g) => g !== null && (g.kind === 'add' || g.kind === 'mul' || g.kind === 'weapon'),
        );
        expect(`${where}: ${String(grows)}`).toBe(`${where}: true`);
      }
    });
  });

  it('spaces rows the plan\'s eleven metres apart and runs 12 rows to 20', () => {
    expect(balance.level.rowSpacing).toBe(11);
    expect(levelConfig(1).rows).toBe(12);
    expect(levelConfig(levelCount).rows).toBe(20);
    let previous = 0;
    for (let index = 1; index <= levelCount; index++) {
      const rows = levelConfig(index).rows;
      expect(rows).toBeGreaterThanOrEqual(previous);
      previous = rows;
    }
  });

  it('runs 28 to 47 seconds of road before the boss', () => {
    // The plan asks for 30 to 45 s; 12 and 20 rows at 11 m overshoot that band
    // by about a second and a half at each end, and the row counts win.
    everyLevel((level) => {
      const seconds = level.arenaZ / balance.squad.runSpeed;
      expect(seconds).toBeGreaterThanOrEqual(28);
      expect(seconds).toBeLessThanOrEqual(47);
    });
  });

  it('keeps a curse under a third of the squad the row was built for', () => {
    everyLevel((level, index, seed) => {
      level.rows.forEach((row, i) => {
        const ceiling = Math.max(2, Math.floor(squadCurve(levelConfig(index), i) * balance.gen.curseShare));
        for (const gate of row.gates) {
          if (gate?.kind !== 'sub') continue;
          const where = `L${String(index)} s${String(seed)} row ${String(i)}`;
          expect(`${where}: ${String(gate.value <= ceiling)}`).toBe(`${where}: true`);
          expect(gate.value).toBeGreaterThan(0);
        }
      });
    });
  });

  it('keeps curses inside the level\'s own range once the squad is big enough', () => {
    // Level 1 curses read 2 to 6, level 10's read 15 to 60.
    expect(levelConfig(1).gateValues.sub).toEqual({ min: 2, max: 6 });
    expect(levelConfig(levelCount).gateValues.sub).toEqual({ min: 15, max: 60 });
    everyLevel((level, index) => {
      const range = levelConfig(index).gateValues.sub;
      for (const gate of gatesOf(level)) {
        if (gate.kind !== 'sub') continue;
        expect(gate.value).toBeLessThanOrEqual(range.max);
      }
    });
  });

  it('holds multipliers at x2 until level 6, and never past x3', () => {
    everyLevel((level, index) => {
      for (const gate of gatesOf(level)) {
        if (gate.kind !== 'mul') continue;
        expect(gate.value).toBeLessThanOrEqual(index >= balance.gen.mulX3FromLevel ? 3 : 2);
      }
    });
  });

  it('never gives a multiplier away: it is paired with a curse or a block', () => {
    let multipliers = 0;
    everyLevel((level, index, seed) => {
      for (const row of level.rows) {
        const lane = laneOfKind(row, 'mul');
        if (lane === null) continue;
        multipliers++;
        const paired =
          row.gates.some((g) => g?.kind === 'sub') || row.enemies.some((e) => e.lane === lane);
        const where = `L${String(index)} s${String(seed)} z${String(row.z)}`;
        expect(`${where}: ${String(paired)}`).toBe(`${where}: true`);
      }
    });
    expect(multipliers).toBeGreaterThan(0);
  });

  it('deals the same row mix to every seed, so a level is the level it was designed as', () => {
    for (let index = 1; index <= levelCount; index++) {
      const counts = SEEDS.map((seed) => {
        const level = generateLevel(index, levelConfig(index), seed);
        return level.rows.filter((r) => r.gates.some((g) => g !== null)).length;
      });
      expect(new Set(counts).size).toBe(1);
    }
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

describe('staff gates', () => {
  it('are off until the renderer can draw them', () => {
    expect(balance.gen.weaponGatesEnabled).toBe(false);
    everyLevel((level) => {
      expect(gatesOf(level).some((g) => g.kind === 'weapon')).toBe(false);
    });
  });

  it('appear once before level 4 and at most twice after, never on the first row', () => {
    withWeaponGates(() => {
      let seen = 0;
      everyLevel((level, index, seed) => {
        const staffs = gatesOf(level).filter((g) => g.kind === 'weapon');
        seen += staffs.length;
        const allowed =
          index >= balance.gen.weaponGateManyFromLevel
            ? balance.gen.weaponGatesLate
            : balance.gen.weaponGatesEarly;
        const where = `L${String(index)} s${String(seed)}`;
        expect(`${where}: ${String(staffs.length)}`).toBe(
          `${where}: ${String(Math.min(staffs.length, allowed))}`,
        );
        expect(level.rows[0]?.gates.some((g) => g?.kind === 'weapon')).toBe(false);
        for (const gate of staffs) {
          expect(gate.weaponId).toBeDefined();
          // Always a change of staff: the run already starts holding ember.
          expect(gate.weaponId).not.toBe('ember');
        }
      });
      expect(seen).toBeGreaterThan(0);
    });
  });

  it('never puts two staff gates on one row', () => {
    withWeaponGates(() => {
      everyLevel((level) => {
        for (const row of level.rows) {
          expect(row.gates.filter((g) => g?.kind === 'weapon').length).toBeLessThanOrEqual(1);
        }
      });
    });
  });
});

describe('laneCenter', () => {
  it('spaces the three lanes across the road', () => {
    expect(laneCenter(-1)).toBe(-balance.road.laneWidth);
    expect(laneCenter(0)).toBe(0);
    expect(laneCenter(1)).toBe(balance.road.laneWidth);
  });

  it('reads a lane back symmetrically, boundaries included', () => {
    expect(laneOf(0)).toBe(0);
    expect(laneOf(1)).toBe(1);
    expect(laneOf(-1)).toBe(-1);
    expect(laneOf(99)).toBe(1);
    expect(laneOf(-99)).toBe(-1);
  });
});
