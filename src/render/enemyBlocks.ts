/**
 * Drawing one enemy *block*: the loose cluster of skeletons that stands in for
 * `units` enemies.
 *
 * Split out of `./enemies.ts`, which is about binding blocks to slots and
 * driving the streams; this is the geometry of a single block and nothing else.
 * The rule that decides when a block's HP number gives way to a gate panel
 * moved to `./labelClearance.ts` in Milestone 4 Phase D, because a stream's
 * count needs exactly the same rule.
 */

import type { Crowd } from './characters';
import {
  BRUTE_SCALE,
  ENEMY_CLUSTER_DEPTH,
  ENEMY_MAX_INSTANCES,
  GRUNT_SCALE,
} from './theme';
import type { EnemyKind } from '@/sim';

/** Skeletons face the squad, which is behind them down the road. */
const FACING = Math.PI;
/** Corpses the baked-death fallback plays; the plan's cap when physics is off. */
const DEATH_INSTANCES = 8;

/** What `writeCluster` needs to know about a block. `./enemies.ts` owns the rest. */
export interface ClusterSource {
  enemyId: number;
  kind: EnemyKind;
  x: number;
  z: number;
  units: number;
  footprint: number;
}

export function commitCrowd(crowd: Crowd | null, count: number, dt: number): void {
  if (crowd === null) return;
  crowd.setCount(count);
  crowd.commit();
  crowd.update(dt);
}

/**
 * Writes one block's skeletons into `crowd` starting at `base`, and answers how
 * many it wrote.
 *
 * `dying` is -1 for a live block and the seconds into the death animation
 * otherwise. A dying block plays that animation by hand: the baked shader's
 * clock is per-instance, and at speed zero the offset *is* the time into the
 * range, so passing the age plays the one-shot exactly once instead of looping
 * it forever (`docs/ASSETS.md`, open issue 4).
 */
export function writeCluster(
  crowd: Crowd,
  base: number,
  slot: ClusterSource,
  active: boolean,
  dying: number,
): number {
  const scale = slot.kind === 'brute' ? BRUTE_SCALE : GRUNT_SCALE;
  const wanted = dying >= 0 ? DEATH_INSTANCES : ENEMY_MAX_INSTANCES;
  const count = Math.min(slot.units, wanted, crowd.capacity - base);
  // Skeletons stand a body-width apart inside the block's own footprint, so
  // what the player sees is exactly what the sim will collide with.
  const spread = Math.max(0.25, slot.footprint - 0.2);

  for (let i = 0; i < count; i++) {
    const across = hash(slot.enemyId * 131 + i * 17);
    const along = hash(slot.enemyId * 977 + i * 53);
    const x = slot.x + (across * 2 - 1) * spread;
    const z = slot.z + (along - 0.5) * ENEMY_CLUSTER_DEPTH;
    const phase = hash(slot.enemyId * 31 + i * 7);

    if (dying >= 0) {
      crowd.setInstance(base + i, x, 0, z, FACING, scale, 'death', dying, 0);
    } else if (active) {
      // One block in three runs at the squad rather than walking, which is the
      // second baked range Milestone 3 added earning its rows.
      const gait = slot.enemyId % 3 === 0 ? 'walk2' : 'walk';
      crowd.setInstance(base + i, x, 0, z, FACING + (phase - 0.5) * 0.4, scale, gait, phase);
    } else {
      // Not activated yet: hold one frame of the walk so the block reads as a
      // waiting mob rather than marching on the spot.
      crowd.setInstance(base + i, x, 0, z, FACING + (phase - 0.5) * 0.6, scale, 'walk', phase, 0);
    }
  }
  return count;
}

/** Deterministic 0..1 from an integer; the cluster must not shimmer per frame. */
function hash(value: number): number {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
