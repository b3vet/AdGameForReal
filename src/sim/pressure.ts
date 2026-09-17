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
import type { Balance, DealtLevelConfig } from '@/data/types';

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
  config: DealtLevelConfig,
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

/* ------------------------------------------------------------------ */
/* Portals (document 31, 3.2)                                          */
/* ------------------------------------------------------------------ */

/** Where a portal stands relative to its beat, and how it pours. */
export interface PortalGeometry {
  /** Metres from the beat's gate row; negative is in front of the panels. */
  at: number;
  /** Squad-to-portal distance at which the pour starts. */
  open: number;
  /** Seconds it is asked to pour. */
  seconds: number;
  /** A panel that stops shots stands at the gate row in the portal's lane. */
  screened: boolean;
  /** How fast a body walks. */
  speed: number;
}

export interface PortalWindow {
  /**
   * Seconds in which the lane has a body the column can shoot: the union of
   * every body's time between being in range, and past any panel screening
   * it, and reaching the column.
   */
  window: number;
  /** Seconds the pour actually runs before the squad is `portal.stopGap` short of it. */
  pour: number;
  /**
   * Share of the poured bodies that reach the column with less than
   * `portal.tollSeconds` of fire on them: the part of the river a column that
   * stands in the lane is expected to pay for (3.3, the toll).
   */
  tollShare: number;
}

/**
 * Bodies the window is sampled at. A numerical detail rather than a tuning
 * number: every body's window is a straight-line function of when it was
 * poured, so two dozen samples put the union within a few hundredths of a
 * second of the exact one.
 */
const PORTAL_SAMPLES = 24;

/**
 * The fire window a portal's geometry leaves (3.2, rule 4).
 *
 * Time runs from the pour opening. The squad closes on the portal at the run
 * speed and a body closes on the squad at the sum of the two, so a body
 * poured at `t` reaches the column at `(open + speed * t) / closing` and is in
 * range from `(open - range + speed * t) / closing`. A panel that stops shots
 * stands between the two until the body walks through it (`at / speed` after
 * it was poured) or the squad walks through it first, whichever comes sooner:
 * a lane's fire goes into the nearest target, and until then that is the
 * panel.
 */
export function portalWindow(geometry: PortalGeometry, balanceData: Balance = balance): PortalWindow {
  const run = balanceData.squad.runSpeed;
  const speed = Math.max(0.1, geometry.speed);
  const closing = run + speed;
  const range = balanceData.projectiles.range;
  const portal = balanceData.enemies.portal;
  const open = geometry.open;
  const pour = Math.max(0, Math.min(geometry.seconds, (open - portal.stopGap) / Math.max(0.1, run)));
  if (pour <= 0) return { window: 0, pour: 0, tollShare: 0 };

  const screen = geometry.screened && geometry.at > 0;
  // When the squad reaches the gate row and the panel stops being in the way.
  const squadAtPanel = (open - geometry.at) / Math.max(0.1, run);

  let window = 0;
  let reach = -Infinity;
  let tolls = 0;
  for (let k = 0; k < PORTAL_SAMPLES; k++) {
    const poured = (pour * k) / (PORTAL_SAMPLES - 1);
    const contact = (open + speed * poured) / closing;
    let start = Math.max(poured, (open - range + speed * poured) / closing);
    if (screen) start = Math.max(start, Math.min(poured + geometry.at / speed, squadAtPanel));
    if (contact - start < portal.tollSeconds) tolls++;
    if (contact <= start) continue;
    // Starts and contacts both rise with `poured`, so the union is a sweep.
    if (start >= reach) window += contact - start;
    else if (contact > reach) window += contact - reach;
    reach = Math.max(reach, contact);
  }
  return { window, pour, tollShare: tolls / PORTAL_SAMPLES };
}

/**
 * Squad-to-portal distance a river timed by its tail opens at (Phase 1, wave
 * two): early enough that a pour of `seconds` has sent its last body by the
 * time that body, walking at `speed`, will meet the column `tail` metres past
 * the gate row. The portal stands `at` metres past the row.
 *
 * The last body leaves the portal as the squad stands at `s`, and meets it
 * after `(portal - s - contact) / (run + speed)` seconds, the squad having
 * walked `run` times that; solving for `s` puts the squad
 * `((run + speed) * tail - run * (at - contact)) / speed` metres past the row
 * when it is poured, and the pour opened `run * seconds` metres before that.
 */
export function openForTail(
  at: number,
  seconds: number,
  tail: number,
  speed: number,
  balanceData: Balance = balance,
): number {
  const run = balanceData.squad.runSpeed;
  const walk = Math.max(0.1, speed);
  const contact = balanceData.enemies.contactDistance;
  const lastPoured = ((run + walk) * tail - run * (at - contact)) / walk;
  return at - lastPoured + run * Math.max(0, seconds);
}

/** A beat river's opening distance: its own, or the one its tail asks for. */
export function portalOpen(
  river: { at: number; seconds: number; open?: number; tail?: number },
  speed: number,
  balanceData: Balance = balance,
): number {
  if (river.tail !== undefined) return openForTail(river.at, river.seconds, river.tail, speed, balanceData);
  return river.open ?? balanceData.streams.spawnAhead;
}
