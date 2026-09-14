/**
 * Every unit as an agent (D43).
 *
 * The state is structure-of-arrays at `squad.maxCount` capacity and is *never*
 * compacted: a unit keeps its index from the moment it spawns to the moment it
 * dies, so a render instance never swaps person mid-run, and a dead index is
 * simply free for the next spawn.
 *
 * What a unit chases is a *slot*: its place in its group's formation, handed
 * out front first. When a unit dies the highest-slot unit of its group takes
 * the freed slot and walks there through the forces, so a hole in the middle of
 * the column closes on its own rather than being memcpy'd shut. When the count
 * grows, the layout for the new count moves every slot a little and the column
 * re-spaces itself the same way.
 *
 * `squad.count` stays the total alive across every group and this class is what
 * maintains it, so the plaque, the gates, the balance model and the bots read
 * exactly what they always did.
 *
 * The forces are `crowdForces.ts`, the neighbour index is `crowdHash.ts`, the
 * head and its trail are `leader.ts`, and being shut out by a fence is
 * `stragglers.ts`. This file is the state, the bookkeeping and the order those
 * happen in. Nothing here allocates after the constructor (CLAUDE.md).
 */

import { CrowdScene } from './crowdForces';
import { createCrowdState, nearestLive } from './crowdState';
import { formationOffsets, openRoadWidth, unitSpacing } from './formation';
import { updateStragglers } from './stragglers';
import {
  CROWD_JUST_SPAWNED,
  CROWD_REJOINING,
} from './types';
import type { CrowdState, GroupState, Lane, RunState } from './types';
import type { WallDef } from './walls';
import type { Balance } from '@/data/types';

/** No group. `slotAgent` holds this where a slot is unused. */
const NOBODY = -1;

export class CrowdSim {
  readonly crowd: CrowdState;
  readonly groups: GroupState[];

  /** Per group: the `z` its confining fence lets it go home at. */
  readonly releaseZ: Float64Array;

  /** Per wall: 1 while it is holding at the column's front, so the cut that
   *  makes stragglers happens on the edge and only once (D44). */
  readonly wallHeld: Uint8Array;

  /** Per group: how many times `openGroup` has handed this slot out. A slot can
   *  be released and taken again inside one step (`updateStragglers` releases
   *  before it cuts), so "its count is zero" is an edge nothing outside this
   *  class is guaranteed to see; `crossings.ts` tells a new group from the last
   *  one to use the slot by this. Group 0 is never opened, so it stays 0. */
  readonly opened: Int32Array;

  /** Live indices in index order, rebuilt each step: what the shot clock walks. */
  private readonly live: Int32Array;
  private liveTotal = 0;

  /** Mean `x` of each group's live units, rebuilt with the live list. */
  private readonly meanOf: Float64Array;

  /** Free indices, newest first. A dead unit's index returns here. */
  private readonly free: Int32Array;
  private freeTotal: number;

  /** `slotAgent[group * capacity + slot]` is who stands in that slot. */
  private readonly slotAgent: Int32Array;

  private readonly scene: CrowdScene;
  private readonly balance: Balance;
  private readonly walls: readonly WallDef[];
  private readonly groupPrevZ: Float64Array;

  /** Total alive across every group: what `squad.count` is kept equal to. */
  private alive = 0;

  /** The band the formation is laid out in, refreshed every step. */
  private width: number;

  constructor(balance: Balance, walls: readonly WallDef[]) {
    this.balance = balance;
    this.walls = walls;
    const capacity = Math.max(1, Math.floor(balance.squad.maxCount));
    const groupCap = Math.max(1, Math.floor(balance.crowd.groupCap));

    this.crowd = createCrowdState(capacity);
    this.groups = new Array<GroupState>(groupCap);
    for (let g = 0; g < groupCap; g++) {
      this.groups[g] = { id: g, count: 0, leaderX: 0, z: 0, lane: null, rejoinAt: 0 };
    }
    this.releaseZ = new Float64Array(groupCap);
    this.opened = new Int32Array(groupCap);
    this.groupPrevZ = new Float64Array(groupCap);
    this.wallHeld = new Uint8Array(Math.max(1, walls.length));

    this.live = new Int32Array(capacity);
    this.meanOf = new Float64Array(groupCap);
    this.free = new Int32Array(capacity);
    // Descending, so the first spawns take 0, 1, 2...: a run reads the same
    // way in a debugger as it does on the screen.
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeTotal = capacity;

    this.slotAgent = new Int32Array(groupCap * capacity).fill(NOBODY);
    this.width = openRoadWidth(balance);

    // Long enough for the deepest column the capacity allows, which is every
    // unit in its own row: the chain delay is clamped to the ring either way.
    const trail = Math.min(512, Math.ceil(capacity * balance.crowd.chainStepsPerRow) + 2);
    this.scene = new CrowdScene(capacity, groupCap, trail, walls.length);
    for (let g = 0; g < groupCap; g++) this.scene.trails.reset(g, 0);
  }

  /** Total alive across every group. */
  get total(): number {
    return this.alive;
  }

  /** How many units fire this step. */
  get liveCount(): number {
    return this.liveTotal;
  }

  /** The `k`th live unit's index, for a caller walking them in turn. */
  liveAt(k: number): number {
    return this.live[k] ?? 0;
  }

  /**
   * Where a group's crowd actually is, as against where its leader is asking
   * it to go. The head is on the finger and fences do not bound it (D43), so
   * this is what says which side of a fence the *people* are on — which is what
   * decides the gate they walk through (`crossings.ts`).
   */
  meanX(group: number): number {
    const state = this.groups[group];
    if (state === undefined || state.count === 0) return state?.leaderX ?? 0;
    return this.meanOf[group] ?? state.leaderX;
  }

  /** Index of the wall that held a unit this step, or -1. */
  get fenceWall(): number {
    return this.scene.fenceWall;
  }

  /** A push on the crowd from something that is not a body: the meteor (D54). */
  shove(x: number, z: number, radius: number, strength: number, until: number): void {
    this.scene.shove(x, z, radius, strength, until);
  }

  /* ---------------------------------------------------------------- */
  /* Spawning and dying                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Puts `amount` new units at the back of a group's formation and returns how
   * many there was room for. Every path that grows the squad — a gate, and
   * whatever Milestone 7 adds — comes through here.
   */
  spawn(group: number, amount: number): number {
    const state = this.groups[group];
    const wanted = Math.min(Math.floor(amount), this.freeTotal);
    if (state === undefined || wanted <= 0) return 0;

    // Laid out for the count it will *be*, so the whole column re-spaces once
    // rather than every newcomer arriving into a formation built without it.
    const offsets = formationOffsets(state.count + wanted, this.width, this.balance);
    const chain = this.balance.crowd.chainStepsPerRow;

    for (let k = 0; k < wanted; k++) {
      const index = this.free[--this.freeTotal] ?? 0;
      const slot = state.count;
      this.attach(index, group, slot);
      state.count++;

      const offset = offsets[slot];
      const row = offset === undefined ? 0 : offset.row;
      this.crowd.x[index] = this.scene.trails.at(group, row * chain) + (offset?.x ?? 0);
      this.crowd.z[index] = state.z + (offset?.z ?? 0);
      this.crowd.vx[index] = 0;
      this.crowd.vz[index] = 0;
      this.crowd.alive[index] = 1;
      this.crowd.flags[index] = CROWD_JUST_SPAWNED;
      this.alive++;
    }
    return wanted;
  }

  /**
   * Kills `amount` units from the back of a group: the last to arrive are the
   * first a `sub` or a `div` gate takes, so the column loses its tail rather
   * than a hole in its middle.
   */
  killBack(group: number, amount: number): number {
    const state = this.groups[group];
    if (state === undefined) return 0;
    const wanted = Math.min(Math.floor(amount), state.count);
    for (let k = 0; k < wanted; k++) {
      const index = this.slotAgent[group * this.crowd.capacity + (state.count - 1)] ?? NOBODY;
      if (index < 0) return k;
      this.kill(index);
    }
    return Math.max(0, wanted);
  }

  /**
   * Kills the `amount` units standing nearest `(x, z)`, one at a time. What
   * a block, a body or a stomp takes: the people it actually landed on, front
   * or flank, rather than an anonymous subtraction from the count.
   *
   * `group` is -1 for "anyone", which is what the boss uses — its foot does not
   * care which group it lands on.
   */
  killNearest(group: number, amount: number, x: number, z: number): number {
    let killed = 0;
    for (let k = 0; k < amount; k++) {
      const nearest = nearestLive(this.crowd, group, x, z);
      if (nearest < 0) break;
      this.kill(nearest);
      killed++;
    }
    return killed;
  }

  private kill(index: number): void {
    const group = this.crowd.group[index] ?? 0;
    this.detach(index);
    const state = this.groups[group];
    if (state !== undefined) state.count--;
    this.crowd.alive[index] = 0;
    this.crowd.flags[index] = 0;
    this.free[this.freeTotal++] = index;
    this.alive--;
  }

  /* ---------------------------------------------------------------- */
  /* Groups                                                            */
  /* ---------------------------------------------------------------- */

  /** A free straggler group, set up and ready for members, or -1 at the cap. */
  openGroup(lane: Lane, leaderX: number, z: number, releaseZ: number): number {
    for (let g = 1; g < this.groups.length; g++) {
      const state = this.groups[g];
      if (state === undefined || state.count > 0) continue;
      state.lane = lane;
      state.leaderX = leaderX;
      state.z = z;
      state.rejoinAt = 0;
      this.releaseZ[g] = releaseZ;
      this.opened[g] = (this.opened[g] ?? 0) + 1;
      // It is already walking with the column, so its slots are too.
      this.groupPrevZ[g] = z - this.balance.squad.runSpeed / 60;
      this.scene.trails.reset(g, leaderX);
      return g;
    }
    return NOBODY;
  }

  /** The live straggler group standing nearest `x`, or -1 if there is none. */
  nearestGroup(x: number): number {
    let best = NOBODY;
    let bestGap = Infinity;
    for (let g = 1; g < this.groups.length; g++) {
      const state = this.groups[g];
      if (state === undefined || state.count === 0) continue;
      const gap = Math.abs(state.leaderX - x);
      if (gap < bestGap) {
        bestGap = gap;
        best = g;
      }
    }
    return best;
  }

  /** Moves one unit to the back of another group's formation, keeping its place
   *  on the road: only the slot it is chasing changes. */
  moveToGroup(index: number, group: number): void {
    const state = this.groups[group];
    if (state === undefined) return;
    this.detach(index);
    const from = this.groups[this.crowd.group[index] ?? 0];
    if (from !== undefined) from.count--;
    this.attach(index, group, state.count);
    state.count++;
  }

  /**
   * The fence is behind them: everyone left in `group` seeks a slot at the back
   * of the main column and wears `REJOINING` until they get there.
   */
  rejoinToMain(group: number): void {
    const crowd = this.crowd;
    for (let i = 0; i < crowd.capacity; i++) {
      if ((crowd.alive[i] ?? 0) === 0 || (crowd.group[i] ?? 0) !== group) continue;
      this.moveToGroup(i, 0);
      crowd.flags[i] = (crowd.flags[i] ?? 0) | CROWD_REJOINING;
    }
    const state = this.groups[group];
    if (state === undefined) return;
    state.lane = null;
    state.rejoinAt = 0;
    this.releaseZ[group] = 0;
  }

  private attach(index: number, group: number, slot: number): void {
    this.crowd.group[index] = group;
    this.crowd.slot[index] = slot;
    this.slotAgent[group * this.crowd.capacity + slot] = index;
  }

  /**
   * Takes a unit out of its group's slots. The highest slot moves down into the
   * hole, which is what closes a gap: that unit now walks to where the dead one
   * stood instead of being teleported there.
   */
  private detach(index: number): void {
    const group = this.crowd.group[index] ?? 0;
    const state = this.groups[group];
    if (state === undefined) return;
    const base = group * this.crowd.capacity;
    const slot = this.crowd.slot[index] ?? 0;
    const last = state.count - 1;
    const tail = this.slotAgent[base + last] ?? NOBODY;
    if (tail >= 0 && tail !== index) {
      this.crowd.slot[tail] = slot;
      this.slotAgent[base + slot] = tail;
    } else {
      this.slotAgent[base + slot] = NOBODY;
    }
    this.slotAgent[base + last] = NOBODY;
  }

  /* ---------------------------------------------------------------- */
  /* The step                                                          */
  /* ---------------------------------------------------------------- */

  /** Leaders, stragglers, forces, integration — in that order, once a step. */
  step(state: RunState, dt: number): void {
    const squad = state.squad;
    this.width = squad.formationWidth ?? openRoadWidth(this.balance);

    const main = this.groups[0];
    if (main !== undefined) {
      main.leaderX = squad.x;
      main.z = squad.z;
    }
    const runSpeed = this.balance.squad.runSpeed;
    for (let g = 1; g < this.groups.length; g++) {
      const group = this.groups[g];
      if (group === undefined || group.count === 0) continue;
      // A straggler group walks with the column and is confined to its lane.
      group.z = Math.min(state.arenaZ, group.z + runSpeed * dt);
    }

    updateStragglers(this, state, this.balance);

    const stepsPerSecond = 1 / dt;
    for (let g = 0; g < this.groups.length; g++) {
      const group = this.groups[g];
      if (group === undefined) continue;
      this.scene.offsets[g] = formationOffsets(group.count, this.width, this.balance);
      this.scene.groupVZ[g] = (group.z - (this.groupPrevZ[g] ?? group.z)) * stepsPerSecond;
      this.groupPrevZ[g] = group.z;
      this.scene.groupSpacing[g] = unitSpacing(group.count, this.balance);
      this.scene.trails.push(g, group.leaderX);
    }

    this.scene.gather(
      this.crowd,
      this.walls,
      state.gates,
      state.enemies,
      state.boss,
      this.balance,
      state.squad.z,
      state.time,
    );
    // The cell is the longer of the two neighbour reaches: the soft separation
    // radius and the two shoulders the body projection keeps apart.
    this.scene.hash.build(
      this.crowd,
      Math.max(this.balance.crowd.separation.radius, 2 * this.balance.crowd.bodyRadius),
    );
    this.scene.move(this.crowd, this.groups, this.balance, dt);

    let live = 0;
    this.meanOf.fill(0);
    for (let i = 0; i < this.crowd.capacity; i++) {
      if ((this.crowd.alive[i] ?? 0) === 0) continue;
      this.live[live++] = i;
      const g = this.crowd.group[i] ?? 0;
      this.meanOf[g] = (this.meanOf[g] ?? 0) + (this.crowd.x[i] ?? 0);
    }
    this.liveTotal = live;
    for (let g = 0; g < this.groups.length; g++) {
      const count = this.groups[g]?.count ?? 0;
      if (count > 0) this.meanOf[g] = (this.meanOf[g] ?? 0) / count;
    }
  }
}
