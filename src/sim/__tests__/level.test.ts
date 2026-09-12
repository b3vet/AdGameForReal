import { describe, expect, it } from 'vitest';

import { generateLevel, laneCenter, laneOf, rowOffersGrowth, squadCurve, BOSS_Z_OFFSET } from '../level';
import type { LevelDef, RowDef } from '../level';
import type { GateDef, StreamDef } from '../types';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/** Closer than this and a block's HP label prints over a gate's number. */
const MIN_GATE_ENEMY_GAP = balance.streams.gateClearance;

/** Rows that carry gates. Threat rows are nudged off the grid; these are not. */
function gateRowsOf(level: LevelDef): RowDef[] {
  return level.rows.filter((r) => r.gates.some((g) => g !== null));
}

function streamsOf(level: LevelDef): StreamDef[] {
  return level.rows.flatMap((r) => r.streams ?? []);
}

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

  it('stands every gate row on the 18 m grid and nudges only threat rows off it', () => {
    everyLevel((level) => {
      expect(level.rows).toHaveLength(levelConfig(level.index).rows);
      level.rows.forEach((row, i) => {
        const grid = balance.level.rowSpacing * (i + 1);
        if (row.gates.some((g) => g !== null)) {
          expect(row.z).toBeCloseTo(grid, 9);
        } else {
          expect(Math.abs(row.z - grid)).toBeLessThanOrEqual(balance.streams.zJitter);
        }
        // The nudge never reorders the road: `Run` walks rows in array order.
        if (i > 0) expect(row.z).toBeGreaterThan(level.rows[i - 1]?.z ?? -Infinity);
      });
    });
  });

  it('carries the plan\'s eight gate rows at the start, fourteen by the end', () => {
    // Milestone 3's eight-to-twelve over ten levels, continued to twenty (D32's
    // "the Milestone 3 curve stretched"): the late levels buy their difficulty
    // from pressure, hordes and walls, and pay for it with more gate rows.
    everyLevel((level, index) => {
      expect(gateRowsOf(level)).toHaveLength(levelConfig(index).gateRows);
    });
    expect(levelConfig(1).gateRows).toBe(8);
    expect(levelConfig(10).gateRows).toBe(12);
    expect(levelConfig(levelCount).gateRows).toBe(14);
    let previous = 0;
    for (let index = 1; index <= levelCount; index++) {
      const rows = levelConfig(index).gateRows;
      expect(rows).toBeGreaterThanOrEqual(previous);
      previous = rows;
    }
  });

  it('keeps every stream and every block clear of a gate row', () => {
    everyLevel((level, index, seed) => {
      const gateZ = gateRowsOf(level).map((r) => r.z);
      for (const row of level.rows) {
        const threats = [
          ...row.enemies.map((e) => row.z + (e.dz ?? 0)),
          ...(row.streams ?? []).map(() => row.z),
        ];
        for (const z of threats) {
          for (const gate of gateZ) {
            const where = `L${String(index)} s${String(seed)} z${z.toFixed(1)}`;
            const clear = Math.abs(gate - z) >= MIN_GATE_ENEMY_GAP;
            expect(`${where}: ${String(clear)}`).toBe(`${where}: true`);
          }
        }
      }
    });
  });

  it('pours a horde down two different lanes and a stream down one', () => {
    let hordes = 0;
    let singles = 0;
    everyLevel((level, index) => {
      for (const row of level.rows) {
        const streams = row.streams ?? [];
        if (streams.length === 0) continue;
        // A stream row is never a gate row: the plan puts streams between them.
        expect(row.gates.every((g) => g === null)).toBe(true);
        expect(streams.length).toBeLessThanOrEqual(2);
        if (streams.length === 2) {
          hordes++;
          expect(streams[0]?.lane).not.toBe(streams[1]?.lane);
          // Neighbouring lanes, so the squad can answer both by standing between.
          expect(Math.abs((streams[0]?.lane ?? 0) - (streams[1]?.lane ?? 0))).toBe(
            balance.gen.hordeLaneGap,
          );
        } else {
          singles++;
        }
      }
      const wanted = levelConfig(index).hordeRows;
      expect(level.rows.filter((r) => (r.streams ?? []).length === 2)).toHaveLength(wanted);
    });
    expect(hordes).toBeGreaterThan(0);
    expect(singles).toBeGreaterThan(0);
  });

  it('keeps level 1 to single light streams and never one before the first gate row', () => {
    for (const seed of SEEDS) {
      const first = generateLevel(1, levelConfig(1), seed);
      expect(levelConfig(1).hordeRows).toBe(0);
      for (const row of first.rows) expect((row.streams ?? []).length).toBeLessThanOrEqual(1);
      const firstGateRow = first.rows.findIndex((r) => r.gates.some((g) => g !== null));
      expect(firstGateRow).toBe(0);
      const firstStreamRow = first.rows.findIndex((r) => (r.streams ?? []).length > 0);
      expect(firstStreamRow).toBeGreaterThan(firstGateRow);
      // Level 1 fills all three lanes, so no row can hand a player nothing.
      for (const row of first.rows) {
        if (!row.gates.some((g) => g !== null)) continue;
        expect(row.gates.every((g) => g !== null)).toBe(true);
      }
    }
  });

  it('puts the arena past the last row and the boss past the arena', () => {
    everyLevel((level, index) => {
      const last = level.rows[level.rows.length - 1];
      // From the grid, not from the last row: a nudged final threat row must
      // not move the arena, because the level's length is a time budget.
      const rows = levelConfig(index).rows;
      expect(level.arenaZ).toBeCloseTo(balance.level.rowSpacing * (rows + 1), 9);
      expect(level.arenaZ).toBeGreaterThan(last?.z ?? 0);
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
      expect(first?.streams ?? []).toHaveLength(0);
      expect(first?.gates.some((g) => g !== null)).toBe(true);
      expect(first?.gates.some((g) => g?.kind === 'mul' || g?.kind === 'weapon')).toBe(false);
      for (const row of level.rows) {
        const has =
          row.gates.some((g) => g !== null) ||
          row.enemies.length > 0 ||
          (row.streams ?? []).length > 0;
        expect(has).toBe(true);
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

  it('spaces rows the plan\'s eighteen metres apart and runs 16 rows to 19', () => {
    expect(balance.level.rowSpacing).toBe(18);
    expect(levelConfig(1).rows).toBe(16);
    expect(levelConfig(levelCount).rows).toBe(19);
    let previous = 0;
    for (let index = 1; index <= levelCount; index++) {
      const rows = levelConfig(index).rows;
      expect(rows).toBeGreaterThanOrEqual(previous);
      previous = rows;
    }
  });

  it('runs 60 to 75 seconds of road before the boss', () => {
    everyLevel((level) => {
      const seconds = level.arenaZ / balance.squad.runSpeed;
      expect(seconds).toBeGreaterThanOrEqual(60);
      expect(seconds).toBeLessThanOrEqual(75);
    });
  });

  it('sends a stream nobody has to fight twice, sized to the squad at its row', () => {
    everyLevel((level, index) => {
      const config = levelConfig(index);
      for (const def of streamsOf(level)) {
        expect(def.count).toBeGreaterThanOrEqual(balance.streams.count.min);
        expect(def.count).toBeLessThanOrEqual(balance.streams.count.max);
        expect(def.hpPerEnemy).toBeGreaterThan(0);
        expect(def.durationSeconds).toBeGreaterThanOrEqual(balance.streams.duration.min);
        expect(def.durationSeconds).toBeLessThanOrEqual(balance.streams.duration.max);
        expect(def.speed).toBe(balance.streams.speed);
      }
      // Later rows are built for a bigger squad, so they send more bodies.
      const early = level.rows.slice(0, 6).flatMap((r) => (r.streams ?? []).map((s) => s.count));
      const late = level.rows.slice(-6).flatMap((r) => (r.streams ?? []).map((s) => s.count));
      if (early.length > 0 && late.length > 0 && config.peakTarget > config.startCount) {
        expect(Math.max(...late)).toBeGreaterThan(Math.max(...early));
      }
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
    // Level 1 curses read 2 to 6, level 10's read 15 to 60, level 20's 25 to 100.
    expect(levelConfig(1).gateValues.sub).toEqual({ min: 2, max: 6 });
    expect(levelConfig(10).gateValues.sub).toEqual({ min: 15, max: 60 });
    expect(levelConfig(levelCount).gateValues.sub).toEqual({ min: 25, max: 100 });
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
      const shapes = SEEDS.map((seed) => {
        const level = generateLevel(index, levelConfig(index), seed);
        const gates = gateRowsOf(level).length;
        const hordes = level.rows.filter((r) => (r.streams ?? []).length === 2).length;
        const streams = level.rows.filter((r) => (r.streams ?? []).length > 0).length;
        return `${String(gates)}/${String(streams)}/${String(hordes)}`;
      });
      expect(new Set(shapes).size).toBe(1);
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

    const early = level.rows.slice(0, 5).flatMap((r) => r.enemies.map((e) => e.units));
    const late = level.rows.slice(-5).flatMap((r) => r.enemies.map((e) => e.units));
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

  it('reads a lane back symmetrically, boundaries included', () => {
    expect(laneOf(0)).toBe(0);
    expect(laneOf(1)).toBe(1);
    expect(laneOf(-1)).toBe(-1);
    expect(laneOf(99)).toBe(1);
    expect(laneOf(-99)).toBe(-1);
  });
});
