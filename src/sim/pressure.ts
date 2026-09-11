/**
 * Stream pressure: the rule that decides how big a stream is.
 *
 * From docs/09-milestone-3-plan.md, "Stream pressure": for a stream of `count`
 * bodies of `hpPerEnemy` each, the window is the time from the stream's first
 * body entering projectile range to the last body reaching the squad if none of
 * them died, and
 *
 *     pressure = count * hpPerEnemy / (expected squad dps * window)
 *
 * A stream is *built* from that equation rather than measured against it: the
 * level says what pressure it wants (`streamPressure`) and how dense a river it
 * wants (`streamRate`), and this module solves for the count and the per-body
 * HP that land on it. That is what "the squad can barely clear each wave" (D29)
 * means in numbers, at every squad size the campaign passes through.
 *
 * Bodies spawn `spawnAhead` metres in front of the squad, which is exactly
 * `projectiles.range`, so "entering projectile range" and "spawning" are the
 * same instant and the window is `duration + spawnAhead / (closing speed)`.
 */

import { squadCurve } from './curve';
import type { StreamDef } from './types';
import { expectedDps, startWeapon } from './weapons';
import { balance } from '@/data';
import type { Balance, LevelGenConfig } from '@/data/types';

/** How the squad's own fire is shared with a stream that stands in one lane. */
export type StreamShape = 'single' | 'horde';

/**
 * Seconds from the first body appearing to the last body reaching the squad.
 *
 * The spawner keeps pace with the squad, so every body has the same journey:
 * `spawnAhead` metres closed at the sum of the two speeds. The last body starts
 * that journey `durationSeconds` after the first one.
 */
export function streamWindow(durationSeconds: number, speed: number, balanceData = balance): number {
  const closing = Math.max(0.1, speed + balanceData.squad.runSpeed);
  return durationSeconds + balanceData.streams.spawnAhead / closing;
}

/**
 * Damage per second one unit of the squad puts out, with the starting staff and
 * the fire-rate bonus a player is assumed to have picked up by then.
 *
 * `expectedDps` is asked with a fixed neighbour count rather than the real
 * layout: a stream is a river, so every body has company, and the number cannot
 * depend on the count we are in the middle of solving for.
 */
export function dpsPerUnit(balanceData = balance): number {
  const streams = balanceData.streams;
  const perShot = expectedDps(
    startWeapon,
    () => streams.neighbours,
    balanceData.bots.weaponSlowWorth,
  );
  return (
    balanceData.squad.fireRate *
    (1 + streams.rateBonus) *
    balanceData.squad.damage *
    perShot *
    streams.dpsTrim
  );
}

/** Share of the squad's output that lands in one lane, by the row's shape. */
export function laneShareOf(shape: StreamShape, balanceData = balance): number {
  const streams = balanceData.streams;
  return shape === 'horde' ? streams.hordeLaneShare : streams.laneShare;
}

/** What the squad is expected to land on a stream at this row, per second. */
export function expectedStreamDps(
  estimate: number,
  shape: StreamShape,
  balanceData = balance,
): number {
  return Math.max(1, estimate) * dpsPerUnit(balanceData) * laneShareOf(shape, balanceData);
}

/** The plan's pressure for a stream that is already built. */
export function streamPressure(
  def: StreamDef,
  estimate: number,
  shape: StreamShape,
  balanceData = balance,
): number {
  const window = streamWindow(def.durationSeconds, def.speed, balanceData);
  const dps = expectedStreamDps(estimate, shape, balanceData);
  return (def.count * def.hpPerEnemy) / Math.max(1e-6, dps * window);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds a stream for one row.
 *
 * Two dials, in this order. `streamDensity` is bodies per unit of the squad the
 * row is built for, and it is what fixes how the river *reads* and what a leak
 * *costs*: a leak takes one soldier, so a stream of one body per soldier makes a
 * three percent leak cost three percent of the squad whether the squad is eight
 * or four hundred. `streamPressure` then fixes how much HP has to come down the
 * lane, and per-body HP is whatever divides that budget across those bodies.
 *
 * Sizing the count by seconds instead — a fixed arrival rate — was the first
 * attempt and it does not survive contact with the curve: the squad's output is
 * about three hit points per second per soldier, so a pressure-sized budget at
 * one HP a body is fourteen bodies per soldier, and a three percent leak then
 * costs forty percent of a small squad. The plan's "1 to 3 HP" per body cannot
 * hold against that; per-body HP lands between ten and thirty instead, and the
 * player never sees it because a stream shows its remaining count, not HP.
 */
export function sizeStream(
  config: LevelGenConfig,
  rowIndex: number,
  lane: StreamDef['lane'],
  shape: StreamShape,
  durationSeconds: number,
  balanceData: Balance = balance,
): StreamDef {
  const streams = balanceData.streams;
  const speed = streams.speed;
  const duration = clamp(durationSeconds, streams.duration.min, streams.duration.max);
  const window = streamWindow(duration, speed, balanceData);
  const estimate = squadCurve(config, rowIndex);
  const budget = config.streamPressure * expectedStreamDps(estimate, shape, balanceData) * window;

  const count = clamp(
    Math.round(estimate * config.streamDensity),
    streams.count.min,
    streams.count.max,
  );
  // Not rounded to an integer: `count * hpPerEnemy` is the pressure budget, and
  // rounding a six-hit-point body to the nearest whole number moves the realised
  // pressure by up to eight percent — enough on its own to walk a level out of
  // its band. Nothing reads a body's HP but the damage arithmetic, and the
  // player is shown the stream's remaining count, never its hit points.
  const hpPerEnemy = clamp(budget / count, streams.hpPerEnemy.min, streams.hpPerEnemy.max);

  return {
    lane,
    kind: 'grunt',
    count,
    durationSeconds: duration,
    hpPerEnemy,
    speed,
    jitter: streams.jitter,
  };
}
