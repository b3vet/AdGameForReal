/**
 * The threats a price is made of (`./botPrice.ts`): everything that will meet
 * a column standing in the lane being priced, put on its timeline
 * (`./botTimeline.ts`) with when the lane's fire can first reach it and when it
 * arrives.
 *
 *   blocks    asleep until the squad is its `wake` short of it, then walking
 *             until they reach their hold line, if a beat gave them one;
 *             what meets the column is the share of it `overlapShare` says;
 *   chargers  commit to the column's lane when they set off, if it is within
 *             `lanePick` of their own (`chargeLane`), and can be shot by a lane
 *             only once they are running down it;
 *   bodies    river bodies already on the road, binned by the second they
 *             arrive in;
 *   pours     the part of a river still to come, in `riverChunks` pieces, from
 *             a portal (`anchorZ`) or from the spawner that keeps pace.
 *
 * A player's view (`PriceView`) decides what is on its screen: a threat behind
 * a panel that stops shots is seen only within `behindReach`, and a river with
 * no portal only once it pours.
 */

import { facts, streamFacts } from './botStreams';
import type { PriceView } from './botPrice';
import {
  BLOCK,
  CHARGER,
  RIVER,
  ctx,
  push,
  setAim,
  setBlock,
  setDensity,
  unscreened,
} from './botTimeline';
import { overlapShare } from './contact';
import { activationRange, enemyBalance, enemyFootprint } from './enemies';
import { laneCenter, laneOf } from './lanes';
import type { EnemyState, Lane, RunState } from './types';
import type { Balance } from '@/data/types';

/** Bins live river bodies are grouped into, by the second they arrive in. */
const BODY_BINS = 20;

const binHp = new Float64Array(BODY_BINS);
const binBodies = new Float64Array(BODY_BINS);
const binOpen = new Float64Array(BODY_BINS);
const binDue = new Float64Array(BODY_BINS);

/** Blocks and chargers that will meet a column standing in `lane`. */
export function addBlocks(state: RunState, lane: Lane, view: PriceView, balance: Balance): void {
  const price = balance.bots.price;
  const minShare = balance.enemies.contactMinShare;
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.streamId !== undefined || enemy.kind === 'boss') continue;
    if (enemy.z > state.arenaZ) continue;
    const gap = enemy.z - ctx.s;
    if (gap < -(ctx.contact + ctx.trailing)) continue;
    const speed = Math.max(0, enemy.speed);
    const closing = ctx.run + speed;
    const wake = enemy.active ? Math.max(0, gap) : Math.min(gap, enemy.wake ?? activationRange(enemy.kind, balance));
    const wakeAt = (gap - wake) / ctx.run;
    let arrive = wakeAt + Math.max(0, wake - ctx.contact) / closing;
    let inRange =
      gap <= ctx.range
        ? 0
        : ctx.range >= wake
          ? (gap - ctx.range) / ctx.run
          : wakeAt + (wake - ctx.range) / closing;
    // A block on a hold line stops there (`EnemyState.holdZ`), so the column
    // reaches it, and its range, no sooner than it would a block standing on
    // the line. Walking, it is never nearer than the line, so the later of the
    // two answers is the right one either way.
    const holdZ = enemy.holdZ;
    if (holdZ !== undefined) {
      const line = Math.min(enemy.z, holdZ) - ctx.s;
      arrive = Math.max(arrive, (line - ctx.contact) / ctx.run);
      inRange = Math.max(inRange, (line - ctx.range) / ctx.run);
    }
    if (arrive > ctx.horizon || ctx.s + ctx.run * arrive > ctx.toZ + 0.5) continue;

    if (enemy.kind === 'charger') {
      addCharger(enemy, lane, gap, arrive, inRange, balance);
      continue;
    }
    const half = Math.min(enemy.maxHalf ?? Infinity, enemyFootprint(enemy.kind, enemy.units, balance));
    const meets = overlapShare(enemy.x, half, ctx.x, ctx.half, minShare);
    if (meets <= 0) continue;
    const lift = unscreened(enemy.z, speed, 0, wakeAt, gap <= view.behindReach);
    if (lift < 0) continue;
    const i = push(BLOCK, arrive, Math.max(inRange, lift), enemy.hp, enemy.units);
    if (i < 0) return;
    // Only the part of the column whose shots cross the block's band is on it.
    const lo = Math.max(ctx.x - ctx.half, enemy.x - half);
    const hi = Math.min(ctx.x + ctx.half, enemy.x + half);
    const onIt = Math.min(1, Math.max(0, hi - lo) / Math.max(1e-6, 2 * ctx.half));
    const armour = (enemy.shield ?? 0) / Math.max(1e-6, balance.enemies.shield.damageMul);
    const perUnit = enemy.hpPerUnit ?? enemyBalance(enemy.kind, balance).hpPerUnit;
    setBlock(i, armour, perUnit, meets, price.blockAim * onIt);
  }
}

function addCharger(enemy: EnemyState, lane: Lane, gap: number, arrive: number, inRange: number, balance: Balance): void {
  const config = balance.enemies.charger;
  const own = laneOf(enemy.x, balance.road.laneWidth);
  const pick = Math.max(0, Math.round(config.lanePick));
  const target = enemy.charge?.lane ?? Math.min(own + pick, Math.max(own - pick, lane));
  if (target !== lane) return;
  const trigger = enemy.active ? 0 : Math.max(0, (gap - (enemy.wake ?? config.triggerRange)) / ctx.run);
  const across = Math.abs(laneCenter(target, balance.road.laneWidth) - enemy.x);
  const reachable = across < 0.5 ? inRange : trigger + across / Math.max(0.1, config.lateralSpeed);
  // Its bite is the shape `chargerKills` gives it: a floor, or a share of the
  // column, whichever is more — with the share its beat may have set on it.
  const floor = Math.max(1, Math.round(config.kills));
  const bite = Math.max(floor, Math.ceil(ctx.count * (enemy.killShare ?? config.killShare)));
  const i = push(CHARGER, arrive, reachable, enemy.hp, bite);
  if (i >= 0) setAim(i, balance.bots.price.blockAim);
}

/** Live river bodies that will walk into a column standing in the lane. */
export function addBodies(state: RunState, view: PriceView): void {
  binBodies.fill(0);
  binHp.fill(0);
  let closing = ctx.run;
  for (const enemy of state.enemies) {
    if (!enemy.alive || enemy.streamId === undefined) continue;
    if (Math.abs(enemy.x - ctx.x) >= ctx.reach) continue;
    const gap = enemy.z - ctx.s;
    if (gap < -(ctx.contact + ctx.trailing)) continue;
    const speed = Math.max(0, enemy.speed);
    const arrive = Math.max(0, gap - ctx.contact) / (ctx.run + speed);
    if (arrive > ctx.horizon || ctx.s + ctx.run * arrive > ctx.toZ + 0.5) continue;
    const lift = unscreened(enemy.z, speed, 0, 0, gap <= view.behindReach);
    if (lift < 0) continue;
    const inRange = gap <= ctx.range ? 0 : (gap - ctx.range) / (ctx.run + speed);
    const reach = Math.max(inRange, lift);
    const bin = Math.min(BODY_BINS - 1, Math.floor(arrive));
    const first = (binBodies[bin] ?? 0) === 0;
    binHp[bin] = (binHp[bin] ?? 0) + enemy.hp;
    binBodies[bin] = (binBodies[bin] ?? 0) + 1;
    binOpen[bin] = first ? reach : Math.min(binOpen[bin] ?? reach, reach);
    binDue[bin] = first ? arrive : Math.max(binDue[bin] ?? arrive, arrive);
    closing = ctx.run + speed;
  }
  for (let b = 0; b < BODY_BINS; b++) {
    const bodies = binBodies[b] ?? 0;
    if (bodies <= 0) continue;
    const i = push(RIVER, binDue[b] ?? 0, binOpen[b] ?? 0, binHp[b] ?? 0, bodies);
    // A second's worth of arrivals was spread over a second of closing road.
    if (i >= 0) setDensity(i, bodies / closing);
  }
}

/** The part of every river in `lane` still to be poured. */
export function addPours(state: RunState, lane: Lane, view: PriceView, balance: Balance): void {
  const chunks = Math.max(1, Math.round(balance.bots.price.riverChunks));
  const ahead = balance.streams.spawnAhead;
  for (const stream of state.streams) {
    if (stream.done || stream.lane !== lane) continue;
    const left = stream.count - stream.spawned;
    if (left <= 0 || !streamFacts(state, stream, balance)) continue;
    const anchor = facts.anchorZ;
    if (anchor === undefined && !stream.started && !view.seesUnopened) continue;
    if (anchor !== undefined && anchor - ctx.s > view.behindReach && unscreened(anchor, 0, 0, 0, false) < 0) {
      continue;
    }
    const speed = facts.speed;
    const rate = stream.count / Math.max(0.1, facts.seconds);
    const opensAt = anchor === undefined ? stream.z - ahead : anchor - facts.openAt;
    const start = stream.started ? 0 : Math.max(0, (opensAt - ctx.s) / ctx.run);
    const stop = anchor === undefined ? Infinity : (anchor - balance.enemies.portal.stopGap - ctx.s) / ctx.run;
    // A portal's bodies walk away from one place; the spawner's keep pace.
    const perMetre = rate / Math.max(0.1, anchor === undefined ? ctx.run + speed : speed);
    for (let c = 0; c < chunks; c++) {
      const from = Math.floor((c * left) / chunks);
      const to = Math.floor(((c + 1) * left) / chunks);
      if (to <= from) continue;
      const firstAt = start + (from + 0.5) / rate;
      if (firstAt > stop || firstAt > ctx.horizon) break;
      const lastAt = Math.min(stop, start + (to - 0.5) / rate);
      const bodies = Math.max(1, Math.min(to - from, Math.round((lastAt - firstAt) * rate) + 1));
      const lastSquad = ctx.s + ctx.run * lastAt;
      const lastSpawn = anchor ?? lastSquad + ahead;
      const arrive = lastAt + Math.max(0, lastSpawn - lastSquad - ctx.contact) / (ctx.run + speed);
      if (ctx.s + ctx.run * arrive > ctx.toZ + 0.5) continue;
      const firstSquad = ctx.s + ctx.run * firstAt;
      const firstSpawn = anchor ?? firstSquad + ahead;
      const inRange = firstAt + Math.max(0, firstSpawn - firstSquad - ctx.range) / (ctx.run + speed);
      const lift = unscreened(firstSpawn, speed, firstAt, firstAt, true);
      const i = push(RIVER, arrive, Math.max(inRange, lift), bodies * facts.hp, bodies);
      if (i >= 0) setDensity(i, perMetre);
    }
  }
}
