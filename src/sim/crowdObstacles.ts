/**
 * What stands in the crowd's way this step: the fence lines, the arch legs and
 * the bodies close enough to shove somebody.
 *
 * Gathered once a step from the crowd's own bounding box rather than asked per
 * unit — there are at most a handful of each and five hundred units — and held
 * in pooled `Float64Array`s so a step allocates nothing (CLAUDE.md).
 */

import { enemyHalfWidth } from './enemies';
import { wallX } from './walls';
import type { WallDef } from './walls';
import type { CrowdState, EnemyState, GateState } from './types';
import type { Balance } from '@/data/types';

/** Floats per fence: the line, the `z` it holds from and to, the wall index. */
export const FENCE_STRIDE = 4;

/** Floats per shover: x, z, half along x, half along z. */
export const SHOVE_STRIDE = 4;

/**
 * Most bodies that may shove in one step. A body only qualifies while it
 * overlaps the crowd's own box, which is the front line and the few that are
 * walking past it down the same lane; a river thick enough to put more than
 * this many people inside the column is one the column is already losing to.
 */
const MAX_SHOVERS = 32;

/** Most gate rows whose arch legs can stand inside the column at once. */
const MAX_ARCHES = 4;

export class Obstacles {
  /** `(line, from, to, wall)` per fence in force somewhere in the column. */
  readonly fences: Float64Array;
  fenceCount = 0;

  /** The `z` of each gate row standing inside the column. */
  readonly arches: Float64Array;
  archCount = 0;

  /** `(x, z, halfX, halfZ)` per body close enough to push somebody. */
  readonly shovers: Float64Array;
  shoveCount = 0;

  constructor(walls: number) {
    this.fences = new Float64Array(FENCE_STRIDE * Math.max(4, walls));
    this.arches = new Float64Array(MAX_ARCHES);
    this.shovers = new Float64Array(SHOVE_STRIDE * MAX_SHOVERS);
  }

  /** The fences, arch legs and bodies that touch the crowd's own box now. */
  gather(
    crowd: CrowdState,
    walls: readonly WallDef[],
    gates: readonly GateState[],
    enemies: readonly EnemyState[],
    balance: Balance,
    anchorZ: number,
  ): void {
    let xLo = Infinity;
    let xHi = -Infinity;
    let zLo = Infinity;
    let zHi = -Infinity;
    const alive = crowd.alive;
    for (let i = 0; i < crowd.capacity; i++) {
      if ((alive[i] ?? 0) === 0) continue;
      const x = crowd.x[i] ?? 0;
      const z = crowd.z[i] ?? 0;
      if (x < xLo) xLo = x;
      if (x > xHi) xHi = x;
      if (z < zLo) zLo = z;
      if (z > zHi) zHi = z;
    }
    if (xLo > xHi) {
      this.fenceCount = 0;
      this.archCount = 0;
      this.shoveCount = 0;
      return;
    }

    // The anchor counts as part of the column for the fences: the cut that
    // makes stragglers fires when the wall holds at the *anchor* (D44), and if
    // the fence waited for a unit to reach the same `z` there would be one step
    // between the two in which somebody could walk through the line.
    this.gatherFences(walls, balance, zLo, Math.max(zHi, anchorZ));
    this.gatherArches(gates, balance, zLo, zHi);
    this.gatherShovers(enemies, balance, xLo, xHi, zLo, zHi);
  }

  private gatherFences(
    walls: readonly WallDef[],
    balance: Balance,
    zLo: number,
    zHi: number,
  ): void {
    const approach = balance.walls.approach;
    const release = balance.walls.gateGap;
    const capacity = Math.floor(this.fences.length / FENCE_STRIDE);
    let count = 0;
    for (let i = 0; i < walls.length && count < capacity; i++) {
      const wall = walls[i];
      if (wall === undefined) continue;
      let from = wall.zStart - approach;
      const to = wall.zEnd + release;
      // Anywhere in the column's own span, not only under its anchor: the
      // front of a thirteen-metre column enters a stretch half a step before
      // its tail does, and the tail is exactly who gets left outside (D44).
      if (zHi < from || zLo > to) continue;
      // While the head of the column is inside the stretch, the fence holds for
      // the whole of it. Without this the tail — eleven metres behind the
      // approach zone, where no fence stands yet — would slide across the line
      // behind the head and walk into the stretch on the far side, which is the
      // commitment the wall exists to take away (D32). Once the head is out the
      // far end the rule goes back to being about each unit's own `z`, so the
      // column is released a row at a time rather than all at once.
      if (zHi >= from && zHi <= to) from = -Infinity;
      const at = count * FENCE_STRIDE;
      this.fences[at] = wallX(wall.boundary, balance.road.laneWidth);
      this.fences[at + 1] = from;
      this.fences[at + 2] = to;
      this.fences[at + 3] = i;
      count++;
    }
    this.fenceCount = count;
  }

  /**
   * The gate rows standing inside the column. Every gate row carries an arch
   * per lane, and the legs of the middle one are the pinch: two short
   * obstacles on the lane boundaries that the column has to funnel between.
   */
  private gatherArches(
    gates: readonly GateState[],
    balance: Balance,
    zLo: number,
    zHi: number,
  ): void {
    const half = balance.crowd.arch.depth / 2;
    let count = 0;
    for (let i = 0; i < gates.length && count < MAX_ARCHES; i++) {
      const gate = gates[i];
      if (gate === undefined) continue;
      const z = gate.z;
      if (z + half < zLo || z - half > zHi) continue;
      let seen = false;
      for (let k = 0; k < count; k++) if (this.arches[k] === z) seen = true;
      if (seen) continue;
      this.arches[count++] = z;
    }
    this.archCount = count;
  }

  private gatherShovers(
    enemies: readonly EnemyState[],
    balance: Balance,
    xLo: number,
    xHi: number,
    zLo: number,
    zHi: number,
  ): void {
    const body = balance.crowd.bodyRadius;
    const reach = balance.crowd.shove.reach;
    let count = 0;
    for (let i = 0; i < enemies.length && count < MAX_SHOVERS; i++) {
      const enemy = enemies[i];
      if (enemy === undefined || !enemy.alive || !enemy.active) continue;
      const halfX = enemyHalfWidth(enemy, balance) + body;
      // Deeper than it is wide. A body meets the crowd at
      // `enemies.contactDistance` — 1.2 m, an abstraction of "they met" rather
      // than a footprint — so a shove that only reached the body's own width
      // would never happen at all: the body would die on the step it first
      // came within reach. `reach` is what buys the bow its approach.
      const halfZ = halfX + reach;
      if (enemy.x + halfX < xLo || enemy.x - halfX > xHi) continue;
      if (enemy.z + halfZ < zLo || enemy.z - halfZ > zHi) continue;
      const at = count * SHOVE_STRIDE;
      this.shovers[at] = enemy.x;
      this.shovers[at + 1] = enemy.z;
      this.shovers[at + 2] = halfX;
      this.shovers[at + 3] = halfZ;
      count++;
    }
    this.shoveCount = count;
  }
}
