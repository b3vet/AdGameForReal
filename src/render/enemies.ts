/**
 * Enemy blocks: a loose cluster of animated skeletons inside the block's own
 * footprint, with the block's remaining HP printed over it.
 *
 * There is no box any more. A block is `units` skeletons — minions for a grunt,
 * warriors for a brute — drawn from two crowds, so every block on the road
 * costs two draw calls between them however many blocks there are. The cluster
 * thins as the block loses units, and because a skeleton's spot in the cluster
 * is derived from its index, the survivors do not shuffle when one goes.
 *
 * Who draws a death depends on `setPhysicsQuality`: at 1 and 2 `src/physics`
 * throws real ragdolls, so this only takes the instances away; at 0 there is no
 * Havok at all and the baked `death` range plays here instead.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';

import type { Crowd } from './characters';
import { hideLabel, linkLabel, scaleLabel, type LabelLayer } from './labels';
import { loadCrowd } from './models';
import { RingPool } from './rings';
import {
  BLOCK_LABEL_CLEARANCE_BEHIND,
  BLOCK_LABEL_CLEARANCE_FRONT,
  BLOCK_LABEL_LANE_CLEARANCE,
  BRUTE_SCALE,
  CAMERA,
  ENEMY_CLUSTER_DEPTH,
  ENEMY_COLOR,
  ENEMY_DRAW_RANGE,
  ENEMY_LABEL_MIN,
  ENEMY_LABEL_SIZE,
  ENEMY_MAX_INSTANCES,
  GRUNT_SCALE,
  LABEL_BEHIND,
  LABEL_RANGE,
  POOL,
  SLOW_RING_COLOR,
} from './theme';
import { balance } from '@/data';
import { enemyFootprint, laneCenter } from '@/sim';
import type { EnemyKind, EnemyState, GateState, RunState } from '@/sim';

/** Skeletons face the squad, which is behind them down the road. */
const FACING = Math.PI;
/** Where the HP number is anchored: on the cluster, not floating above it. */
const LABEL_HEIGHT = 0.95;
/** Corpses the baked-death fallback plays; the plan's cap when physics is off. */
const DEATH_INSTANCES = 8;

interface EnemySlot {
  anchor: TransformNode;
  label: TextBlock;
  enemyId: number;
  kind: EnemyKind;
  x: number;
  z: number;
  units: number;
  /** Seconds into the baked death animation, or -1 while alive. */
  dying: number;
  /** Seconds of frost left on this block. */
  slow: number;
  footprint: number;
  seen: number;
  /** Last hp printed, so the label is only re-set when the number changes. */
  shownHp: number;
  /** Last font size applied; see `scaleLabel`. */
  shownSize: number;
}

export class EnemyView {
  private readonly scene: Scene;
  private readonly slots: EnemySlot[] = [];
  private readonly byEnemyId = new Map<number, EnemySlot>();
  private readonly rings: RingPool;

  private grunts: Crowd | null = null;
  private brutes: Crowd | null = null;
  private physicsQuality = 2;
  /** Per kind: the baked `death` range is shorter for a warrior than a minion. */
  private gruntDeath = 1;
  private bruteDeath = 1;
  private frame = 0;

  constructor(scene: Scene, labels: LabelLayer) {
    this.scene = scene;
    this.rings = new RingPool(scene, 'frostRing', SLOW_RING_COLOR, POOL.slowRings, {
      thickness: 0.1,
      alpha: 0.7,
      additive: true,
      y: 0.05,
    });

    for (let i = 0; i < POOL.enemies; i++) {
      const anchor = new TransformNode(`enemy-${String(i)}`, scene);
      const label = labels.create({ fontSize: ENEMY_LABEL_SIZE, color: '#ffe9e6', outline: 6 });
      linkLabel(label, anchor, 0);
      this.slots.push({
        anchor,
        label,
        enemyId: -1,
        kind: 'grunt',
        x: 0,
        z: 0,
        units: 0,
        dying: -1,
        slow: 0,
        footprint: 1,
        seen: 0,
        shownHp: Number.NaN,
        shownSize: Number.NaN,
      });
    }
  }

  async load(): Promise<void> {
    const [grunts, brutes] = await Promise.all([
      loadCrowd(this.scene, {
        modelId: 'skeleton_minion',
        capacity: POOL.grunts,
        fallbackColor: ENEMY_COLOR,
        fallbackName: 'grunt',
      }),
      loadCrowd(this.scene, {
        modelId: 'skeleton_warrior',
        capacity: POOL.brutes,
        fallbackColor: ENEMY_COLOR,
        fallbackName: 'brute',
      }),
    ]);
    this.grunts = grunts;
    this.brutes = brutes;
    this.gruntDeath = grunts.durationOf('death');
    this.bruteDeath = brutes.durationOf('death');
  }

  /** The frost decal glows; the skeletons themselves are lit, not emissive. */
  glowMeshes(): Mesh[] {
    return [this.rings.mesh];
  }

  /** 0 means no Havok, so this view owes the player a death animation. */
  setPhysicsQuality(quality: number): void {
    this.physicsQuality = quality;
  }

  reset(): void {
    this.byEnemyId.clear();
    for (const slot of this.slots) this.release(slot);
    this.rings.reset();
  }

  onKilled(enemyId: number): void {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined || slot.dying >= 0) return;
    hideLabel(slot.label);
    // Physics is throwing ragdolls for this block: two deaths for one kill
    // would read as double vision.
    if (this.physicsQuality > 0) this.release(slot);
    else slot.dying = 0;
  }

  /** Frost: the block comes apart into shards, so nothing is left to animate. */
  onShattered(enemyId: number): void {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined) return;
    this.release(slot);
  }

  onSlowed(enemyId: number, seconds: number): void {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined) return;
    slot.slow = Math.max(slot.slow, seconds);
  }

  /** Where a block is, for the chain effect to draw a line between two of them. */
  positionOf(enemyId: number, out: { x: number; z: number }): boolean {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined) return false;
    out.x = slot.x;
    out.z = slot.z;
    return true;
  }

  update(state: RunState, dt: number): void {
    this.frame++;
    const squadZ = state.squad.z;
    // Where the camera sits this frame, which is what turns metres of road into
    // pixels for `gateCrowdsLabel`. Hoisted out of the loop: one rig serves
    // every block on screen.
    const pullback = Math.min(CAMERA.pullbackMax, state.squad.count * CAMERA.pullbackPerUnit);
    const eye = squadZ - CAMERA.behind - pullback;

    const grunts = this.grunts;
    const brutes = this.brutes;
    let gruntCount = 0;
    let bruteCount = 0;
    this.rings.begin();

    for (const enemy of state.enemies) {
      if (enemy.kind === 'boss') continue;
      const slot = this.bind(enemy);
      if (slot === undefined || slot.dying >= 0) continue;
      slot.seen = this.frame;
      this.trackAlive(slot, enemy, state, dt);
      this.paintLabel(slot, enemy, state.gates, squadZ, eye);

      const ahead = enemy.z - squadZ;
      if (ahead > ENEMY_DRAW_RANGE || ahead < -LABEL_BEHIND * 2) continue;
      const crowd = enemy.kind === 'brute' ? brutes : grunts;
      if (crowd === null) continue;
      const base = enemy.kind === 'brute' ? bruteCount : gruntCount;
      const written = writeCluster(crowd, base, slot, enemy.active, -1);
      if (enemy.kind === 'brute') bruteCount += written;
      else gruntCount += written;
    }

    for (const slot of this.slots) {
      if (slot.enemyId < 0) continue;
      if (slot.dying >= 0) {
        slot.dying += dt;
        // Its own clip's length: run past it and the baked range wraps and the
        // block dies a second time (docs/ASSETS.md, open issue 4).
        if (slot.dying >= (slot.kind === 'brute' ? this.bruteDeath : this.gruntDeath)) {
          this.release(slot);
          continue;
        }
        const crowd = slot.kind === 'brute' ? brutes : grunts;
        if (crowd === null) continue;
        const base = slot.kind === 'brute' ? bruteCount : gruntCount;
        const written = writeCluster(crowd, base, slot, true, slot.dying);
        if (slot.kind === 'brute') bruteCount += written;
        else gruntCount += written;
      } else if (slot.seen !== this.frame) {
        // Walked off the back of the level rather than dying: no animation.
        this.release(slot);
      }
    }

    this.rings.end();
    commit(grunts, gruntCount, dt);
    commit(brutes, bruteCount, dt);
  }

  dispose(): void {
    for (const slot of this.slots) slot.anchor.dispose();
    this.slots.length = 0;
    this.byEnemyId.clear();
    this.rings.dispose();
    this.grunts?.dispose();
    this.brutes?.dispose();
    this.grunts = null;
    this.brutes = null;
  }

  private bind(enemy: EnemyState): EnemySlot | undefined {
    const existing = this.byEnemyId.get(enemy.id);
    if (existing !== undefined) return existing;
    if (!enemy.alive) return undefined;

    const slot = this.freeSlot();
    if (slot === undefined) return undefined;

    slot.enemyId = enemy.id;
    slot.kind = enemy.kind;
    slot.dying = -1;
    slot.slow = 0;
    slot.shownHp = Number.NaN;
    slot.shownSize = Number.NaN;

    this.byEnemyId.set(enemy.id, slot);
    return slot;
  }

  /** First unbound slot. An index loop, not `find`: this runs per block per
   *  frame and a closure per call is an allocation in the steady-state path. */
  private freeSlot(): EnemySlot | undefined {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot !== undefined && slot.enemyId < 0) return slot;
    }
    return undefined;
  }

  private trackAlive(slot: EnemySlot, enemy: EnemyState, state: RunState, dt: number): void {
    slot.x = enemy.x;
    slot.z = enemy.z;
    slot.units = Math.max(1, enemy.units);
    slot.footprint = enemyFootprint(enemy.kind, slot.units, balance);
    slot.anchor.position.set(enemy.x, LABEL_HEIGHT, enemy.z);

    // Two sources for the same fact, because both can be missing: the sim's
    // deadline is authoritative when it is there, and the event's countdown
    // covers the fixtures and hand-built states that carry no `slowUntil`.
    const remaining = enemy.slowUntil === undefined ? 0 : enemy.slowUntil - state.time;
    slot.slow = Math.max(slot.slow - dt, remaining);
    if (slot.slow > 0) this.rings.add(enemy.x, enemy.z, slot.footprint + 0.25);
  }

  private paintLabel(
    slot: EnemySlot,
    enemy: EnemyState,
    gates: readonly GateState[],
    squadZ: number,
    eye: number,
  ): void {
    const ahead = enemy.z - squadZ;
    const readable =
      ahead < LABEL_RANGE && ahead > -LABEL_BEHIND && !gateCrowdsLabel(gates, enemy, eye);
    slot.label.isVisible = readable;
    if (!readable) return;

    const hp = Math.max(0, Math.round(enemy.hp));
    if (hp !== slot.shownHp) {
      slot.shownHp = hp;
      slot.label.text = String(hp);
    }
    slot.shownSize = scaleLabel(
      slot.label,
      ENEMY_LABEL_SIZE,
      ENEMY_LABEL_MIN,
      ahead,
      slot.shownSize,
    );
  }

  private release(slot: EnemySlot): void {
    if (slot.enemyId >= 0) this.byEnemyId.delete(slot.enemyId);
    slot.enemyId = -1;
    slot.dying = -1;
    slot.slow = 0;
    slot.shownHp = Number.NaN;
    slot.shownSize = Number.NaN;
    hideLabel(slot.label);
  }
}

function commit(crowd: Crowd | null, count: number, dt: number): void {
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
function writeCluster(
  crowd: Crowd,
  base: number,
  slot: EnemySlot,
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
      crowd.setInstance(base + i, x, 0, z, FACING + (phase - 0.5) * 0.4, scale, 'walk', phase);
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

/**
 * True when an unpassed gate stands close enough to this block, in its own lane,
 * for the two to print on the same patch of screen. The gate's number wins,
 * because that is the choice the player is about to make.
 *
 * The window is measured from the camera (`eye`), not from the squad: at 11 m
 * row spacing a block guarding the next row stands about five metres beyond the
 * row in front of it, and those five metres are a readable gap at the nearest
 * row and a stack of digits two rows out. So a block loses its number while the
 * row in front of it is still a decision, and gets it back once that row is
 * behind the squad — which is also when its HP is what the player is reading.
 */
function gateCrowdsLabel(gates: readonly GateState[], enemy: EnemyState, eye: number): boolean {
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === undefined || gate.passed) continue;
    if (Math.abs(laneCenter(gate.lane) - enemy.x) > BLOCK_LABEL_LANE_CLEARANCE) continue;

    const gap = enemy.z - gate.z;
    const share = gap >= 0 ? BLOCK_LABEL_CLEARANCE_BEHIND : BLOCK_LABEL_CLEARANCE_FRONT;
    if (Math.abs(gap) < (gate.z - eye) * share) return true;
  }
  return false;
}
