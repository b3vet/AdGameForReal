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
 * Re-captured for Milestone 6 Phase C2 — the difficulty retune (D45) — as Phase
 * A re-captured them for the crowd as agents (D43), Milestone 5 Phase B for D37
 * and the lane column for D42. Every one of them moves, and the reasons are the
 * retune itself:
 *
 *   - a gate row fills all three lanes nine times in ten instead of two in ten
 *     (`rows.ts`), so almost every row the campaign deals is a different row,
 *     and a `fireRate` or a second curse is a second grower more often;
 *   - the last row before the arena is never a gate row (`rowKinds.ts`), which
 *     re-orders the tail of every level;
 *   - a curse the squad is not shooting grows while the crowd walks up to it
 *     (`gates.ts`), so the number on a red panel when it is passed is not the
 *     number it was generated with — from level 4, so not on these three, but
 *     the same commit moves them;
 *   - the boss shoves the crowd it is standing over (`crowdObstacles.ts`),
 *     which moves where people are standing in the arena and therefore which of
 *     them a stomp takes;
 *   - levels 1 to 3 carry new boss hp and bite from the retune itself.
 *
 * Re-captured once more for the C2 follow-up, for one reason on top of those:
 * the boss walks the squad down now. `enemies.boss.speed` is 1.75 rather than
 * 0.55, so it reaches `enemies.contactDistance` 11.9 seconds into the fight
 * instead of 37.8 — past the end of any fight that was going to be won — and
 * `contactShare`, which had never fired in the history of the game, is a live
 * unit sink for the second half of every arena. Levels 1 to 3 also carry the
 * follow-up's boss hp, bite and river density.
 *
 * What did *not* change is the shape of the contract: the same runs, hashed the
 * same way. The second half of the file — a player who has bought nothing being
 * the identity, on every level — is what these goldens are really guarding, and
 * the bands in `balance.test.ts` are what says the campaign they describe is the
 * campaign that was measured.
 */
const GOLDEN: Readonly<Record<string, string>> = {
  '1:1': '1da6466a',
  '1:2': '20d75661',
  '1:3': 'd17d1e4b',
  '1:4': '9a95ba94',
  '1:5': 'c73ba3ee',
  '2:1': '46b489a8',
  '2:2': '910a937b',
  '2:3': '68b71f2e',
  '2:4': 'b6077425',
  '2:5': 'b3c4f859',
  '3:1': '1c7a47da',
  '3:2': '729e0872',
  '3:3': '9df96959',
  '3:4': '7708fdc8',
  '3:5': 'e76f1d7c',
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

/**
 * Levels 21 to 23, greedy, seeds 1 to 5: the first three levels of Frostfell
 * (D49), captured when Phase B built them.
 *
 * Their reason for existing is the opposite of the table above. Those goldens
 * guard a road that must never move; these are a *baseline* for one that has
 * just been made, and they cover the three things the biome adds on the levels
 * that first stand them — level 21 a charger row, level 23 a shielded brute as
 * well, and all three the Rime Fiend and its lane charge. A change to any of
 * the new kinds that was not meant to reach the campaign shows up here.
 *
 * Re-captured once at the end of Phase D, for one reason: the twenty recipes
 * these three are dealt from were re-fitted. Phase B sized them for a hand that
 * had bought nothing and the bands are measured on the armed one (D46, D49), so
 * the Rime Fiend's hit points are about half again what they were, `bite` is
 * heavier, and each level gives up two to five of its guarded gate rows. Levels
 * 21 to 23 also carry the stacked-fence rule, which runs from level 1 now.
 *
 * Levels 1 to 20 are untouched by all of it *as recipes*, which
 * `./frost.test.ts` says, and the table above says their runs on 1 to 3 replay
 * byte for byte.
 *
 * Re-captured once more at the end of Milestone 8's balance pass, for 21 and 22
 * only — 23 is byte-identical and is the control. The reason is the value model
 * the campaign shopper gained (D46, `../campaignShop.ts`): ranked by output per
 * coin, the Yard is bought in a different order, so the kit the campaign holds
 * across Frostfell is one rung of `damage` and `gateBonus` stronger and one of
 * `startCount` and `bossDamage` weaker than the lockstep shopper's was. Three
 * ordinary levels walked over the armed ceiling at it and one boss fight ran
 * long, so ten of the twenty recipes were re-fitted — `bite` on 21, 22, 27, 28,
 * 29, 32, 33, 34, 37 and 38, with `hpScale` and `streamDensity` on 22 — and two
 * of the ten are these. The bands they were fitted to are the same ones D49 set.
 *
 * And twice on two seeds of level 22 by the follow-up, which gave storm's arc a
 * falloff and a carry so that its two lower evolutions had something to buy
 * (`../effects.ts`). A player with nothing bought still carries ember — but
 * Frostfell roads hand out staff gates, so a bare run that walks through one is
 * a run whose arc changed. Everything that does not pick a staff up off the
 * road, which is the whole of levels 1 to 3 and thirteen of these fifteen, is
 * byte-identical.
 */
const FROST_GOLDEN: Readonly<Record<string, string>> = {
  '21:1': '46c70cce',
  '21:2': 'f609c7fb',
  '21:3': '7d99c729',
  '21:4': '436aae17',
  '21:5': '7791b9b6',
  '22:1': '64f51834',
  '22:2': '32d7cd90',
  '22:3': 'f2030dca',
  '22:4': '5405b50b',
  '22:5': '112147ca',
  '23:1': '85b4e090',
  '23:2': 'bafc362e',
  '23:3': 'cd09ed97',
  '23:4': '23da271c',
  '23:5': 'e8584c24',
};

describe('no-upgrade regression', () => {
  it('replays the recorded run on the levels the design did not touch', () => {
    // Every mismatch at once, in the shape `GOLDEN` is written in: a golden
    // that moves is re-captured deliberately, and re-capturing it one failure
    // at a time is fifteen runs of the suite.
    const moved: string[] = [];
    for (let level = 1; level <= 3; level++) {
      for (const seed of SEEDS) {
        const key = `${String(level)}:${String(seed)}`;
        const hash = runHash(level, seed);
        if (hash !== GOLDEN[key]) moved.push(`  '${key}': '${hash}',`);
      }
    }
    expect(moved.join('\n')).toBe('');
  }, 120_000);

  it('replays the recorded run on the first three levels of Frostfell', () => {
    const moved: string[] = [];
    for (let level = 21; level <= 23; level++) {
      for (const seed of SEEDS) {
        const key = `${String(level)}:${String(seed)}`;
        const hash = runHash(level, seed);
        if (hash !== FROST_GOLDEN[key]) moved.push(`  '${key}': '${hash}',`);
      }
    }
    expect(moved.join('\n')).toBe('');
  }, 120_000);

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
