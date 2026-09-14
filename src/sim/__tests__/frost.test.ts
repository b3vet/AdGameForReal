/**
 * Frostfell's twenty levels (D49), and the promise that came with them: the
 * twenty levels before them did not move.
 *
 * The second half is the important one. Levels 21 to 40 were written as new
 * entries in `levels.json` and the generator learned two new row kinds, and
 * neither of those may reach back into the campaign Milestone 6 balanced. The
 * goldens in `./regression.test.ts` say the *runs* on levels 1 to 3 replay; the
 * table below says the *recipes* of all twenty are the bytes they were.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { generateLevel } from '../level';
import { playLevel } from './harness';
import { Run } from '../Run';
import { balance, levelConfig, levelCount, levels } from '@/data';

const SEEDS = [1, 2, 3];

/** Where the first biome ends and Frostfell begins. */
const BIOME_1 = 20;

/** FNV-1a, 32 bit — the same hash `./regression.test.ts` records runs with. */
function hashOf(text: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * `levels.json` entries 1 to 20, hashed one by one so a failure names the level
 * that moved rather than saying "the file changed".
 *
 * Recorded at the end of Milestone 6 and not re-recorded since. Milestone 7
 * adds `biome`, `chargerRows`, `shieldRows` and `boss.kind` to the schema, and
 * all four are optional for exactly this reason: an absent field is the old
 * behaviour, so the twenty recipes that predate Frostfell are untouched.
 */
const BIOME_1_CONFIGS: readonly string[] = [
  'e52737ba',
  '5cb1bebb',
  '80f874b6',
  '2ee5b0a1',
  'eb077311',
  'e72ee4ad',
  '734a9391',
  'fffe58a5',
  '649955a5',
  'b28d8df5',
  '396c4982',
  '28d937e3',
  'ac15e5c8',
  '94fc0aca',
  '1ab0f746',
  '71830889',
  'e5367ed4',
  'edb02359',
  'f3f54983',
  'ebf3f0ea',
];

describe('the first twenty levels', () => {
  it('carry exactly the recipes they were balanced with', () => {
    const moved: string[] = [];
    for (let index = 1; index <= BIOME_1; index++) {
      const hash = hashOf(JSON.stringify(levels[index - 1]));
      if (hash !== BIOME_1_CONFIGS[index - 1]) moved.push(`  L${String(index)}: '${hash}',`);
    }
    expect(moved.join('\n')).toBe('');
  });

  it('name no biome and no boss kind, so they are still meadow and still the demon', () => {
    for (let index = 1; index <= BIOME_1; index++) {
      const config = levelConfig(index);
      const where = `L${String(index)}`;
      expect(`${where} biome ${String(config.biome)}`).toBe(`${where} biome undefined`);
      expect(`${where} boss ${String(config.boss.kind)}`).toBe(`${where} boss undefined`);
      expect(`${where} charger ${String(config.chargerRows)}`).toBe(`${where} charger undefined`);
      expect(`${where} shield ${String(config.shieldRows)}`).toBe(`${where} shield undefined`);
      // ...and the generator resolves the absent fields to the old behaviour.
      const level = generateLevel(index, config, 1);
      expect(`${where} gen ${String(level.biome)}/${String(level.bossId)}`).toBe(
        `${where} gen meadow/demon`,
      );
    }
  });
});

describe('Frostfell', () => {
  it('runs from 21 to 40 on the frost biome behind the Rime Fiend', () => {
    expect(levelCount).toBe(40);
    for (let index = BIOME_1 + 1; index <= levelCount; index++) {
      const config = levelConfig(index);
      const where = `L${String(index)}`;
      expect(`${where} ${String(config.biome)}/${String(config.boss.kind)}`).toBe(
        `${where} frost/rime`,
      );
      const level = generateLevel(index, config, 1);
      expect(`${where} gen ${String(level.biome)}/${String(level.bossId)}`).toBe(
        `${where} gen frost/rime`,
      );
      expect(level.boss.kind).toBe('rime');
      // Every level's seed is its own, or two levels would deal the same road.
      const others = levels.filter((other) => other.seed === config.seed);
      expect(`${where} seeds ${String(others.length)}`).toBe(`${where} seeds 1`);
    }
  });

  it('stands chargers from 21 and shielded brutes from 23', () => {
    // The two kinds arrive two levels apart so the player meets one at a time
    // (D49); after that they are mixed with the brute and horde rows.
    let chargerLevels = 0;
    let shieldLevels = 0;
    for (let index = BIOME_1 + 1; index <= levelCount; index++) {
      const config = levelConfig(index);
      const chargers = config.chargerRows ?? 0;
      const shields = config.shieldRows ?? 0;
      const where = `L${String(index)}`;
      expect(`${where} chargers ${String(chargers)}`).not.toBe(`${where} chargers 0`);
      if (chargers > 0) chargerLevels++;
      if (shields > 0) shieldLevels++;
      if (index < 23) expect(`${where} shields ${String(shields)}`).toBe(`${where} shields 0`);
      // The threat rows are one pool. A level that books more of them than it
      // has does not fail — `dealRowKinds` simply drops the overflow — so it
      // has to be caught here, where the recipe is written.
      const threats = config.rows - config.gateRows;
      const booked = config.hordeRows + config.bruteRows + chargers + shields;
      expect(`${where} books ${String(booked)} of ${String(threats)} threat rows`).toBe(
        `${where} books ${String(Math.min(booked, threats))} of ${String(threats)} threat rows`,
      );
    }
    expect(chargerLevels).toBe(20);
    expect(shieldLevels).toBeGreaterThanOrEqual(14);
  });

  it('actually deals both kinds onto the road', () => {
    let chargers = 0;
    let shields = 0;
    for (let index = BIOME_1 + 1; index <= levelCount; index++) {
      for (const seed of SEEDS) {
        for (const row of generateLevel(index, levelConfig(index), seed).rows) {
          for (const enemy of row.enemies) {
            if (enemy.kind === 'charger') chargers++;
            if (enemy.kind === 'shieldBrute') shields++;
          }
        }
      }
    }
    expect(chargers).toBeGreaterThan(60);
    expect(shields).toBeGreaterThan(40);
  });

  it('never deals either kind on the twenty levels before them', () => {
    for (let index = 1; index <= BIOME_1; index++) {
      for (const seed of SEEDS) {
        for (const row of generateLevel(index, levelConfig(index), seed).rows) {
          for (const enemy of row.enemies) {
            expect(`L${String(index)} s${String(seed)} ${enemy.kind}`).toBe(
              `L${String(index)} s${String(seed)} ${enemy.kind === 'brute' ? 'brute' : 'grunt'}`,
            );
          }
        }
      }
    }
  });

  it('plays every one of them to an end with the reference bot', () => {
    // Not "wins" — that is `./balance.test.ts`'s band, and the milestone levels
    // are not meant to fall bare. This is the weaker and more basic promise:
    // the level generates, the run terminates, and nothing on the new road can
    // stall it.
    for (let index = BIOME_1 + 1; index <= levelCount; index++) {
      for (const seed of SEEDS) {
        const result = playLevel(index, seed, 'greedy');
        const where = `L${String(index)} s${String(seed)}`;
        // A run that reaches the harness ceiling is a stalemate. It is not a
        // hypothetical: the Rime Fiend charges *through* the column, and while
        // it stood behind the front the target lists dropped it for good, so
        // every frost level ran until the crowd starved.
        expect(`${where} ${result.seconds.toFixed(0)}s`).toBe(
          `${where} ${Math.min(result.seconds, 200).toFixed(0)}s`,
        );
      }
    }
  }, 300_000);

  it('replays a frost run step for step from the same inputs', () => {
    // The determinism contract (CLAUDE.md) over everything Frostfell adds: a
    // charger's lane pick, a shield's arithmetic and the boss's charge clock
    // are all functions of the state and the fixed step, and none of them
    // reaches for a clock or an unseeded random.
    for (const index of [21, 25, 33]) {
      const config = levelConfig(index);
      const seed = 3;
      const a = new Run(generateLevel(index, config, seed), balance);
      const b = new Run(generateLevel(index, config, seed), balance);
      const botA = createBot('greedy', seed);
      const botB = createBot('greedy', seed);
      for (let step = 0; step < 900; step++) {
        a.setTargetX(botA(a.state));
        a.tick(1 / 60);
        b.setTargetX(botB(b.state));
        b.tick(1 / 60);
      }
      expect(`L${String(index)} ${JSON.stringify(b.state)}`).toBe(
        `L${String(index)} ${JSON.stringify(a.state)}`,
      );
    }
  }, 120_000);
});
