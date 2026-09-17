/**
 * Drawing one enemy *block*: the loose cluster of skeletons that stands in for
 * `units` enemies.
 *
 * Split out of `./enemies.ts`, which is about binding blocks to slots and
 * driving the streams; this is the geometry of a single block and nothing else.
 * The rule that decides when a block's HP number gives way to a gate panel
 * moved to `./labelClearance.ts` in Milestone 4 Phase D, because a stream's
 * count needs exactly the same rule.
 *
 * `BlockCrowds` is the other half: which crowd a kind is drawn from, and the
 * running count of how much of each crowd's buffer this frame has used. It
 * lives here rather than in `./enemies.ts` because D49 made it three crowds
 * instead of two — the shielded brute is the warrior with the pack's shield
 * merged in — and the bookkeeping is the same shape for all of them.
 */

import type { Scene } from '@babylonjs/core/scene';

import type { Crowd } from './characters';
import { loadCrowd, loadCrowds } from './models';
import type { ShadowLayer } from './shadows';
import {
  BRUTE_SCALE,
  ENEMY_CLUSTER_DEPTH,
  ENEMY_COLOR,
  ENEMY_MAX_INSTANCES,
  GRUNT_SCALE,
  HOLD_BREATH,
  HOLD_BREATH_HZ,
  HOLD_FRAME,
  HOLD_SLACK,
  HOLD_SWAY,
  HOLD_SWAY_HZ,
  HOLD_YAW,
  POOL,
  SHADOW,
  WAKE_SQUASH_STAGGER,
  wakeSquash,
} from './theme';
import type { EnemyKind, EnemyState } from '@/sim';

/** Skeletons face the squad, which is behind them down the road. */
const FACING = Math.PI;
/** Corpses the baked-death fallback plays; the plan's cap when physics is off. */
const DEATH_INSTANCES = 8;
const TAU = Math.PI * 2;

/**
 * How a live block is standing: not woken yet (a waiting mob), walking at the
 * squad, or on its beat's hold line (`HOLD_FRAME`, `./beatLook.ts`).
 */
export type BlockStance = 'waiting' | 'walking' | 'held';

/**
 * The stance the sim's state implies. A block on or in front of its hold line
 * is held whether or not it has woken: the sim will not move it again
 * (`src/sim/contact.ts`), so a guard braces from the first frame it is drawn
 * rather than waiting like a mob that is about to set off.
 *
 * A held block also owes no wake cue (`./enemies.ts`). A guard wakes at the
 * contact distance, on the step the column reaches it: in its lane the block
 * dies on that same step and the contact's kill is the moment, and beside it
 * the crouch, dust and alarm number would announce a charge that never comes.
 * An ambush wakes behind its panel and walks, so its cue plays as it always did.
 */
export function stanceOf(enemy: Pick<EnemyState, 'active' | 'z' | 'holdZ'>): BlockStance {
  if (enemy.holdZ !== undefined && enemy.z <= enemy.holdZ + HOLD_SLACK) return 'held';
  return enemy.active ? 'walking' : 'waiting';
}

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
 * The three crowds every block on the road is drawn from, and how much of each
 * one this frame has written.
 *
 * Grunts and stream bodies share the minion crowd (D29), brutes take the
 * warrior, and a shielded brute takes the *shield* variant of that same
 * warrior: one parse of the `.glb` and one copy of its baked texture serve both
 * (`loadCrowds`), so the second kind costs a mesh and its instance buffer and
 * nothing else. One draw call each, whatever is standing on the road.
 */
export class BlockCrowds {
  private grunts: Crowd | null = null;
  private brutes: Crowd | null = null;
  private shields: Crowd | null = null;
  /** Instances written this frame, per crowd, in the order above. */
  private readonly counts = [0, 0, 0];
  /** The `death` range is shorter for a warrior than for a minion. */
  private readonly deaths = [1, 1, 1];

  async load(scene: Scene): Promise<void> {
    const [grunts, warriors] = await Promise.all([
      loadCrowd(scene, {
        modelId: 'skeleton_minion',
        capacity: POOL.grunts,
        fallbackColor: ENEMY_COLOR,
        fallbackName: 'grunt',
      }),
      // Both warrior variants out of one parse: the shielded brute is not a
      // model of its own, it is the shield merged under the same rig (D23).
      loadCrowds(scene, {
        modelId: 'skeleton_warrior',
        variants: ['default', 'shield'],
        capacity: POOL.brutes,
        fallbackColor: ENEMY_COLOR,
        fallbackName: 'brute',
      }),
    ]);
    this.grunts = grunts;
    this.brutes = warriors[0] ?? null;
    this.shields = warriors[1] ?? null;
    this.deaths[0] = grunts.durationOf('death');
    this.deaths[1] = this.brutes?.durationOf('death') ?? 1;
    this.deaths[2] = this.shields?.durationOf('death') ?? this.deaths[1] ?? 1;
  }

  /** Once a frame, before anything is written. */
  begin(): void {
    this.counts[0] = 0;
    this.counts[1] = 0;
    this.counts[2] = 0;
  }

  crowdFor(kind: EnemyKind): Crowd | null {
    const at = slotOf(kind);
    return at === 0 ? this.grunts : at === 1 ? this.brutes : this.shields;
  }

  /** Where the next write into this kind's crowd starts. */
  writtenFor(kind: EnemyKind): number {
    return this.counts[slotOf(kind)] ?? 0;
  }

  /** Books `n` instances against this kind's crowd. */
  advance(kind: EnemyKind, n: number): void {
    const at = slotOf(kind);
    this.counts[at] = (this.counts[at] ?? 0) + n;
  }

  /** How long this kind's baked death runs for, so a one-shot plays once. */
  deathSeconds(kind: EnemyKind): number {
    return this.deaths[slotOf(kind)] ?? 1;
  }

  /** Uploads all three buffers and advances their shared clocks. Once a frame. */
  commit(dt: number): void {
    commitCrowd(this.grunts, this.counts[0] ?? 0, dt);
    commitCrowd(this.brutes, this.counts[1] ?? 0, dt);
    commitCrowd(this.shields, this.counts[2] ?? 0, dt);
  }

  dispose(): void {
    this.grunts?.dispose();
    this.brutes?.dispose();
    this.shields?.dispose();
    this.grunts = null;
    this.brutes = null;
    this.shields = null;
  }
}

/** Which of the three crowds a kind is drawn from. */
function slotOf(kind: EnemyKind): 0 | 1 | 2 {
  if (kind === 'shieldBrute') return 2;
  return kind === 'brute' ? 1 : 0;
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
 *
 * The blobs go in here rather than in `./enemies.ts` because this is the only
 * place a skeleton's own position exists: the cluster is scattered inside the
 * block's footprint from a hash, so a shadow written off `slot.x` would be one
 * disc under eighteen bodies. `shadowAlpha` is the block's distance fade, which
 * the caller has already worked out for the whole cluster (`ShadowLayer.fade`).
 *
 * `woke` is the seconds since the block set off, or -1: the wake cue's squash
 * (`wakeSquash`, document 31, 4.1), played by each skeleton a little later the
 * further back in the block it stands, so the crouch ripples through the mob.
 * `time` is the sim's clock, which only a held block's sway reads.
 */
export function writeCluster(
  crowd: Crowd,
  base: number,
  slot: ClusterSource,
  stance: BlockStance,
  dying: number,
  shadows: ShadowLayer | null,
  shadowAlpha: number,
  woke = -1,
  time = 0,
): number {
  const brute = slot.kind === 'brute' || slot.kind === 'shieldBrute';
  const scale = brute ? BRUTE_SCALE : GRUNT_SCALE;
  const wanted = dying >= 0 ? DEATH_INSTANCES : ENEMY_MAX_INSTANCES;
  const count = Math.min(slot.units, wanted, crowd.capacity - base);
  // Skeletons stand a body-width apart inside the block's own footprint, so
  // what the player sees is exactly what the sim will collide with.
  const spread = Math.max(0.25, slot.footprint - 0.2);
  const shadowRadius = brute ? SHADOW.brute : SHADOW.grunt;
  // Null when the block is out of the blob layer's range, so the inner loop is
  // one null check rather than two comparisons per skeleton.
  const blobs = shadowAlpha > 0 ? shadows : null;

  for (let i = 0; i < count; i++) {
    const across = hash(slot.enemyId * 131 + i * 17);
    const along = hash(slot.enemyId * 977 + i * 53);
    const x = slot.x + (across * 2 - 1) * spread;
    const z = slot.z + (along - 0.5) * ENEMY_CLUSTER_DEPTH;
    const phase = hash(slot.enemyId * 31 + i * 7);

    if (blobs !== null) blobs.add(x, z, shadowRadius, shadowAlpha);

    // The skeleton nearest the camera goes first: `along` is its place in the
    // block, and the camera looks up the road at the block's front.
    const squash = woke < 0 ? 0 : wakeSquash(woke - along * WAKE_SQUASH_STAGGER);

    if (dying >= 0) {
      crowd.setInstance(base + i, x, 0, z, FACING, scale, 'death', dying, 0);
    } else if (stance === 'held') {
      // The planted pose, rocked and breathing on each skeleton's own phase so
      // the line never sways as one piece. Speed zero: the offset is the pose.
      const sway = Math.sin((time * HOLD_SWAY_HZ + phase) * TAU);
      const breath = HOLD_BREATH * Math.sin((time * HOLD_BREATH_HZ + along) * TAU);
      crowd.setInstance(
        base + i,
        x,
        0,
        z,
        FACING + (phase - 0.5) * HOLD_YAW,
        scale * (1 + squash),
        'walk',
        HOLD_FRAME + sway * HOLD_SWAY,
        0,
        scale * (1 - squash) * (1 + breath),
      );
    } else if (stance === 'walking') {
      // One block in three runs at the squad rather than walking, which is the
      // second baked range Milestone 3 added earning its rows.
      const gait = slot.enemyId % 3 === 0 ? 'walk2' : 'walk';
      crowd.setInstance(
        base + i,
        x,
        0,
        z,
        FACING + (phase - 0.5) * 0.4,
        scale * (1 + squash),
        gait,
        phase,
        1,
        scale * (1 - squash),
      );
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
