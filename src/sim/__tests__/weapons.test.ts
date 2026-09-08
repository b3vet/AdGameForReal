/**
 * The three staffs (docs/06-milestone-2-plan.md, "Weapons"): what each one does
 * when a shot lands, and what a staff gate does when the squad walks through it.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { effectiveSpeed } from '../contact';
import { generateLevel } from '../level';
import type { RowEnemyDef } from '../level';
import { Run } from '../Run';
import type { EnemyState, SimEvent } from '../types';
import { expectedDps, weaponDef, weaponIds, weaponOf } from '../weapons';
import { level, play, row, runOf, staffRow } from './fixtures';
import { balance, levelConfig, levelCount } from '@/data';

/** A squad small enough that every shot leaves the middle lane. */
const SMALL = 3;

function blocks(...defs: RowEnemyDef[]): RowEnemyDef[] {
  return defs;
}

function hpOf(enemies: readonly EnemyState[], id: number): number {
  return enemies.find((e) => e.id === id)?.hp ?? -1;
}

function lanes(enemies: readonly EnemyState[]): number[] {
  return enemies.map((e) => e.x);
}

describe('weapon data', () => {
  it('carries the three staffs the plan names, with one mechanic each', () => {
    expect([...weaponIds]).toEqual(['ember', 'storm', 'frost']);
    expect(weaponDef('ember').splash?.radius).toBeGreaterThan(0);
    expect(weaponDef('storm').chain?.count).toBe(2);
    expect(weaponDef('storm').projectileSpeed).toBeGreaterThan(weaponDef('ember').projectileSpeed);
    expect(weaponDef('frost').slow?.factor).toBe(0.5);
    expect(weaponDef('frost').slow?.shatterOnKill).toBe(true);
    expect(weaponDef('frost').damage).toBeLessThan(weaponDef('ember').damage);
  });

  it('defaults a squad with no staff to ember', () => {
    expect(weaponOf({})).toBe('ember');
    expect(weaponOf({ weaponId: 'frost' })).toBe('frost');
  });

  it('ranks a splash and a chain staff by what is standing in front of them', () => {
    const alone = (): number => 0;
    const packed = (): number => 2;
    // Only within a chain's reach, not within a splash's.
    const spread = (_radius: number, edgeToEdge: boolean): number => (edgeToEdge ? 0 : 2);

    // On an empty road the staff gates are worth taking for raw damage: the
    // run starts on the splash staff, which is the one built for a crowd.
    expect(expectedDps('storm', alone, 0.2)).toBeGreaterThan(expectedDps('ember', alone, 0.2));
    expect(expectedDps('frost', alone, 0.2)).toBeGreaterThan(expectedDps('frost', alone, 0));
    // Shoulder to shoulder the splash staff earns its keep, and beats the slow.
    expect(expectedDps('ember', packed, 0.2)).toBeGreaterThan(expectedDps('ember', alone, 0.2));
    expect(expectedDps('ember', packed, 0.2)).toBeGreaterThan(expectedDps('frost', packed, 0.2));
    // Spread out, only the chain reaches, and it pulls further ahead.
    expect(expectedDps('storm', spread, 0.2)).toBeGreaterThan(expectedDps('ember', spread, 0.2));
  });
});

describe('ember splash', () => {
  const rows = [
    row(
      24,
      [null, null, null],
      blocks({ kind: 'grunt', lane: 0, units: 60 }, { kind: 'grunt', lane: 1, units: 4 }),
    ),
  ];

  it('spills damage onto the block next to the one it hit', () => {
    const run = runOf(level({ startCount: SMALL, rows }));
    const events = play(run, 2, 0);

    const neighbour = run.state.enemies[1];
    expect(neighbour?.x).toBe(2);
    // Nothing shot at it: a squad of three fires straight up the middle lane.
    expect(lanes(run.state.enemies)).toEqual([0, 2]);
    expect(neighbour?.hp).toBeLessThan(neighbour?.maxHp ?? 0);
    expect(events.some((e) => e.type === 'splash')).toBe(true);
  });

  it('falls off with distance, so the far block takes less than the near one', () => {
    const spread = [
      row(
        24,
        [null, null, null],
        blocks(
          { kind: 'grunt', lane: 0, units: 60 },
          { kind: 'grunt', lane: 1, units: 4 },
          { kind: 'grunt', lane: -1, units: 30 },
        ),
      ),
    ];
    const run = runOf(level({ startCount: SMALL, rows: spread }));
    play(run, 2, 0);

    const near = run.state.enemies[2];
    const far = run.state.enemies[1];
    // The wider block reaches further toward the middle, so it takes more.
    if (near === undefined || far === undefined) throw new Error('missing block');
    expect(near.maxHp - near.hp).toBeGreaterThan(far.maxHp - far.hp);
  });

  it('does not splash under a staff that has no splash', () => {
    const run = runOf(level({ startCount: SMALL, rows: [staffRow(1, 'frost'), ...rows] }));
    const events = play(run, 2, 0);

    expect(run.state.squad.weaponId).toBe('frost');
    const neighbour = run.state.enemies[1];
    expect(neighbour?.hp).toBe(neighbour?.maxHp);
    expect(events.some((e) => e.type === 'splash')).toBe(false);
  });
});

describe('storm chain', () => {
  // A chain hops from the block it just hit, so the three stand in a line the
  // arc can walk: middle lane, right lane, and two metres behind that one.
  const rows = [
    staffRow(1, 'storm'),
    row(
      24,
      [null, null, null],
      blocks({ kind: 'grunt', lane: 0, units: 60 }, { kind: 'grunt', lane: 1, units: 2 }),
    ),
    row(26, [null, null, null], blocks({ kind: 'grunt', lane: 1, units: 2 })),
  ];

  it('jumps to two more blocks, each hit once per chain', () => {
    const run = runOf(level({ startCount: SMALL, rows }));
    const events = play(run, 1.4, 0);

    const chains = events.filter((e): e is Extract<SimEvent, { type: 'chain' }> => e.type === 'chain');
    expect(chains.length).toBeGreaterThan(0);
    for (const link of chains) expect(link.from).not.toBe(link.to);
    // Both side blocks took damage without being shot at directly.
    expect(hpOf(run.state.enemies, 2)).toBeLessThan(6);
    expect(hpOf(run.state.enemies, 3)).toBeLessThan(6);
  });

  it('chains at a fraction of the shot, not at full damage', () => {
    const pair = [
      staffRow(1, 'storm'),
      row(
        24,
        [null, null, null],
        blocks({ kind: 'grunt', lane: 0, units: 200 }, { kind: 'grunt', lane: 1, units: 200 }),
      ),
    ];
    const run = runOf(level({ startCount: SMALL, rows: pair }));
    play(run, 2, 0);

    const target = run.state.enemies[0];
    const chained = run.state.enemies[1];
    if (target === undefined || chained === undefined) throw new Error('missing block');
    const direct = target.maxHp - target.hp;
    const jumped = chained.maxHp - chained.hp;
    expect(jumped).toBeGreaterThan(0);
    expect(jumped).toBeLessThan(direct);
  });

  it('reaches nothing when the blocks stand too far apart', () => {
    const far = [
      staffRow(1, 'storm'),
      row(24, [null, null, null], blocks({ kind: 'grunt', lane: 0, units: 60 })),
      row(60, [null, null, null], blocks({ kind: 'grunt', lane: 1, units: 60 })),
    ];
    const run = runOf(level({ startCount: SMALL, rows: far }));
    const events = play(run, 1.4, 0);
    expect(events.some((e) => e.type === 'chain')).toBe(false);
  });
});

describe('frost slow', () => {
  const rows = [staffRow(1, 'frost'), row(30, [null, null, null], blocks({ kind: 'brute', lane: 0, units: 40 }))];

  it('holds a block at half speed and says so once', () => {
    const run = runOf(level({ startCount: SMALL, rows }));
    const events = play(run, 3, 0);

    const block = run.state.enemies[0];
    if (block === undefined) throw new Error('missing block');
    expect(block.slowUntil ?? 0).toBeGreaterThan(run.state.time);
    expect(effectiveSpeed(block, run.state.time)).toBeCloseTo(block.speed * 0.5, 9);
    // One announcement per slow, not one per shot.
    const slows = events.filter((e) => e.type === 'enemySlowed');
    expect(slows.length).toBe(1);
  });

  it('wears off, and the block walks at its own speed again', () => {
    const run = runOf(level({ startCount: SMALL, rows }));
    play(run, 3, 0);
    const block = run.state.enemies[0];
    if (block === undefined) throw new Error('missing block');
    const seconds = weaponDef('frost').slow?.seconds ?? 0;
    expect(effectiveSpeed(block, (block.slowUntil ?? 0) + seconds)).toBe(block.speed);
  });

  it('shatters a block that dies while slowed', () => {
    const small = [staffRow(1, 'frost'), row(30, [null, null, null], blocks({ kind: 'grunt', lane: 0, units: 4 }))];
    const run = runOf(level({ startCount: 20, rows: small }));
    const events = play(run, 4, 0);

    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(events.some((e) => e.type === 'enemyShattered')).toBe(true);
  });

  it('leaves an unslowed block to fall over normally', () => {
    const small = [row(30, [null, null, null], blocks({ kind: 'grunt', lane: 0, units: 4 }))];
    const run = runOf(level({ startCount: 20, rows: small }));
    const events = play(run, 4, 0);

    expect(events.some((e) => e.type === 'enemyKilled')).toBe(true);
    expect(events.some((e) => e.type === 'enemyShattered')).toBe(false);
  });
});

describe('staff gates', () => {
  it('swaps the staff for the rest of the run and says what changed', () => {
    const run = runOf(level({ startCount: 10, rows: [staffRow(2, 'storm')] }));
    const events = play(run, 2, 0);

    const swap = events.find((e) => e.type === 'weaponChanged');
    if (swap?.type !== 'weaponChanged') throw new Error('no staff swap');
    expect(swap.from).toBe('ember');
    expect(swap.to).toBe('storm');
    expect(run.state.squad.weaponId).toBe('storm');
    expect(run.state.squad.damage).toBeCloseTo(weaponDef('storm').damage, 9);
    expect(run.state.squad.count).toBe(10);
  });

  it('says nothing when the gate hands over the staff already in hand', () => {
    const run = runOf(level({ startCount: 10, rows: [staffRow(2, 'ember')] }));
    const events = play(run, 2, 0);
    expect(events.some((e) => e.type === 'weaponChanged')).toBe(false);
    expect(events.some((e) => e.type === 'gatePassed')).toBe(true);
  });

  it('is solid glass: shots pass through it and never move it', () => {
    const run = runOf(level({ startCount: 40, rows: [staffRow(24, 'frost')] }));
    play(run, 3, 0);
    const gate = run.state.gates[0];
    expect(gate?.hits).toBe(0);
    expect(gate?.value).toBe(0);
  });

  it('changes what the squad fires: frost projectiles are slower than storm', () => {
    expect(weaponDef('frost').projectileSpeed).toBeLessThan(weaponDef('storm').projectileSpeed);
  });
});

/**
 * Splash and chain kill blocks the target list has not been told about: only a
 * *direct* kill clears a target's `live` flag, so a block killed as a
 * neighbour stays shootable for the rest of the step. That is deliberate — the
 * damage economy is balanced around a shot being absorbed by whatever is in
 * front of it — but a corpse must only die once, because everything downstream
 * of `enemyKilled` (ragdolls, the kill sound, hit-stop) fires again if it does
 * not. Two of the 715 kills in this sweep did before Phase D.
 */
describe('death events', () => {
  it('reports each block dead exactly once, across the whole campaign', () => {
    for (let index = 1; index <= levelCount; index++) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const run = new Run(generateLevel(index, levelConfig(index), seed), balance);
        const bot = createBot('greedy', seed * 7919 + index);
        const dead = new Set<number>();
        const twice: number[] = [];

        for (let step = 0; step < 240 * 60 && run.state.status === 'running'; step++) {
          run.setTargetX(bot(run.state));
          for (const event of run.tick(1 / 60)) {
            if (event.type !== 'enemyKilled') continue;
            if (dead.has(event.enemyId)) twice.push(event.enemyId);
            dead.add(event.enemyId);
          }
        }

        const where = `L${String(index)} s${String(seed)}`;
        expect(`${where}: ${twice.join(',')}`).toBe(`${where}: `);
      }
    }
  });
});
