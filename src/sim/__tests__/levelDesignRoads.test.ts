/**
 * The forty scripts as roads (document 31, 3.8 and 4.5): every script
 * composes on its own seed and on others, prints exactly the budget it was
 * given, fences only where a fence beat stands, and never lets a multiplier
 * through unpriced. And the outline itself, pinned in 3.9's notation, so an
 * edit to a script is a visible, readable change rather than a silent one.
 */

import { describe, expect, it } from 'vitest';

import { generateLevel } from '../level';
import type { LevelDef, RowDef } from '../level';
import type { Lane } from '../types';
import { ROAD_SECONDS, notation } from './levelDesignRules';
import { balance, beats, levelConfig, levelCount } from '@/data';

/** The shipped road is the level's own seed (3.8); the others only shuffle lanes. */
const SEEDS = [1, 2, 3];

/**
 * 3.9's outline as shipped, with each level's curse budget. Where a line
 * differs from the table in document 31 the table's own rules asked for it:
 *
 * - L3: C1 before the first T2, so the level's first curse is the flip (3.5).
 * - L5, L6: a C1 added, so one curse per level flips on levels 4 to 9 (3.5);
 *   both levels had room for a ninth beat.
 * - L7: the first T2 is a C2, for the same rule, keeping the level's weight.
 * - L23: W2x rather than W2, so a test level on Frostfell prints two
 *   multipliers (3.5: one on teach and release levels, else two).
 * - L32: the rest moved one beat later, so no four threats run unbroken.
 */
const OUTLINE: readonly string[] = [
  'O G1 O T1 G1 R G1 B1 / 0',
  'O C1 G1x R T1 G1 R B1 / 2',
  'O C1 T2 R G1x T2 R B1 / 2',
  'O G1 W1 R T2 C1 G2x B1 / 2',
  'O A1 G2 R W2 C1 A2 G2x B2 / 2',
  'O F1 G2x R A2 W2 C1 F2 B2 / 3',
  'O C2 F2 A2 R W2x G3 T2 B2 / 3',
  'O G2x A2 R F3 W2 C1 T3 B2 / 3',
  'O C1 A2 W2 R F2 T3 G3x B2 / 3',
  'O G2x W3 R A3 T3 R W4x B3 / 4',
  'O O G2x T2 R A2 F2 B2 / 2',
  'O T2x W3 R G3x A3 C1 F3 B2 / 4',
  'O A2 F3 R W3x T3 R G3x3 B3 / 4',
  'O G2x T3x W3 R F3 A3 C1 B3 / 4',
  'O W3x A3 R F4 T3 R W4x3 B3 / 5',
  'O O T2 G2x R A3 F3 B2 / 3',
  'O A3 W3x R G3x T3 F3 C1 B3 / 4',
  'O F3 W3x R A3 T4 R G3x3 B3 / 5',
  'O T3x A3 W3 R F3 G4x C1 B3 / 5',
  'O W3x A4 R F4 T4 R W5x3 B4 / 5',
  'O G1 K1 R T2 G2x R K2 B2 / 2',
  'O Gs1 T2 R K2 Gs2x R A2 B2 / 3',
  'O K2 W2x R Gs2x T3 F2 C1 B2 / 3',
  'O A2 K2 R W3x Gs3x T3 C1 B3 / 4',
  'O Gs3x W3 R K3 A3 R W4x3 B4 / 4',
  'O O K2 G2x R T3 A2 B2 / 3',
  'O T2x K3 R A3 W3x Gs3 C1 B3 / 4',
  'O Gs2x F3 R W3x K3 T3 R B3 / 4',
  'O A3 W3x R K3 T3 Gs3x C1 B3 / 5',
  'O W3x K4 R A4 T4 R W5x3 B4 / 5',
  'O O Gs2x T3 R K2 A3 B3 / 3',
  'O K3 W3x A3 R T3 F3 Gs3x B3 / 5',
  'O T3 A3 R W4x K3 R Gs3x3 B3 / 5',
  'O Gs3x K3 W3x R T4 A3 C1 B3 / 5',
  'O W4x A4 R K4 T4 R W5x3 B4 / 6',
  'O O T3 Gs3x R A3 K3 B3 / 4',
  'O A3 W4x R K3 T4x Gs3 C1 B4 / 5',
  'O K4 W4x R A4 T4 R Gs4x3 B4 / 6',
  'O T4x A4 W4 R K4 Gs4x C1 B4 / 6',
  'O W4x K5 R A5 T5 R W5x3 B5 / 6',
];

function compose(index: number, seed: number): LevelDef {
  try {
    return generateLevel(index, levelConfig(index), seed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`L${String(index)} seed ${String(seed)}: ${message}`, { cause: error });
  }
}

/** Every level on its shipped seed and on `SEEDS`. */
function everyRoad(body: (level: LevelDef, at: string) => void): void {
  for (let index = 1; index <= levelCount; index++) {
    const config = levelConfig(index);
    for (const seed of [config.seed, ...SEEDS]) body(compose(index, seed), `L${String(index)} seed ${String(seed)}`);
  }
}

const LANES: readonly Lane[] = [-1, 0, 1];

function gatesOf(row: RowDef, kind: string): Lane[] {
  return LANES.filter((lane) => row.gates[lane + 1]?.kind === kind);
}

/** Something in `lane` among `rows` the column pays for standing in it. */
function laneThreatened(rows: readonly RowDef[], lane: Lane): boolean {
  return rows.some(
    (row) => row.enemies.some((enemy) => enemy.lane === lane) || (row.streams ?? []).some((s) => s.lane === lane),
  );
}

describe('the scripted roads', () => {
  it('follow the outline, as pinned', () => {
    const shipped: string[] = [];
    for (let index = 1; index <= levelCount; index++) {
      const config = levelConfig(index);
      shipped.push(`${notation(config.script ?? [])} / ${String(config.curses ?? '-')}`);
    }
    expect(shipped.join('\n')).toBe(OUTLINE.join('\n'));
  });

  it('compose on every seed, with a mark per beat on its gate row and 60 to 75 s of road', () => {
    everyRoad((level, at) => {
      const script = levelConfig(level.index).script ?? [];
      const marks = level.beats ?? [];
      const rows = script.reduce((sum, entry) => sum + (beats.defs.find((d) => d.id === entry.beat)?.rows ?? 0), 0);
      expect(level.rows, at).toHaveLength(rows);
      expect(marks.map((mark) => `${mark.beat}:${String(mark.tier)}`), at).toEqual(
        script.map((entry) => `${entry.beat}:${String(entry.tier)}`),
      );
      const markZ = new Set(marks.map((mark) => mark.z));
      for (const row of level.rows) {
        const gated = row.gates.some((gate) => gate !== null);
        const label = `${at} z ${String(row.z)} gated`;
        expect(`${label} ${String(gated)}`).toBe(`${label} ${String(markZ.has(row.z))}`);
      }
      const seconds = level.arenaZ / level.runSpeed;
      expect(seconds, at).toBeGreaterThanOrEqual(ROAD_SECONDS[0]);
      expect(seconds, at).toBeLessThanOrEqual(ROAD_SECONDS[1]);
      // 3.8: the prize is not in the same lane three beats running.
      marks.forEach((mark, i) => {
        const two = marks[i - 1]?.prize === mark.prize && marks[i - 2]?.prize === mark.prize;
        expect(two, `${at} beat ${String(i + 1)} prize lane thrice`).toBe(false);
      });
    });
  });

  it('print exactly the budgeted curses and the scripted multipliers', () => {
    everyRoad((level, at) => {
      const config = levelConfig(level.index);
      const script = config.script ?? [];
      const count = (kind: string): number => level.rows.reduce((sum, row) => sum + gatesOf(row, kind).length, 0);
      expect(count('sub'), `${at} curses`).toBe(config.curses);
      expect(count('mul'), `${at} multipliers`).toBe(script.filter((e) => e.prize === 'x2' || e.prize === 'x3').length);
      const x3 = level.rows.reduce(
        (sum, row) => sum + row.gates.filter((gate) => gate?.kind === 'mul' && gate.value === 3).length,
        0,
      );
      expect(x3, `${at} x3`).toBe(script.filter((e) => e.prize === 'x3').length);
    });
  });

  it('price every multiplier in its own beat, with nothing standing behind it', () => {
    everyRoad((level, at) => {
      level.rows.forEach((row, i) => {
        for (const lane of gatesOf(row, 'mul')) {
          const beatRows = level.rows.slice(Math.max(0, i - 1), i + 1);
          expect(laneThreatened(beatRows, lane), `${at} z ${String(row.z)} unguarded x`).toBe(true);
          const behind = row.enemies.some((enemy) => enemy.lane === lane && (enemy.dz ?? 0) > 0);
          expect(behind, `${at} z ${String(row.z)} a block behind a multiplier`).toBe(false);
        }
      });
    });
  });

  it('fence only at fence beats, one stretch each, ending at the gate gap', () => {
    everyRoad((level, at) => {
      const fenceZ = (level.beats ?? []).filter((mark) => mark.beat === 'fence').map((mark) => mark.z);
      const walls = level.walls ?? [];
      expect(walls, at).toHaveLength(fenceZ.length);
      for (const wall of walls) {
        const gate = wall.zEnd + balance.walls.gateGap;
        expect(fenceZ.some((z) => Math.abs(z - gate) < 1e-6), `${at} wall ending ${String(wall.zEnd)}`).toBe(true);
        expect(wall.zEnd - wall.zStart, at).toBeGreaterThanOrEqual(balance.walls.minLength);
      }
    });
  });

  it('keep each beat inside the portal body cap, and replay byte for byte', () => {
    const cap = balance.enemies.portal.maxBodiesPerBeat;
    everyRoad((level, at) => {
      for (const mark of level.beats ?? []) {
        const rows = level.rows.filter((row) => row.z <= mark.z && row.z > mark.z - 2 * balance.level.rowSpacing);
        const bodies = rows.reduce((sum, row) => sum + (row.streams ?? []).reduce((n, s) => n + s.count, 0), 0);
        expect(bodies, `${at} ${mark.beat} at ${String(mark.z)}`).toBeLessThanOrEqual(cap);
      }
    });
    for (let index = 1; index <= levelCount; index++) {
      const seed = levelConfig(index).seed;
      expect(JSON.stringify(compose(index, seed)), `L${String(index)}`).toBe(JSON.stringify(compose(index, seed)));
    }
  });
});
