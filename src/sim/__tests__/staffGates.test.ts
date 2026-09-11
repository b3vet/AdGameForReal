import { describe, expect, it } from 'vitest';

import { emptyLane, staffLane } from '../gateGen';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import type { GateDef } from '../types';
import { withWeaponGates } from './fixtures';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

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

describe('staff gates', () => {
  it('are generated from level 2 on, and never on level 1', () => {
    // Phase C turned them on (plan, definition of done 5): the renderer draws
    // the staff a `weapon` panel offers, so the generator may deal them.
    expect(balance.gen.weaponGatesEnabled).toBe(true);
    everyLevel((level, index) => {
      const staffs = gatesOf(level).filter((g) => g.kind === 'weapon');
      if (index < balance.gen.weaponFromLevel) expect(staffs.length).toBe(0);
    });

    let seen = 0;
    for (const seed of SEEDS) {
      seen += gatesOf(generateLevel(2, levelConfig(2), seed)).filter(
        (g) => g.kind === 'weapon',
      ).length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('leave every row a way to grow and every cursed row a curse', () => {
    // A staff hands over no units, so it may only take a lane the row can
    // spare — see `placeWeaponGates`.
    everyLevel((level) => {
      for (const row of level.rows) {
        if (!row.gates.some((g) => g?.kind === 'weapon')) continue;
        const kinds = row.gates.filter((g) => g !== null).map((g) => g.kind);
        expect(kinds.some((kind) => kind === 'add' || kind === 'mul')).toBe(true);
      }
    });
  });

  it('appear once before level 4 and at most twice after, never on the first row', () => {
    withWeaponGates(() => {
      let seen = 0;
      everyLevel((level, index, seed) => {
        const staffs = gatesOf(level).filter((g) => g.kind === 'weapon');
        seen += staffs.length;
        const allowed =
          index < balance.gen.weaponFromLevel
            ? 0
            : index >= balance.gen.weaponGateManyFromLevel
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

  /**
   * Phase C shipped nine of the forty-five level-seed pairs with no staff gate
   * at all — every row there was one curse and one grower, so `staffLane` found
   * nothing it could take. A run on one of those levels could never see two of
   * its three staffs. `placeWeaponGates` now falls back to a lane that is
   * already empty, which costs the row nothing.
   */
  it('gives every level from level 2 on at least one staff gate, on every seed', () => {
    everyLevel((level, index, seed) => {
      if (index < balance.gen.weaponFromLevel) return;
      const staffs = gatesOf(level).filter((g) => g.kind === 'weapon');
      const where = `L${String(index)} s${String(seed)}`;
      expect(`${where}: ${String(staffs.length > 0)}`).toBe(`${where}: true`);
    });
  });

  /**
   * The fallback takes an empty lane, and an enemy row's three lanes are all
   * empty — but that row's whole job is to be a wall the player picks a way
   * through, and a panel standing in the gap narrows it.
   */
  it('only ever converts a lane of a row that already carries gates', () => {
    everyLevel((level) => {
      for (const row of level.rows) {
        if (!row.gates.some((g) => g?.kind === 'weapon')) continue;
        expect(row.gates.some((g) => g !== null && g.kind !== 'weapon')).toBe(true);
      }
    });
  });

  describe('the lane a staff may take', () => {
    const add: GateDef = { kind: 'add', value: 5, cap: 9 };
    const sub: GateDef = { kind: 'sub', value: 5, cap: 9 };
    const rate: GateDef = { kind: 'fireRate', value: 0.05, cap: 0.1 };

    it('spends a bonus before a duplicate, and a duplicate before nothing', () => {
      expect(staffLane([rate, add, sub])).toBe(0);
      expect(staffLane([add, add, sub])).toBe(1);
      expect(staffLane([sub, sub, add])).toBe(1);
      // One curse and one grower: neither may go. This is the row that left
      // nine level-seed pairs with no staff gate at all.
      expect(staffLane([sub, null, add])).toBe(-1);
    });

    it('falls back to an empty lane, but never on a row with no gates', () => {
      expect(emptyLane([sub, null, add])).toBe(1);
      expect(emptyLane([null, sub, add])).toBe(0);
      expect(emptyLane([sub, add, null])).toBe(2);
      // Full row: nothing to spare here either.
      expect(emptyLane([sub, add, rate])).toBe(-1);
      // An enemy row. Its lanes are the gap the player runs through.
      expect(emptyLane([null, null, null])).toBe(-1);
    });
  });
});

