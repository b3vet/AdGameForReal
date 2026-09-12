/**
 * The shootable things in front of the squad, kept in three sorted lanes.
 *
 * Milestone 2 rebuilt one flat list every step, which is fine for a dozen
 * blocks and quadratic for the three hundred bodies a stream puts on the road.
 * Now every gate, block and stream body is registered once when it appears,
 * lives in the lane list (or two) its footprint overlaps, and leaves when it
 * dies or falls behind the squad. Each step is one linear pass per lane that
 * refreshes, drops and re-sorts — the lists are already almost in order,
 * because everything on the road closes on the squad and nothing ever backs
 * away from it, so the insertion sort walks straight through.
 *
 * Sorted nearest-first is what the sweep needs: a shot hits the first live
 * thing whose band it crosses, and a volley of batched shots mows down the lane
 * from the front.
 */

import { enemyHalfWidth } from './enemies';
import { isShootable } from './gates';
import { laneCenter, laneOf } from './lanes';
import type { EnemyState, GateState, Lane, RunState } from './types';
import type { Balance } from '@/data/types';

/** How far behind the squad a shootable thing stays in the window. */
const BEHIND = 2;

/**
 * Keeps a target that ends exactly on a lane boundary out of the neighbouring
 * lane. The sweep's own band test is strict, so the two must agree.
 */
const EDGE = 1e-6;

export interface Target {
  cx: number;
  halfW: number;
  z: number;
  gate: GateState | null;
  enemy: EnemyState | null;
  /** Cleared when a block dies mid-step so later shots pass through it. */
  live: boolean;
  /** How many lane lists hold this target; it returns to the pool at zero. */
  refs: number;
  /**
   * Which `forEachNear` pass last visited this target. A target wide enough to
   * stand in two lanes is in two lists, and a splash must not hit it twice.
   */
  stamp: number;
}

interface LaneList {
  items: Target[];
  count: number;
}

function emptyLane(): LaneList {
  return { items: [], count: 0 };
}

export class TargetList {
  private readonly lanes: [LaneList, LaneList, LaneList] = [emptyLane(), emptyLane(), emptyLane()];
  private readonly free: Target[] = [];

  /** The window the sweep works in, refreshed once per step. */
  private front = -Infinity;

  /** Bumped per `forEachNear` so one pass never visits a target twice. */
  private pass = 0;

  /**
   * How far a target itself closes on the squad during one step.
   *
   * A shot sweeps `[z, z + speed * dt]` against positions taken *before* the
   * step moved anything, so a target walking the other way can slip through the
   * seam between one sweep and the next: it sits a hair past the end of this
   * step's window and a hair behind the start of the next one. Rare — about one
   * encounter in eight at a grunt's speed — and it shows up as the occasional
   * shot sailing through the front of a stream into the body behind it. Adding
   * the target's own step to the far end of the window closes the seam, which
   * is the discrete form of asking whether the gap between them crossed zero.
   */
  private slack = 0;

  /** Registers everything the level starts with. Called once per run. */
  build(state: RunState, balance: Balance): void {
    for (const lane of this.lanes) lane.count = 0;
    this.free.length = 0;

    const laneWidth = balance.road.laneWidth;
    const half = laneWidth / 2;
    for (const gate of state.gates) {
      if (!isShootable(gate.kind)) continue;
      this.add(laneCenter(gate.lane, laneWidth), half, gate.z, gate, null, laneWidth);
    }
    for (const enemy of state.enemies) this.insert(enemy, balance);
    const boss = state.boss;
    if (boss !== null) this.insert(boss, balance);
  }

  /** Registers one body the moment it appears. Streams call this on every spawn. */
  insert(enemy: EnemyState, balance: Balance): void {
    if (!enemy.alive) return;
    this.add(
      enemy.x,
      shootableHalf(enemy, balance),
      enemy.z,
      null,
      enemy,
      balance.road.laneWidth,
    );
  }

  /**
   * Refresh, drop and re-sort. Everything that has died, been passed or fallen
   * behind the squad leaves here; a target's `z` never rises relative to the
   * squad, so what falls out of the window never comes back.
   */
  update(state: RunState, balance: Balance, dt: number): void {
    this.front = state.squad.z - BEHIND;
    const enemies = balance.enemies;
    this.slack =
      dt * Math.max(enemies.grunt.speed, enemies.brute.speed, balance.streams.speed);

    for (const lane of this.lanes) {
      const items = lane.items;
      let write = 0;
      for (let read = 0; read < lane.count; read++) {
        const target = items[read];
        if (target === undefined) continue;

        const gate = target.gate;
        if (gate !== null) {
          target.z = gate.z;
          target.live = !gate.passed && isShootable(gate.kind);
        } else {
          const enemy = target.enemy;
          if (enemy === null) continue;
          target.z = enemy.z;
          target.cx = enemy.x;
          target.halfW = shootableHalf(enemy, balance);
          target.live = enemy.alive;
        }

        if (!target.live || target.z < this.front) {
          if (--target.refs <= 0) this.recycle(target);
          continue;
        }
        items[write++] = target;
      }
      lane.count = write;
      sortByZ(items, write);
    }
  }

  /** Nearest live target whose band contains `x` and whose `z` lies in `[from, to]`. */
  sweep(x: number, from: number, to: number, laneWidth?: number): Target | null {
    const lane = this.lanes[laneOf(x, laneWidth) + 1];
    if (lane === undefined) return null;
    const reach = to + this.slack;
    for (let i = 0; i < lane.count; i++) {
      const target = lane.items[i];
      if (target === undefined) continue;
      if (target.z > reach) break;
      if (!target.live || target.z < from) continue;
      if (Math.abs(x - target.cx) < target.halfW) return target;
    }
    return null;
  }

  /**
   * Nearest live target anywhere across one lane's width.
   *
   * What a batched volley hits: above the projectile cap a step's shots are
   * summed per lane, and those shots came from hundreds of units spread right
   * across the lane, so the batch is not a single line down the lane centre and
   * must not miss a body that stands a jitter's width off it.
   */
  sweepLane(lane: Lane, from: number, to: number): Target | null {
    const list = this.lanes[lane + 1];
    if (list === undefined) return null;
    const reach = to + this.slack;
    for (let i = 0; i < list.count; i++) {
      const target = list.items[i];
      if (target === undefined) continue;
      if (target.z > reach) break;
      if (!target.live || target.z < from) continue;
      return target;
    }
    return null;
  }

  /**
   * Every live enemy whose `z` is within `reach` of `z`, nearest lane first.
   * `visit` returns false to stop early. Splash and chain use this instead of
   * walking the whole road.
   */
  forEachNear(z: number, reach: number, visit: (enemy: EnemyState, target: Target) => boolean): void {
    const pass = ++this.pass;
    for (const lane of this.lanes) {
      const items = lane.items;
      let i = lowerBound(items, lane.count, z - reach);
      for (; i < lane.count; i++) {
        const target = items[i];
        if (target === undefined) continue;
        if (target.z > z + reach) break;
        const enemy = target.enemy;
        if (!target.live || enemy === null || !enemy.alive) continue;
        if (target.stamp === pass) continue;
        target.stamp = pass;
        if (!visit(enemy, target)) return;
      }
    }
  }

  private add(
    cx: number,
    halfW: number,
    z: number,
    gate: GateState | null,
    enemy: EnemyState | null,
    // Passed rather than defaulted. Which lane lists a target is filed under is
    // lane geometry, so it has to come from the run's own tuning and not from
    // the shipped `balance`: `sweepLane` has no band test of its own — a
    // batched volley comes from a crowd spread right across the lane — so a
    // target filed in the wrong list is a target a volley mows down from a lane
    // it is nowhere near.
    laneWidth: number,
  ): void {
    const target = this.free.pop() ?? { cx, halfW, z, gate, enemy, live: true, refs: 0, stamp: 0 };
    target.cx = cx;
    target.halfW = halfW;
    target.z = z;
    target.gate = gate;
    target.enemy = enemy;
    target.live = true;
    target.refs = 0;

    const low = laneOf(cx - halfW + EDGE, laneWidth) + 1;
    const high = laneOf(cx + halfW - EDGE, laneWidth) + 1;
    for (let slot = low; slot <= high; slot++) {
      const lane = this.lanes[slot];
      if (lane === undefined) continue;
      lane.items[lane.count++] = target;
      target.refs++;
    }
  }

  private recycle(target: Target): void {
    target.gate = null;
    target.enemy = null;
    target.live = false;
    this.free.push(target);
  }
}

/**
 * How wide a thing is to a shot, as against how wide it is to a shoulder.
 *
 * A stream body gets `streams.aimAssist` on top of its own footprint: it is one
 * person in a two-metre lane, and a squad that fires dead ahead would miss it
 * most of the time, which no amount of pressure tuning can compensate for
 * because the miss rate depends on how many bodies happen to be live.
 */
function shootableHalf(enemy: EnemyState, balance: Balance): number {
  const assist = enemy.streamId === undefined ? 0 : balance.streams.aimAssist;
  return enemyHalfWidth(enemy, balance) + balance.projectiles.radius + assist;
}

/** First index whose `z` is at or past `z`, over the sorted prefix. */
function lowerBound(items: readonly Target[], count: number, z: number): number {
  let low = 0;
  let high = count;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((items[mid]?.z ?? Infinity) < z) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Insertion sort over the live prefix. Everything on the road closes on the
 * squad at its own speed, so the list starts almost sorted and this is linear
 * in practice; only a frost slow or a brute among grunts makes it work.
 */
function sortByZ(items: Target[], count: number): void {
  for (let i = 1; i < count; i++) {
    const item = items[i];
    if (item === undefined) continue;
    let j = i - 1;
    while (j >= 0) {
      const prev = items[j];
      if (prev === undefined || prev.z <= item.z) break;
      items[j + 1] = prev;
      j--;
    }
    items[j + 1] = item;
  }
}
