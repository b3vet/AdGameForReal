/**
 * The shootable things in front of the squad, rebuilt every step.
 *
 * Gates and enemy blocks collapse to the same shape — a centre, a half-width
 * and a `z` — so a projectile sweep is one loop over a handful of entries
 * instead of a scan of the whole level. Entries are pooled: rebuilding costs
 * no allocations after the first few steps.
 */

import { enemyFootprint } from './enemies';
import { isShootable } from './gates';
import { laneCenter } from './level';
import type { EnemyState, GateState, RunState } from './types';
import type { Balance } from '@/data/types';

/** How far behind the squad a shootable thing stays in the window. */
const BEHIND = 2;

export interface Target {
  cx: number;
  halfW: number;
  z: number;
  gate: GateState | null;
  enemy: EnemyState | null;
  /** Cleared when a block dies mid-step so later shots pass through it. */
  live: boolean;
}

export class TargetList {
  private readonly items: Target[] = [];
  private count = 0;

  rebuild(state: RunState, balance: Balance): void {
    const front = state.squad.z - BEHIND;
    const back = state.squad.z + balance.projectiles.range;
    const laneHalf = balance.road.laneWidth / 2;
    const radius = balance.projectiles.radius;

    this.count = 0;
    for (const gate of state.gates) {
      if (gate.passed || !isShootable(gate.kind)) continue;
      if (gate.z < front || gate.z > back) continue;
      this.add(laneCenter(gate.lane, balance.road.laneWidth), laneHalf, gate.z, gate, null);
    }
    for (const enemy of state.enemies) {
      if (!enemy.alive || enemy.z < front || enemy.z > back) continue;
      this.add(enemy.x, enemyFootprint(enemy.kind, enemy.units, balance) + radius, enemy.z, null, enemy);
    }
    const boss = state.boss;
    if (boss !== null && boss.alive && boss.z >= front && boss.z <= back) {
      this.add(boss.x, enemyFootprint('boss', boss.units, balance) + radius, boss.z, null, boss);
    }

    this.sortByZ();
  }

  /** Nearest live target whose band contains `x` and whose `z` lies in `[from, to]`. */
  sweep(x: number, from: number, to: number): Target | null {
    for (let i = 0; i < this.count; i++) {
      const target = this.items[i];
      if (target === undefined) continue;
      if (target.z > to) break;
      if (!target.live || target.z < from) continue;
      if (Math.abs(x - target.cx) < target.halfW) return target;
    }
    return null;
  }

  private add(
    cx: number,
    halfW: number,
    z: number,
    gate: GateState | null,
    enemy: EnemyState | null,
  ): void {
    const existing = this.items[this.count];
    if (existing === undefined) {
      this.items.push({ cx, halfW, z, gate, enemy, live: true });
    } else {
      existing.cx = cx;
      existing.halfW = halfW;
      existing.z = z;
      existing.gate = gate;
      existing.enemy = enemy;
      existing.live = true;
    }
    this.count++;
  }

  /** Insertion sort: the list is tiny and nearly sorted, and the sweep needs
   *  nearest-first order to decide what a shot hits first. */
  private sortByZ(): void {
    for (let i = 1; i < this.count; i++) {
      const item = this.items[i];
      if (item === undefined) continue;
      let j = i - 1;
      while (j >= 0) {
        const prev = this.items[j];
        if (prev === undefined || prev.z <= item.z) break;
        this.items[j + 1] = prev;
        j--;
      }
      this.items[j + 1] = item;
    }
  }
}
