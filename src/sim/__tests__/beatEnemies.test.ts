import { describe, expect, it } from 'vitest';

import { level, play, row, runOf } from './fixtures';
import { chargerKills } from '../chargers';
import { unitsOf } from '../contact';
import { enemyHalfWidth, wakeRange } from '../enemies';
import type { RowEnemyDef } from '../rows';
import { balance } from '@/data';

const RUN = balance.squad.runSpeed;

function blockRun(def: RowEnemyDef, z = 100, count = 300): ReturnType<typeof runOf> {
  return runOf(level({ startCount: count, rows: [row(z, [null, null, null], [def])] }));
}

describe('per-enemy wake', () => {
  it('wakes a block at its own distance', () => {
    const run = blockRun({ kind: 'brute', lane: 1, units: 5, wake: 45 });
    const block = run.state.enemies[0];
    expect(block?.wake).toBe(45);
    // Squad at 100 - 45 = 55 m after 11 s.
    play(run, 10.9, 2);
    expect(block?.active).toBe(false);
    play(run, 0.2, 2);
    expect(block?.active).toBe(true);
  });

  it('keeps the kind\'s own distance when the level names none', () => {
    // Too tough to shoot down before it wakes inside the squad's range.
    const run = blockRun({ kind: 'brute', lane: 1, units: 5, hpPerUnit: 1e9 });
    const block = run.state.enemies[0];
    expect(block?.wake).toBeUndefined();
    if (block !== undefined) expect(wakeRange(block, balance)).toBe(balance.enemies.activationDistance);
    play(run, (100 - balance.enemies.activationDistance) / RUN - 0.1, 2);
    expect(block?.active).toBe(false);
    play(run, 0.2, 2);
    expect(block?.active).toBe(true);
  });

  it('sets a charger off at its own trigger', () => {
    const run = blockRun({ kind: 'charger', lane: 0, units: 3, wake: 30, hpPerUnit: 1e9 });
    const charger = run.state.enemies[0];
    play(run, (100 - 30) / RUN - 0.1, 0);
    expect(charger?.charge).toBeUndefined();
    const events = play(run, 0.2, 0);
    expect(charger?.charge).toBeDefined();
    expect(events.some((e) => e.type === 'charge')).toBe(true);
  });
});

describe('per-enemy numbers', () => {
  it('builds hit points from the block\'s own hit points per unit and counts its units by them', () => {
    const run = blockRun({ kind: 'brute', lane: 1, units: 10, hpPerUnit: 12 });
    const block = run.state.enemies[0];
    expect(block?.hp).toBe(120);
    expect(block?.hpPerUnit).toBe(12);
    if (block === undefined) return;
    block.hp = 61;
    expect(unitsOf(block, balance)).toBe(6);
  });

  it('bites with the charger\'s own share', () => {
    const floor = balance.enemies.charger.kills;
    expect(chargerKills(400, balance)).toBe(Math.max(floor, Math.ceil(400 * balance.enemies.charger.killShare)));
    expect(chargerKills(400, balance, 0.1)).toBe(40);
    expect(chargerKills(20, balance, 0.1)).toBe(floor);
  });

  it('takes the charger\'s own share off the column it reaches', () => {
    // Unkillable, so it arrives: the test is its bite.
    const run = blockRun({ kind: 'charger', lane: 0, units: 1, wake: 30, killShare: 0.1, hpPerUnit: 1e9 }, 60, 400);
    // It sets off at 30 m (6 s in) and closes at 14 m/s.
    const events = play(run, 10, 0);
    const bite = events.find((e) => e.type === 'unitsLost');
    expect(bite?.type === 'unitsLost' ? bite.amount : 0).toBe(40);
  });

  it('holds a block to its lane when the beat says so', () => {
    const run = blockRun({ kind: 'brute', lane: 1, units: 200, maxHalf: 0.88 });
    const block = run.state.enemies[0];
    if (block === undefined) throw new Error('no block');
    expect(enemyHalfWidth(block, balance)).toBe(0.88);
    const { maxHalf: _held, ...wide } = block;
    expect(enemyHalfWidth(wide, balance)).toBeGreaterThan(1);
  });

  it('lets no shot from the next lane reach a block held to its lane', () => {
    // A fat block at x = +2 is shootable from the middle lane unless held.
    const held = blockRun({ kind: 'brute', lane: 1, units: 400, maxHalf: 0.88, wake: 1 }, 20, 200);
    const loose = blockRun({ kind: 'brute', lane: 1, units: 400, wake: 1 }, 20, 200);
    play(held, 2, 0);
    play(loose, 2, 0);
    const heldBlock = held.state.enemies[0];
    const looseBlock = loose.state.enemies[0];
    expect(heldBlock?.hp).toBe(heldBlock?.maxHp);
    expect(looseBlock?.hp ?? 0).toBeLessThan(looseBlock?.maxHp ?? 0);
  });
});
