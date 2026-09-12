/**
 * Not a test: a tuning readout, skipped unless `TUNE=1`. Kept next to the
 * balance test so the numbers in the report can be reproduced.
 */

import { writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { playLevel } from './harness';
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
  });
});
