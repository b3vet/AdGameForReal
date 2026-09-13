/**
 * What moves one unit in one step (D43).
 *
 * Three passes, in this order. `advance` is the forces: seek the slot under the
 * group's leader, separate from the neighbours, take whatever the bodies
 * standing in you are pushing, cap the speed, integrate. `press` is the bodies:
 * nobody may stand inside anybody else. `confine` is the edges: the fence lines
 * that hold at the unit's own `z`, and the arch legs at a gate row it is
 * walking through.
 *
 * The last two come after the forces on purpose. The plan lists the shove after
 * the fence, but a shove that ran after the clamp could push a unit through a
 * line, and "no unit past the line at any step" is the one thing a wall has to
 * mean. Everything soft is summed into the velocity first, and the two
 * constraints are applied to the position that velocity produced.
 *
 * The seek is first order with feed-forward: a unit's velocity is its *slot's*
 * velocity plus `seekRate` times the error against where that slot stood at the
 * start of the step. Without the feed-forward term a column running at 5 m/s
 * would trail its slots by `runSpeed / seekRate` for ever — most of a row — and
 * a head whipping at 24 m/s would leave the front rank metres behind. With it,
 * the only lag in the column is the one the chain puts there on purpose.
 *
 * Nothing here allocates: every scratch array is owned by the scene and sized
 * once (CLAUDE.md).
 */

import { CrowdHash } from './crowdHash';
import { Obstacles, FENCE_STRIDE, SHOVE_STRIDE } from './crowdObstacles';
import type { FormationOffset } from './formation';
import { LeaderTrails } from './leader';
import type { WallDef } from './walls';
import {
  CROWD_ON_FENCE,
  CROWD_REJOINING,
  CROWD_SHOVED,
} from './types';
import type { CrowdState, EnemyState, GateState, GroupState } from './types';
import type { Balance } from '@/data/types';

/** Everything one force pass reads and writes. Built once, mutated per step. */
export class CrowdScene {
  readonly hash: CrowdHash;
  readonly trails: LeaderTrails;

  /** Per group: the formation its slots come from, its anchor speed, spacing. */
  readonly offsets: Array<ReadonlyArray<FormationOffset>>;
  readonly groupVZ: Float64Array;
  readonly groupSpacing: Float64Array;

  /** What stands in the crowd's way this step. */
  private readonly obstacles: Obstacles;

  /** Where each unit's slot stood this step, kept for the rejoin test. */
  private readonly slotX: Float64Array;
  private readonly slotZ: Float64Array;

  /** Where each unit stood *before* this step's motion, kept for the fence:
   *  which side of a line a unit is held on is the side it came from. */
  private readonly fromX: Float64Array;

  /** Index of a wall that held a unit this step, or -1. `Run` sounds it. */
  fenceWall = -1;

  constructor(capacity: number, groups: number, trailLength: number, walls: number) {
    this.hash = new CrowdHash(capacity);
    this.trails = new LeaderTrails(groups, trailLength);
    this.offsets = new Array<ReadonlyArray<FormationOffset>>(groups).fill([]);
    this.groupVZ = new Float64Array(groups);
    this.groupSpacing = new Float64Array(groups);
    this.obstacles = new Obstacles(walls);
    this.slotX = new Float64Array(capacity);
    this.slotZ = new Float64Array(capacity);
    this.fromX = new Float64Array(capacity);
  }

  /** What the crowd has to get past this step, gathered once. */
  gather(
    crowd: CrowdState,
    walls: readonly WallDef[],
    gates: readonly GateState[],
    enemies: readonly EnemyState[],
    boss: EnemyState | null,
    balance: Balance,
    anchorZ: number,
  ): void {
    this.fenceWall = -1;
    this.obstacles.gather(crowd, walls, gates, enemies, boss, balance, anchorZ);
  }

  /**
   * One step of motion for every live unit: the forces, then the bodies, then
   * the hard edges. Three passes rather than one, because the last two are
   * *constraints* — a unit may not stand inside another unit, and it may not
   * stand through a fence — and a constraint has to be applied after every
   * force or it is only a suggestion.
   */
  move(crowd: CrowdState, groups: readonly GroupState[], balance: Balance, dt: number): void {
    this.advance(crowd, groups, balance, dt);
    this.press(crowd, balance);
    this.confine(crowd, balance);
  }

  /** Seek, separate, take the shove, cap, integrate. */
  private advance(
    crowd: CrowdState,
    groups: readonly GroupState[],
    balance: Balance,
    dt: number,
  ): void {
    const tuning = balance.crowd;
    const seek = tuning.seekRate;
    const chain = tuning.chainStepsPerRow;
    const radius = tuning.separation.radius;
    const stepsPerSecond = 1 / dt;

    const alive = crowd.alive;
    const xs = crowd.x;
    const zs = crowd.z;
    const flags = crowd.flags;

    for (let i = 0; i < crowd.capacity; i++) {
      if ((alive[i] ?? 0) === 0) continue;
      // Everything but `REJOINING` is one step's news; the rejoin lasts until
      // the unit is home.
      let flag = (flags[i] ?? 0) & CROWD_REJOINING;

      const g = crowd.group[i] ?? 0;
      const group = groups[g];
      if (group === undefined) continue;
      const x = xs[i] ?? 0;
      const z = zs[i] ?? 0;

      const offset = this.offsets[g]?.[crowd.slot[i] ?? 0];
      const delay = offset === undefined ? 0 : offset.row * chain;
      const slotX = this.trails.at(g, delay) + (offset?.x ?? 0);
      const slotZ = group.z + (offset?.z ?? 0);
      const slotVX = this.trails.velocity(g, delay, stepsPerSecond);
      const slotVZ = this.groupVZ[g] ?? 0;
      this.slotX[i] = slotX;
      this.slotZ[i] = slotZ;
      this.fromX[i] = x;

      // Seek the slot as it stood at the *start* of the step, and let the
      // feed-forward carry it the rest of the way. Chasing where the slot has
      // already moved to leaves every unit a permanent `slotSpeed / seekRate`
      // ahead of its place — 8 cm at the run speed, the same for all of them,
      // so the column looks right and sits in front of its own anchor. This
      // form has the column standing exactly in its slots.
      let vx = slotVX + seek * (slotX - slotVX * dt - x);
      let vz = slotVZ + seek * (slotZ - slotVZ * dt - z);

      // Separation, from the nine cells around this unit. Soft and short: in
      // formation the nearest slot is further off than `radius`, so a column
      // standing in its places feels nothing at all and this only answers a
      // crowd that has been disturbed.
      let pushX = 0;
      let pushZ = 0;
      const cx = this.hash.cellX[i] ?? 0;
      const cz = this.hash.cellZ[i] ?? 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const qx = cx + ox;
          const qz = cz + oz;
          const bucket = this.hash.bucketOf(qx, qz);
          const end = this.hash.end(bucket);
          for (let slot = this.hash.begin(bucket); slot < end; slot++) {
            const j = this.hash.at(slot);
            if (j === i) continue;
            // A bucket can hold two different cells; only this one's are
            // neighbours, and counting a unit twice makes it jitter.
            if ((this.hash.cellX[j] ?? 0) !== qx || (this.hash.cellZ[j] ?? 0) !== qz) continue;
            const dx = x - (xs[j] ?? 0);
            const dz = z - (zs[j] ?? 0);
            const square = dx * dx + dz * dz;
            if (square >= radius * radius || square <= 0) continue;
            const distance = Math.sqrt(square);
            const strength = (tuning.separation.force * (1 - distance / radius)) / distance;
            pushX += dx * strength;
            pushZ += dz * strength;
          }
        }
      }
      const push = Math.sqrt(pushX * pushX + pushZ * pushZ);
      if (push > tuning.separation.maxPush) {
        const scale = tuning.separation.maxPush / push;
        pushX *= scale;
        pushZ *= scale;
      }
      vx += pushX;
      vz += pushZ;

      // Enemy shove: a body standing in this unit pushes it back and aside,
      // this step, before contact resolves the kill (D43).
      for (let s = 0; s < this.obstacles.shoveCount; s++) {
        const at = s * SHOVE_STRIDE;
        const dx = x - (this.obstacles.shovers[at] ?? 0);
        const dz = z - (this.obstacles.shovers[at + 1] ?? 0);
        const overX = Math.abs(dx) / (this.obstacles.shovers[at + 2] ?? 1);
        const overZ = Math.abs(dz) / (this.obstacles.shovers[at + 3] ?? 1);
        if (overX >= 1 || overZ >= 1) continue;
        const bite = 1 - Math.max(overX, overZ);
        vz -= tuning.shove.back * bite;
        vx += (dx < 0 ? -1 : 1) * tuning.shove.side * bite;
        flag |= CROWD_SHOVED;
      }

      // Speed cap, measured against the slot rather than the ground: the slot
      // itself is running at `runSpeed` and may be whipping sideways at the
      // head's own speed, and a unit that could not match that would be left
      // behind by its own formation.
      const limit = (flag & CROWD_REJOINING) === 0 ? tuning.maxSpeed : tuning.rejoinSpeed;
      const relX = vx - slotVX;
      const relZ = vz - slotVZ;
      const relative = Math.sqrt(relX * relX + relZ * relZ);
      if (relative > limit) {
        const scale = limit / relative;
        vx = slotVX + relX * scale;
        vz = slotVZ + relZ * scale;
      }

      xs[i] = x + vx * dt;
      zs[i] = z + vz * dt;
      crowd.vx[i] = vx;
      crowd.vz[i] = vz;
      flags[i] = flag;
    }
  }

  /**
   * Bodies, in one Gauss-Seidel pass: no two units may stand closer than their
   * shoulders, and a pair that does is pushed apart, half a body each.
   *
   * This is what the separation *force* cannot do. A force is fought by the
   * seek and loses to it under a speed cap, so a column pressed into a fence
   * would compress into a smear however hard it pushed. A projection is applied
   * to the position after the forces have had their say, so a crush spreads
   * along the fence instead: the crowd spills because it cannot overlap.
   *
   * Both units of a pair move, each pair is visited once (`j > i`), and a pair
   * that is exactly coincident — which a fence line does produce, a whole row
   * clamped to the same `x` at the same `z` — is separated along `z` by index,
   * so the result is deterministic rather than a stack.
   */
  private press(crowd: CrowdState, balance: Balance): void {
    const gap = 2 * balance.crowd.bodyRadius;
    const square = gap * gap;
    const alive = crowd.alive;
    const xs = crowd.x;
    const zs = crowd.z;

    for (let i = 0; i < crowd.capacity; i++) {
      if ((alive[i] ?? 0) === 0) continue;
      const cx = this.hash.cellX[i] ?? 0;
      const cz = this.hash.cellZ[i] ?? 0;
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const qx = cx + ox;
          const qz = cz + oz;
          const bucket = this.hash.bucketOf(qx, qz);
          const end = this.hash.end(bucket);
          for (let slot = this.hash.begin(bucket); slot < end; slot++) {
            const j = this.hash.at(slot);
            if (j <= i) continue;
            if ((this.hash.cellX[j] ?? 0) !== qx || (this.hash.cellZ[j] ?? 0) !== qz) continue;
            let dx = (xs[i] ?? 0) - (xs[j] ?? 0);
            let dz = (zs[i] ?? 0) - (zs[j] ?? 0);
            let apart = dx * dx + dz * dz;
            if (apart >= square) continue;
            if (apart <= 1e-12) {
              dx = 0;
              dz = 1;
              apart = 1;
            }
            const distance = Math.sqrt(apart);
            const half = (gap - distance) / (2 * distance);
            xs[i] = (xs[i] ?? 0) + dx * half;
            zs[i] = (zs[i] ?? 0) + dz * half;
            xs[j] = (xs[j] ?? 0) - dx * half;
            zs[j] = (zs[j] ?? 0) - dz * half;
          }
        }
      }
    }
  }

  /**
   * The hard edges: a fence line that holds at the unit's own `z`, and the arch
   * legs at a gate row it is walking through. Last, so nothing can put a unit
   * back through one.
   */
  private confine(crowd: CrowdState, balance: Balance): void {
    const tuning = balance.crowd;
    const body = tuning.bodyRadius;
    const legReach = tuning.arch.legHalf + body;
    const legX = balance.road.laneWidth / 2;
    const archHalf = tuning.arch.depth / 2;

    const alive = crowd.alive;
    const xs = crowd.x;
    const zs = crowd.z;
    const flags = crowd.flags;

    for (let i = 0; i < crowd.capacity; i++) {
      if ((alive[i] ?? 0) === 0) continue;
      let flag = flags[i] ?? 0;
      let nx = xs[i] ?? 0;
      const nz = zs[i] ?? 0;

      // The side is the side the unit came *from* — not where the step left it
      // — so a straggler cut off on the far side is held there, and a body
      // pushed over the line by its neighbours is pushed back rather than
      // adopted by the other half of the road.
      const from = this.fromX[i] ?? nx;
      for (let f = 0; f < this.obstacles.fenceCount; f++) {
        const at = f * FENCE_STRIDE;
        if (nz < (this.obstacles.fences[at + 1] ?? 0) || nz > (this.obstacles.fences[at + 2] ?? 0)) continue;
        const line = this.obstacles.fences[at] ?? 0;
        if (from <= line) {
          const edge = line - body;
          if (nx <= edge) continue;
          nx = edge;
        } else {
          const edge = line + body;
          if (nx >= edge) continue;
          nx = edge;
        }
        crowd.vx[i] = 0;
        flag |= CROWD_ON_FENCE;
        this.fenceWall = this.obstacles.fences[at + 3] ?? -1;
      }

      // Arch legs: the column funnels through the opening rather than walking
      // through the stonework.
      for (let a = 0; a < this.obstacles.archCount; a++) {
        const row = this.obstacles.arches[a] ?? 0;
        if (nz < row - archHalf || nz > row + archHalf) continue;
        for (let side = -1; side <= 1; side += 2) {
          const leg = side * legX;
          if (Math.abs(nx - leg) >= legReach) continue;
          nx = (this.fromX[i] ?? nx) < leg ? leg - legReach : leg + legReach;
          crowd.vx[i] = 0;
          flag |= CROWD_ON_FENCE;
        }
      }

      // Home again: the scurry is over and the unit is one of the column.
      if ((flag & CROWD_REJOINING) !== 0) {
        const spacing = this.groupSpacing[crowd.group[i] ?? 0] ?? 0;
        const gapX = nx - (this.slotX[i] ?? 0);
        const gapZ = nz - (this.slotZ[i] ?? 0);
        if (gapX * gapX + gapZ * gapZ <= spacing * spacing) flag &= ~CROWD_REJOINING;
      }

      xs[i] = nx;
      flags[i] = flag;
    }
  }
}
