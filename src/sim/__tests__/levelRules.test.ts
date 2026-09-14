/**
 * The three generation rules Phase C2 added to the retune (D45), each of which
 * is a shape a level has to have rather than a number it has to hit:
 *
 *   - a milestone level reads its own dials (`gen.milestone`), and which levels
 *     are milestones is a flag in `levels.json` rather than a list of indices
 *     in code;
 *   - the last row before the arena carries no gates, so the crowd walks the
 *     last stretch with what it has (`rowKinds.ts`, the gauntlet);
 *   - a fence never shuts the squad in with nothing but curses (`walls.ts`).
 *
 * Kept out of `level.test.ts` and `walls.test.ts`, which are both at the
 * file-size rule already (CLAUDE.md).
 */

import { describe, expect, it } from 'vitest';

import { genDials } from '../gateGen';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import { wallX } from '../walls';
import type { GateDef, Lane } from '../types';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/**
 * The four of biome 1 (D45, C2 follow-up) and the four Frostfell adds (D49).
 * The flag in `levels.json` is what the generator reads, not a list of indices
 * in code; this is the list the data is checked against.
 */
const MILESTONES = [7, 10, 15, 20, 25, 30, 35, 40];

function everyLevel(body: (level: LevelDef, index: number, seed: number) => void): void {
  for (let index = 1; index <= levelCount; index++) {
    for (const seed of SEEDS) body(generateLevel(index, levelConfig(index), seed), index, seed);
  }
}

function hasGates(gates: ReadonlyArray<GateDef | null>): boolean {
  return gates.some((gate) => gate !== null);
}

describe('milestone levels', () => {
  it('marks exactly the eight the plans name, in the data and not in code', () => {
    const flagged: number[] = [];
    for (let index = 1; index <= levelCount; index++) {
      if (levelConfig(index).milestone === true) flagged.push(index);
    }
    expect(flagged).toEqual(MILESTONES);
  });

  it('gives a milestone level its own dials and every other level the ordinary ones', () => {
    for (let index = 1; index <= levelCount; index++) {
      const dials = genDials(levelConfig(index));
      const where = `L${String(index)}`;
      if (MILESTONES.includes(index)) {
        expect(`${where} ${JSON.stringify(dials)}`).toBe(
          `${where} ${JSON.stringify(balance.gen.milestone)}`,
        );
      } else {
        expect(`${where} curse ${String(dials.curseShare)} blocks ${String(dials.blockScale)}`).toBe(
          `${where} curse ${String(balance.gen.curseShare)} blocks 1`,
        );
      }
    }
  });

  it('fills every lane of a milestone gate row', () => {
    // `thirdGateChance` is 1 there: no row offers a free walk-through, which is
    // what makes a misread cost something on the levels that are meant to.
    for (const index of MILESTONES) {
      for (const seed of SEEDS) {
        const level = generateLevel(index, levelConfig(index), seed);
        for (const row of level.rows) {
          if (!hasGates(row.gates)) continue;
          const filled = row.gates.filter((gate) => gate !== null).length;
          expect(`L${String(index)} s${String(seed)} z${row.z.toFixed(0)} lanes ${String(filled)}`).toBe(
            `L${String(index)} s${String(seed)} z${row.z.toFixed(0)} lanes 3`,
          );
        }
      }
    }
  });
});

describe('the gauntlet before the arena', () => {
  it('never ends a level on a gate row', () => {
    everyLevel((level, index, seed) => {
      const last = level.rows[level.rows.length - 1];
      expect(`L${String(index)} s${String(seed)} last row has gates: ${String(hasGates(last?.gates ?? []))}`).toBe(
        `L${String(index)} s${String(seed)} last row has gates: false`,
      );
    });
  });

  it('gives that last row something to be', () => {
    // A row with no gates and nothing in it is not a gauntlet, it is a gap.
    everyLevel((level, index, seed) => {
      const last = level.rows[level.rows.length - 1];
      const threats = (last?.enemies.length ?? 0) + (last?.streams?.length ?? 0);
      expect(`L${String(index)} s${String(seed)} last row threats > 0: ${String(threats > 0)}`).toBe(
        `L${String(index)} s${String(seed)} last row threats > 0: true`,
      );
    });
  });
});

describe('two fences in a row', () => {
  it('never lets one stretch begin while another is still holding', () => {
    // Milestone 7's fairness re-check (`walls.stretchGap`). Two stretches
    // closer than a bot's commit horizon are one commitment: the side of the
    // second is chosen out of whatever lanes the first has left open, and the
    // two guarded rows can between them offer nothing worth taking however
    // payable each of them is on its own. Level 34 seed 5 was the one that
    // found it — a fence on the left ruled out an `add`, and the next fence,
    // decided six metres later, priced a curse now against a worse curse next.
    //
    // The rule ran from `walls.stretchGapFromLevel` 21 when it was written, so
    // that the twenty levels Milestone 6 had already balanced were exempt;
    // three of them (11, 12 and 14) dealt a stacked pair on one seed in ten.
    // Milestone 7's balance phase measured the exemption away: with the gap on
    // from level 1 the Milestone 6 bands stay inside their targets on ten seeds
    // (campaign clears 118 of 160 against 119, survivors 0.450 against 0.452,
    // every boss still in band, greedy still 100 of 100), so the dial is 1 now
    // and the rule holds everywhere a fence can stand.
    const from = balance.walls.stretchGapFromLevel;
    const gap = balance.walls.stretchGap;
    everyLevel((level, index, seed) => {
      if (index < from) return;
      const walls = level.walls ?? [];
      for (const a of walls) {
        for (const b of walls) {
          // The mirrored stretch a horde row adds shares both ends; it is one
          // commitment with two fences, not two commitments.
          if (a === b || (a.zStart === b.zStart && a.zEnd === b.zEnd)) continue;
          const where = `L${String(index)} s${String(seed)} ${a.zEnd.toFixed(1)} then ${b.zStart.toFixed(1)}`;
          expect(`${where}: ${String(b.zStart >= a.zEnd + gap || a.zStart >= b.zEnd + gap)}`).toBe(
            `${where}: true`,
          );
        }
      }
    });
  });
});

describe('fences and the rows they guard', () => {
  it('never shuts the squad in with nothing but curses', () => {
    // The regression: a `[sub, sub, add]` row walled on the `add`'s own
    // boundary cost greedy eighteen of its twenty-three units on level 10 seed
    // 3, with no lane on its side of the line worth taking.
    const gap = balance.walls.gateGap;
    everyLevel((level, index, seed) => {
      for (const wall of level.walls ?? []) {
        const guarded = level.rows.find((row) => Math.abs(row.z - (wall.zEnd + gap)) < 1e-6);
        if (guarded === undefined) continue;
        const line = wallX(wall.boundary, balance.road.laneWidth);
        const keeps = (lane: Lane): boolean => {
          const gate = guarded.gates[lane + 1];
          return gate === null || gate === undefined || gate.kind !== 'sub';
        };
        // From `walls.bothFromLevel` a horde row can be fenced on both sides at
        // once, and then the only lane the squad can reach is the middle one.
        const both = (level.walls ?? []).some(
          (other) =>
            other.boundary === -wall.boundary &&
            other.zStart === wall.zStart &&
            other.zEnd === wall.zEnd,
        );
        const outside: Lane = wall.boundary < 0 ? -1 : 1;
        const inside: Lane[] = both ? [0] : wall.boundary < 0 ? [0, 1] : [-1, 0];
        const where = `L${String(index)} s${String(seed)} wall at ${line.toFixed(1)}`;
        if (!both) {
          expect(`${where} outside payable: ${String(keeps(outside))}`).toBe(
            `${where} outside payable: true`,
          );
        }
        expect(`${where} inside payable: ${String(inside.some(keeps))}`).toBe(
          `${where} inside payable: true`,
        );
      }
    });
  });
});
