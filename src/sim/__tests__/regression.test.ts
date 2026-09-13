/**
 * The no-upgrade invariant (D35).
 *
 * Two halves. First, a state hash through a whole greedy run on levels 1 to 3,
 * against golden values captured from the sim as it stands today: those levels
 * carry no walls (D32 starts them at level 4), so a run there must still be the
 * run the campaign was balanced as, whatever the player layer adds around it.
 * Second, the same hash with an explicit empty `PlayerState` against no player
 * at all, on every level of the twenty: a player who has bought nothing has to be the identity, or the bands
 * measured without one mean nothing.
 *
 * A golden that moves is either a bug in the player path or a deliberate design
 * change, and the second kind is written down in the milestone log rather than
 * re-recorded here in silence.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { generateLevel } from '../level';
import { emptyPlayer } from '../player';
import { Run } from '../Run';
import { balance, levelConfig, levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

const SEEDS = [1, 2, 3, 4, 5];
const DT = 1 / 60;
const MAX_STEPS = Math.round(240 / DT);

/** Sampled this often, so the hash covers the whole run and not only its end. */
const SAMPLE_EVERY = 30;

/**
 * Levels 1 to 3, greedy, seeds 1 to 5.
 *
 * Re-captured for D42, the lane column, as Phase B re-captured them for D37.
 * Three deliberate changes move every one of them and none of them is subtle:
 * the crowd is one lane wide instead of the road's full 4.4 m, so every unit
 * stands somewhere else and the whole column's fire lands in one lane; the
 * spacing floor and row gap changed with it (0.28 to 0.25, 0.8 to 0.7); and
 * the balance was re-measured against that concentrated fire — `dpsTrim` back
 * to 0.38, `enrageAt` back to 0.3 and the boss's stomp share 0.06 to 0.07,
 * because a column the blocks can be steered around gives the road almost
 * nothing to take and the survivor share is settled at the arena.
 *
 * The run these hashes describe is the same campaign re-measured, not a
 * different one: the bands in `balance.test.ts` are what says so.
 */
const GOLDEN: Readonly<Record<string, string>> = {
  '1:1': '4640811a',
  '1:2': '8734c519',
  '1:3': '8beaecc2',
  '1:4': 'f2de965e',
  '1:5': 'db8e3e7a',
  '2:1': '0e026830',
  '2:2': '66556d4f',
  '2:3': 'ee07f21d',
  '2:4': 'e35dbc77',
  '2:5': '58eef35b',
  '3:1': '6ca03efa',
  '3:2': 'fc58c0c2',
  '3:3': '7d4ed62e',
  '3:4': 'bd79d07b',
  '3:5': 'b6f76ec1',
};

/** FNV-1a, 32 bit. Any stable hash would do; this one is short enough to read. */
function hashOf(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function round(value: number): string {
  return (Math.round(value * 1e6) / 1e6).toString();
}

function runHash(levelIndex: number, seed: number, player?: PlayerState): string {
  const level = generateLevel(levelIndex, levelConfig(levelIndex), seed, player);
  const run = new Run(level, balance, player);
  const bot = createBot('greedy', seed * 7919 + levelIndex);

  const parts: string[] = [];
  let steps = 0;
  while (run.state.status === 'running' && steps < MAX_STEPS) {
    run.setTargetX(bot(run.state));
    run.tick(DT);
    steps++;
    if (steps % SAMPLE_EVERY !== 0) continue;

    const state = run.state;
    let alive = 0;
    for (const enemy of state.enemies) if (enemy.alive) alive++;
    let killed = 0;
    let leaked = 0;
    for (const stream of state.streams) {
      killed += stream.killed;
      leaked += stream.leaked;
    }
    parts.push(
      [
        steps,
        state.squad.count,
        round(state.squad.x),
        round(state.squad.z),
        round(state.squad.fireRateBonus),
        state.squad.weaponId ?? '',
        alive,
        killed,
        leaked,
        round(state.boss?.hp ?? 0),
        state.projectiles.length,
      ].join(','),
    );
  }

  const state = run.state;
  parts.push(
    `end:${state.status},${String(state.survivors)},${String(state.peakCount)},${String(steps)}`,
  );
  return hashOf(parts.join('|'));
}

describe('no-upgrade regression', () => {
  it('replays the recorded run on the levels the design did not touch', () => {
    for (let level = 1; level <= 3; level++) {
      for (const seed of SEEDS) {
        const key = `${String(level)}:${String(seed)}`;
        expect(`${key} ${runHash(level, seed)}`).toBe(`${key} ${String(GOLDEN[key])}`);
      }
    }
  }, 120_000);

  it('makes a player with nothing bought the identity, on every level', () => {
    const nothing = emptyPlayer();
    for (let level = 1; level <= levelCount; level++) {
      for (const seed of SEEDS) {
        const where = `L${String(level)} s${String(seed)}`;
        expect(`${where} ${runHash(level, seed, nothing)}`).toBe(`${where} ${runHash(level, seed)}`);
      }
    }
  }, 300_000);

  it('replays the same run from the same inputs, on all twenty levels', () => {
    // Determinism is the contract the whole balance suite rests on (CLAUDE.md):
    // fixed step, seeded RNG, no clock. Two runs of the same level with the
    // same player and the same steering are the same run, step for step.
    for (let level = 1; level <= levelCount; level++) {
      const config = levelConfig(level);
      const seed = 3;
      const a = new Run(generateLevel(level, config, seed), balance);
      const b = new Run(generateLevel(level, config, seed), balance);
      const botA = createBot('greedy', seed);
      const botB = createBot('greedy', seed);
      for (let step = 0; step < 900; step++) {
        a.setTargetX(botA(a.state));
        a.tick(DT);
        b.setTargetX(botB(b.state));
        b.tick(DT);
      }
      expect(`L${String(level)} ${JSON.stringify(b.state)}`).toBe(
        `L${String(level)} ${JSON.stringify(a.state)}`,
      );
    }
  }, 120_000);

  it('generates the same level with an empty player as with none at all', () => {
    const nothing = emptyPlayer();
    for (let level = 1; level <= levelCount; level++) {
      for (const seed of SEEDS) {
        const config = levelConfig(level);
        expect(JSON.stringify(generateLevel(level, config, seed, nothing))).toBe(
          JSON.stringify(generateLevel(level, config, seed)),
        );
      }
    }
  });
});
