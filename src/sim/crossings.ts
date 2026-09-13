/**
 * Which group takes which gate (D44).
 *
 * Through Milestone 5 there was one crowd and one answer: the lane the squad's
 * centre stood in when it crossed the row. A run can now have several groups on
 * the road at once — the column and whoever a fence shut out — so a row is
 * crossed once per group, and a gate belongs to the *first* group whose leader
 * crosses the row in that gate's lane. `add`, `sub` and `mul` then apply to
 * that group alone: its own back is where the newcomers form up and its own
 * tail is what a curse takes. `fireRate` and `weapon` are the squad's, because
 * they are what the wizards are carrying rather than how many of them there are.
 *
 * A gate nobody claimed stays shootable until every live group is past its row,
 * and is then retired: it is still standing, and a column behind a fence can
 * still be firing at it.
 */

import type { CrowdSim } from './crowd';
import type { EventBuffer } from './events';
import { countAfterGate } from './gates';
import { laneOf } from './lanes';
import type { LevelDef } from './level';
import type { GateState, RunState, WeaponId } from './types';
import { clampToWalls, wallLimits } from './walls';
import type { WallLimits } from './walls';
import type { Balance } from '@/data/types';

/** Not placed on the road yet: a new group works out which rows it has passed. */
const UNPLACED = -1;

/** What a resolved gate does to the run. `Run` owns all three. */
export interface GateSink {
  /** Grows or shrinks one group to `wanted` and updates `squad.count`. */
  resize(group: number, wanted: number): void;
  swapWeapon(id: WeaponId | undefined): void;
  /** The last unit of the run walked into a curse. */
  wiped(): void;
}

export class Crossings {
  private readonly level: LevelDef;
  private readonly balance: Balance;
  private readonly sink: GateSink;

  /** Next row each group has still to cross, or `UNPLACED`. */
  private readonly nextRow: Int32Array;

  /** Rows every live group is past; their gates are done with. */
  private swept = 0;

  /** Re-used by the lane test: a gate row must not allocate (CLAUDE.md). */
  private readonly limits: WallLimits = { lo: 0, hi: 0, wall: -1 };

  constructor(level: LevelDef, balance: Balance, groups: number, sink: GateSink) {
    this.level = level;
    this.balance = balance;
    this.sink = sink;
    this.nextRow = new Int32Array(groups).fill(UNPLACED);
    this.nextRow[0] = 0;
  }

  /** Walks every group over whatever rows it crossed this step. */
  update(state: RunState, crowd: CrowdSim, events: EventBuffer): void {
    const rows = this.level.rows;
    const groups = crowd.groups;

    for (let g = 0; g < groups.length; g++) {
      const group = groups[g];
      if (group === undefined) continue;
      // The main column keeps its place on the road even with nobody in it —
      // a gate can hand it a crowd back. A dissolved straggler group does not.
      if (g > 0 && group.count === 0) {
        this.nextRow[g] = UNPLACED;
        continue;
      }
      if ((this.nextRow[g] ?? UNPLACED) < 0) this.nextRow[g] = this.rowAt(group.z);

      while ((this.nextRow[g] ?? 0) < rows.length) {
        const index = this.nextRow[g] ?? 0;
        const row = rows[index];
        if (row === undefined || group.z < row.z) break;
        this.nextRow[g] = index + 1;

        const lane = this.laneOf(state, crowd, g);
        for (const gate of state.gates) {
          if (gate.rowIndex !== index || gate.passed || gate.lane !== lane) continue;
          gate.passed = true;
          this.apply(state, gate, g, events);
        }
        if (state.status !== 'running') return;
      }
    }

    this.retire(state, groups.length, crowd);
  }

  /**
   * The lane a group takes its gates in.
   *
   * The leader's, except that a fence holding at the group's `z` puts it back
   * on the side its *people* are on. The head is on the finger and no wall
   * bounds it any more (D43) — but a wall is still the decision D32 says it is,
   * and a column jammed against a fence must not collect the gate on the far
   * side of it just because the finger is over there.
   */
  private laneOf(state: RunState, crowd: CrowdSim, group: number): number {
    const at = crowd.groups[group];
    if (at === undefined) return 0;
    const width = this.balance.road.laneWidth;
    const limits = wallLimits(
      state.walls ?? [],
      at.z,
      crowd.meanX(group),
      this.balance.road.clampX,
      this.limits,
      this.balance,
    );
    return laneOf(clampToWalls(at.leaderX, limits), width);
  }

  /** First row standing in front of `z`. */
  private rowAt(z: number): number {
    const rows = this.level.rows;
    for (let i = 0; i < rows.length; i++) {
      if ((rows[i]?.z ?? 0) > z) return i;
    }
    return rows.length;
  }

  /** Gates behind every live group are passed, claimed or not. */
  private retire(state: RunState, groups: number, crowd: CrowdSim): void {
    let swept = this.level.rows.length;
    for (let g = 0; g < groups; g++) {
      const group = crowd.groups[g];
      if (group === undefined) continue;
      if (g > 0 && group.count === 0) continue;
      const row = this.nextRow[g] ?? 0;
      if (row < swept) swept = row;
    }
    if (swept <= this.swept) return;
    this.swept = swept;
    for (const gate of state.gates) {
      if (!gate.passed && gate.rowIndex < swept) gate.passed = true;
    }
  }

  private apply(state: RunState, gate: GateState, group: number, events: EventBuffer): void {
    const squad = state.squad;
    const before = squad.count;

    if (gate.kind === 'fireRate') {
      squad.fireRateBonus += gate.value;
      events.gatePassed(gate.id, gate.kind, gate.value, before, before);
      return;
    }

    if (gate.kind === 'weapon') {
      this.sink.swapWeapon(gate.weaponId);
      events.gatePassed(gate.id, gate.kind, gate.value, before, before);
      return;
    }

    const held = state.groups?.[group]?.count ?? 0;
    this.sink.resize(group, countAfterGate(gate.kind, gate.value, held));

    const after = squad.count;
    // Recorded here rather than only at the end of the step: a row that grows
    // the squad and a row that wipes it can land in the same step, and the peak
    // the player reached is part of their result either way.
    if (after > state.peakCount) state.peakCount = after;
    events.gatePassed(gate.id, gate.kind, gate.value, before, after);
    if (after > before) events.unitsGained(after - before);
    else if (after < before) events.unitsLost(before - after, 'gate');
    if (after <= 0) this.sink.wiped();
  }
}
