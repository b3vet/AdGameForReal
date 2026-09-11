import { describe, expect, it } from 'vitest';

import { squadCurve } from '../curve';
import { generateLevel } from '../level';
import { dpsPerUnit, expectedStreamDps, sizeStream, streamPressure, streamWindow } from '../pressure';
import type { StreamShape } from '../pressure';
import { balance, levelConfig, levelCount } from '@/data';

const SEEDS = [1, 2, 3, 4, 5];

/** The bands are closed intervals and a solved pressure lands exactly on one. */
const EPS = 1e-9;

/** docs/09-milestone-3-plan.md, "Stream pressure". */
const BANDS: ReadonlyArray<{ to: number; min: number; max: number }> = [
  { to: 3, min: 0.45, max: 0.6 },
  { to: 5, min: 0.65, max: 0.8 },
  { to: 10, min: 0.85, max: 0.95 },
];

function bandOf(level: number): { min: number; max: number } {
  return BANDS.find((band) => level <= band.to) ?? { min: 0.85, max: 0.95 };
}

describe('stream pressure', () => {
  it('measures the window from the first body in range to the last in contact', () => {
    // Bodies appear exactly at projectile range, so "in range" and "spawned"
    // are the same instant; the last one spawns `duration` later and then has
    // the whole spawn gap to close at both speeds together.
    const speed = balance.streams.speed;
    const closing = speed + balance.squad.runSpeed;
    expect(streamWindow(0, speed)).toBeCloseTo(balance.streams.spawnAhead / closing, 9);
    expect(streamWindow(10, speed)).toBeCloseTo(10 + balance.streams.spawnAhead / closing, 9);
    expect(balance.streams.spawnAhead).toBe(balance.projectiles.range);
  });

  it('prices the squad by what a staff really does to a river', () => {
    // The plan's rule: the expected squad dps, through `expectedDps`, so a
    // splash staff is worth what it is worth against bodies standing together.
    expect(dpsPerUnit()).toBeGreaterThan(0);
    expect(expectedStreamDps(100, 'single')).toBeCloseTo(100 * dpsPerUnit(), 9);
    // A horde splits the squad's fire between two lanes, so one of its streams
    // is priced against less of the squad than a lone stream would be.
    expect(expectedStreamDps(100, 'horde')).toBeLessThan(expectedStreamDps(100, 'single'));
  });

  it('builds a stream that lands on the pressure it was asked for', () => {
    for (let level = 1; level <= levelCount; level++) {
      const config = levelConfig(level);
      for (const shape of ['single', 'horde'] as StreamShape[]) {
        for (const duration of [7, 10, 13]) {
          for (const rowIndex of [1, 5, config.rows - 1]) {
            const def = sizeStream(config, rowIndex, 0, shape, duration);
            const realised = streamPressure(def, squadCurve(config, rowIndex), shape);
            const where = `L${String(level)} row ${String(rowIndex)} ${shape}`;
            expect(`${where}: ${realised.toFixed(3)}`).toBe(
              `${where}: ${config.streamPressure.toFixed(3)}`,
            );
          }
        }
      }
    }
  });

  it('keeps every generated stream inside its level band', () => {
    let seen = 0;
    for (let level = 1; level <= levelCount; level++) {
      const band = bandOf(level);
      const config = levelConfig(level);
      for (const seed of SEEDS) {
        const generated = generateLevel(level, config, seed);
        generated.rows.forEach((row, rowIndex) => {
          const streams = row.streams ?? [];
          const shape: StreamShape = streams.length > 1 ? 'horde' : 'single';
          for (const def of streams) {
            seen++;
            const realised = streamPressure(def, squadCurve(config, rowIndex), shape);
            const where = `L${String(level)} s${String(seed)} row ${String(rowIndex)}`;
            const inBand = realised >= band.min - EPS && realised <= band.max + EPS;
            expect(`${where}: ${String(inBand)}`).toBe(
              `${where}: true`,
            );
          }
        });
      }
    }
    expect(seen).toBeGreaterThan(200);
  });

  it('sends more bodies to a bigger squad and keeps the HP per body steady', () => {
    // The density dial is bodies per soldier, which is what makes a leak cost
    // the same share of the squad at eight units and at four hundred.
    // Level 4, whose whole curve fits under the body cap: at the cap the count
    // stops following the squad and the HP per body rises to make up for it.
    const config = levelConfig(4);
    const small = sizeStream(config, 5, 0, 'single', 10);
    const large = sizeStream(config, config.rows - 1, 0, 'single', 10);
    expect(large.count).toBeGreaterThan(small.count * 4);
    expect(large.hpPerEnemy / small.hpPerEnemy).toBeGreaterThan(0.9);
    expect(large.hpPerEnemy / small.hpPerEnemy).toBeLessThan(1.1);
    expect(large.count).toBeLessThanOrEqual(balance.streams.count.max);

    // The two ends are the exception: a handful of soldiers still gets a river
    // worth the name, and no lane ever carries more bodies than the live cap.
    const tiny = sizeStream(config, 0, 0, 'single', 10);
    expect(tiny.count).toBe(balance.streams.count.min);
    expect(sizeStream(levelConfig(levelCount), levelConfig(levelCount).rows - 1, 0, 'single', 13).count)
      .toBe(balance.streams.count.max);
  });

  it('holds a stream to the duration and speed the tuning allows', () => {
    const config = levelConfig(4);
    expect(sizeStream(config, 3, 0, 'single', 1).durationSeconds).toBe(
      balance.streams.duration.min,
    );
    expect(sizeStream(config, 3, 0, 'single', 99).durationSeconds).toBe(
      balance.streams.duration.max,
    );
    expect(sizeStream(config, 3, 1, 'single', 9).lane).toBe(1);
    expect(sizeStream(config, 3, 1, 'single', 9).jitter).toBe(balance.streams.jitter);
  });
});
