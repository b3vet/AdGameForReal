/**
 * Not a test: a tuning readout, skipped unless `TUNE=1`. Kept next to the
 * balance test so the numbers in the report can be reproduced.
 */

import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { playLevel } from './harness';
import { playerHolding } from './fixtures';
import { runCampaign } from '../campaign';
import { squadCurve } from '../curve';
import { generateLevel } from '../level';
import { laneShareOf, streamPressure } from '../pressure';
import { levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];
const ON = process.env.TUNE === '1';

describe.skipIf(!ON)('tuning readout', () => {
  it('prints the campaign', () => {
    const lines: string[] = [];
    const losses: string[] = [];
    lines.push(
      'L  rows gate  peak  target  surv  boss  leak%  lost  streams  press  count  hp  win',
    );
    for (let level = 1; level <= levelCount; level++) {
      const config = levelConfig(level);
      let peak = 0;
      let survivors = 0;
      let boss = 0;
      let wins = 0;
      let leakShare = 0;
      let leaked = 0;
      let streams = 0;
      let pressure = 0;
      let count = 0;
      let hp = 0;

      for (const seed of SEEDS) {
        const result = playLevel(level, seed, 'greedy');
        peak += result.peakCount;
        survivors += result.survivors;
        boss += result.bossSeconds;
        if (result.status === 'won') wins++;
        else {
          // Which seed broke, and how far it got: a level that dies on the road
          // and one that dies to the boss want opposite tuning.
          losses.push(
            `L${String(level)} s${String(seed)} peak ${String(result.peakCount)}` +
              ` boss ${result.bossSeconds.toFixed(1)}s left ${result.bossHpLeft.toFixed(0)}` +
              ` count@boss ${String(result.countAtBoss)} leaked ${String(result.leaked)}`,
          );
        }
        leakShare += result.leakShare * result.streamsSeen;
        leaked += result.leaked;

        const generated = generateLevel(level, config, seed);
        generated.rows.forEach((row, index) => {
          for (const def of row.streams ?? []) {
            streams++;
            count += def.count;
            hp += def.hpPerEnemy;
            pressure += streamPressure(
              def,
              squadCurve(config, index),
              (row.streams ?? []).length > 1 ? 'horde' : 'single',
            );
          }
        });
      }

      const n = SEEDS.length;
      lines.push(
        [
          String(level).padStart(2),
          String(config.rows).padStart(4),
          String(config.gateRows).padStart(4),
          (peak / n).toFixed(0).padStart(6),
          String(config.peakTarget).padStart(6),
          (survivors / Math.max(1, peak)).toFixed(2).padStart(6),
          (boss / n).toFixed(1).padStart(5),
          ((leakShare / Math.max(1, streams)) * 100).toFixed(1).padStart(6),
          (leaked / n).toFixed(0).padStart(5),
          (streams / n).toFixed(1).padStart(7),
          (pressure / Math.max(1, streams)).toFixed(2).padStart(6),
          (count / Math.max(1, streams)).toFixed(0).padStart(6),
          (hp / Math.max(1, streams)).toFixed(0).padStart(4),
          `${String(wins)}/${String(n)}`.padStart(5),
          `share=${laneShareOf('single').toFixed(2)}`,
        ].join(' '),
      );
    }
    lines.push('- losses -', ...(losses.length > 0 ? losses : ['(none)']));
    writeFileSync(process.env.TUNE_OUT ?? '/tmp/tune.txt', `${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(0);
  }, 900_000);
});

/**
 * The human bot's own table (D45), which is what Phase C2 tunes against:
 * first-attempt clear rate, what a clear walks away with, how long the boss
 * takes, and what the fences cut off on the way.
 *
 * `TUNE_SEEDS` and `TUNE_LEVELS` narrow it while a dial is being turned; the
 * numbers in the milestone log are the full ten seeds over all twenty levels.
 */
const HUMAN_SEEDS = Number(process.env.TUNE_SEEDS ?? '10');
const HUMAN_LEVELS = Number(process.env.TUNE_LEVELS ?? String(levelCount));

describe.skipIf(!ON)('human readout', () => {
  it('prints the human campaign', () => {
    const seeds = Array.from({ length: HUMAN_SEEDS }, (_, i) => i + 1);
    const lines: string[] = [];
    lines.push(
      'L   win  surv  boss  peak  target arena @boss bl hp%  made  units rejoin  back  wipe arena',
    );
    for (let level = 1; level <= HUMAN_LEVELS; level++) {
      lines.push(humanLine(level, seeds));
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    writeFileSync(process.env.TUNE_OUT ?? '/tmp/human.txt', `${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(0);
  }, 900_000);
});

function humanLine(level: number, seeds: readonly number[]): string {
  let wins = 0;
  let share = 0;
  let boss = 0;
  let peak = 0;
  let made = 0;
  let units = 0;
  let rejoined = 0;
  let unitsBack = 0;
  let wiped = 0;
  let arena = 0;
  let reached = 0;
  let atBoss = 0;
  let hpLeft = 0;
  let bossLosses = 0;
  for (const seed of seeds) {
    const result = playLevel(level, seed, 'human');
    peak += result.peakCount;
    made += result.stragglers.groups;
    units += result.stragglers.units;
    rejoined += result.stragglers.rejoined;
    unitsBack += result.stragglers.unitsRejoined;
    wiped += result.stragglers.wiped;
    arena += result.stragglers.atArena;
    if (result.countAtBoss > 0) {
      reached++;
      atBoss += result.countAtBoss;
    }
    if (result.status === 'won') {
      wins++;
      share += result.survivors / Math.max(1, result.peakCount);
      boss += result.bossSeconds;
    } else if (result.countAtBoss > 0) {
      bossLosses++;
      hpLeft += result.bossHpLeft / Math.max(1, levelConfig(level).boss.hp);
    }
  }
  const n = seeds.length;
  return [
    String(level).padStart(2),
    `${String(wins)}/${String(n)}`.padStart(6),
    (share / Math.max(1, wins)).toFixed(2).padStart(5),
    (boss / Math.max(1, wins)).toFixed(1).padStart(5),
    (peak / n).toFixed(0).padStart(5),
    String(levelConfig(level).peakTarget).padStart(6),
    (reached / n).toFixed(2).padStart(5),
    (atBoss / Math.max(1, reached)).toFixed(0).padStart(6),
    String(bossLosses).padStart(4),
    ((hpLeft / Math.max(1, bossLosses)) * 100).toFixed(0).padStart(5),
    (made / n).toFixed(2).padStart(6),
    (units / n).toFixed(1).padStart(6),
    (rejoined / n).toFixed(2).padStart(7),
    (unitsBack / n).toFixed(1).padStart(7),
    (wiped / n).toFixed(2).padStart(5),
    (arena / n).toFixed(2).padStart(5),
  ].join(' ');
}

/**
 * The milestone levels (D45), measured the two ways the band is written: with
 * nothing bought, and with the set the campaign says the human bot is holding
 * when it first gets there (D46). The sets themselves are printed, because
 * they move whenever the difficulty does and `balance.test.ts` pins them.
 */
describe.skipIf(!ON)('milestone readout', () => {
  it('prints the milestone levels with and without the upgrades of the day', () => {
    const seeds = Array.from({ length: HUMAN_SEEDS }, (_, i) => i + 1);
    const campaign = runCampaign({ bot: 'human', seed: 1 });
    const lines: string[] = [];
    for (const level of MILESTONE_LEVELS) {
      const held = campaign.levels.find((entry) => entry.level === level)?.held;
      const player =
        held === undefined
          ? undefined
          : playerHolding({
              upgrades: held.upgrades,
              staffs: held.staffs,
              evolved: held.evolved,
              wispTier: held.wispTier,
              unlockedLevel: level,
            });
      let bare = 0;
      let armed = 0;
      let armedBoss = 0;
      for (const seed of seeds) {
        if (playLevel(level, seed, 'human').status === 'won') bare++;
        const withKit = playLevel(level, seed, 'human', player);
        if (withKit.status === 'won') {
          armed++;
          armedBoss += withKit.bossSeconds;
        }
      }
      const n = seeds.length;
      lines.push(
        `L${String(level).padStart(2)} bare ${String(bare)}/${String(n)}` +
          `  armed ${String(armed)}/${String(n)}` +
          `  armed boss ${(armedBoss / Math.max(1, armed)).toFixed(1)}s` +
          `  held ${held === undefined ? '-' : loadoutText(held)}`,
      );
    }
    // Greedy with no upgrades on the milestone levels, for the report.
    for (const level of MILESTONE_LEVELS) {
      let wins = 0;
      for (const seed of seeds) if (playLevel(level, seed, 'greedy').status === 'won') wins++;
      lines.push(`L${String(level).padStart(2)} greedy bare ${String(wins)}/${String(seeds.length)}`);
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(0);
  }, 900_000);
});

const MILESTONE_LEVELS = [7, 10, 15, 20];

function loadoutText(held: {
  upgrades: Record<string, number>;
  staffs: readonly string[];
  evolved: readonly string[];
  wispTier: number;
}): string {
  const rungs = Object.entries(held.upgrades)
    .map(([id, level]) => `${id}${String(level)}`)
    .join(' ');
  const extras = [...held.staffs, ...held.evolved.map((id) => `${id}+`)];
  if (held.wispTier > 0) extras.push(`wisp${String(held.wispTier)}`);
  return `${rungs}${extras.length > 0 ? ` | ${extras.join(' ')}` : ''}`;
}
