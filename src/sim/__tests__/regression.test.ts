/**
 * The no-upgrade invariant (D35) and the replay contract, on the scripted
 * campaign (document 31, D70) and on the dealt path it left behind.
 *
 * Four halves.
 *
 * First, a state hash through a whole greedy run on levels 1 to 3 and 21 to 23
 * of the campaign as shipped. Through Milestone 9 these were constants in this
 * file, re-captured by hand at every retune (D37, D42, D43, D45, D49, the
 * Milestone 8 shopper, document 29's charge); the history is in the milestone
 * logs. Phase 1 replaced every road they hashed with a script (4.5: "goldens
 * for levels 1 to 3 and 21 to 23 re-captured, with the reason in the log"), so
 * they now live in `./runs.pins.json` and are re-recorded with one command
 * (`./pins.ts`) once the tuning has settled. A golden that moves is either a
 * bug in the player path or a deliberate design change, and the second kind is
 * written down in the milestone log rather than re-recorded in silence.
 *
 * Second, the dealt path, which Phase 1 promised to leave byte for byte: the
 * endless road and the dealt fixtures (`./fixtures.ts`, `dealtLevel`). Its
 * goldens were recorded on Milestone 9's tree (commit 3328d22's parent) and
 * matched on Phase 1's, generation and run alike. The runs are steered by a
 * fixed lane pattern rather than a bot, so they guard the generator and the
 * sim and nothing a bot change may legitimately move. They are never
 * re-recorded by the pin command: a mismatch here is a regression in the dealt
 * path, whatever the campaign's tuning is doing.
 *
 * Third, the same greedy hash with an explicit empty `PlayerState` against no
 * player at all, on every level: a player who has bought nothing has to be the
 * identity, or the bands measured without one mean nothing.
 *
 * Fourth, determinism (CLAUDE.md) on every level: the same inputs, the same
 * run.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { generateEndless } from '../endless';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import { emptyPlayer } from '../player';
import { Run } from '../Run';
import { dealtLevel } from './fixtures';
import { checkPins, hashOf } from './pins';
import { balance, levelConfig, levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

const SEEDS = [1, 2, 3, 4, 5];
const DT = 1 / 60;
const MAX_STEPS = Math.round(240 / DT);

/** Sampled this often, so the hash covers the whole run and not only its end. */
const SAMPLE_EVERY = 30;

/** The levels whose greedy runs are pinned: each biome's first three. */
const PINNED_LEVELS = [1, 2, 3, 21, 22, 23];

function round(value: number): string {
  return (Math.round(value * 1e6) / 1e6).toString();
}

/** One sample of a run's state, in the shape every golden here was written in. */
function sampleOf(run: Run, steps: number): string {
  const state = run.state;
  let alive = 0;
  for (const enemy of state.enemies) if (enemy.alive) alive++;
  let killed = 0;
  let leaked = 0;
  for (const stream of state.streams) {
    killed += stream.killed;
    leaked += stream.leaked;
  }
  return [
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
  ].join(',');
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
    if (steps % SAMPLE_EVERY === 0) parts.push(sampleOf(run, steps));
  }

  const state = run.state;
  parts.push(
    `end:${state.status},${String(state.survivors)},${String(state.peakCount)},${String(steps)}`,
  );
  return hashOf(parts.join('|'));
}

/** Lanes held two and a half seconds each, in this order, over and over. */
const STEER_LANES = [-1, 0, 1, 0, 1, -1];

/** A run with no bot in it: the lane pattern above, for `seconds`. */
function steeredHash(level: LevelDef, seconds: number): string {
  const run = new Run(level, balance);
  const parts: string[] = [];
  const steps = Math.round(seconds / DT);
  for (let step = 0; step < steps && run.state.status === 'running'; step++) {
    const lane = STEER_LANES[Math.floor(step / 150) % STEER_LANES.length] ?? 0;
    run.setTargetX(lane * balance.road.laneWidth);
    run.tick(DT);
    if ((step + 1) % SAMPLE_EVERY === 0) parts.push(sampleOf(run, step));
  }
  const state = run.state;
  parts.push(`end:${state.status},${String(state.survivors)},${String(state.peakCount)}`);
  return hashOf(parts.join('|'));
}

/**
 * The dealt path on Milestone 9's tree: `gen` hashes the generated level, `run`
 * the steered run on it. Dealt levels 1 to 3 and 21 to 23 on seeds 1 to 3 (the
 * first charger, shielded brute and Rime Fiend roads among them), and the
 * endless road on seeds 1 and 2 for 200 s, which reaches its first boss.
 */
const DEALT_GOLDEN: Readonly<Record<string, string>> = {
  'L1:1': 'gen 779f48d7 run 30f2f18e',
  'L1:2': 'gen 711f25dd run 1b5ab48c',
  'L1:3': 'gen 320e4c4a run d601bdea',
  'L2:1': 'gen 393d5545 run 2b387ad8',
  'L2:2': 'gen b471b0f8 run c5b398bd',
  'L2:3': 'gen ef08cdd6 run e742f8c8',
  'L3:1': 'gen 071701c7 run 173d7826',
  'L3:2': 'gen 26031ca9 run c3124e85',
  'L3:3': 'gen d9f36cd6 run 22952303',
  'L21:1': 'gen 54abac90 run 9b79b9e7',
  'L21:2': 'gen 3135f271 run b26c1182',
  'L21:3': 'gen 9e5cd577 run 0f404dc9',
  'L22:1': 'gen 1ea75b14 run 3827e957',
  'L22:2': 'gen f270f938 run d510bf88',
  'L22:3': 'gen c2af5364 run 06003358',
  'L23:1': 'gen f2e03c73 run 462525be',
  'L23:2': 'gen f17bc0ec run 96c9e353',
  'L23:3': 'gen c441564d run c8184273',
  'E:1': 'gen edc0a35b run 90b55903',
  'E:2': 'gen 1236e35b run 9e22d11b',
};

describe('no-upgrade regression', () => {
  it('replays the pinned greedy runs on the first three levels of each biome', () => {
    const measured: Record<string, string> = {};
    for (const level of PINNED_LEVELS) {
      for (const seed of SEEDS) measured[`${String(level)}:${String(seed)}`] = runHash(level, seed);
    }
    expect(checkPins('runs.pins.json', measured)).toBe('');
  }, 240_000);

  it('replays the dealt path byte for byte: the fixtures and the endless road', () => {
    // Every mismatch at once, in the shape the table is written in.
    const moved: string[] = [];
    const check = (key: string, level: LevelDef, seconds: number): void => {
      const now = `gen ${hashOf(JSON.stringify(level))} run ${steeredHash(level, seconds)}`;
      if (now !== DEALT_GOLDEN[key]) moved.push(`  '${key}': '${now}',`);
    };
    for (const index of PINNED_LEVELS) {
      for (const seed of [1, 2, 3]) {
        check(`L${String(index)}:${String(seed)}`, generateLevel(index, dealtLevel(index), seed), 240);
      }
    }
    for (const seed of [1, 2]) check(`E:${String(seed)}`, generateEndless(seed), 200);
    expect(moved.join('\n')).toBe('');
  }, 240_000);

  it('makes a player with nothing bought the identity, on every level', () => {
    const nothing = emptyPlayer();
    for (let level = 1; level <= levelCount; level++) {
      for (const seed of SEEDS) {
        const where = `L${String(level)} s${String(seed)}`;
        expect(`${where} ${runHash(level, seed, nothing)}`).toBe(`${where} ${runHash(level, seed)}`);
      }
    }
  }, 900_000);

  it('replays the same run from the same inputs, on every level', () => {
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
  }, 300_000);

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
