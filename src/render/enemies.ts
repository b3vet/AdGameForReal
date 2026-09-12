/**
 * Everything on the road that is not the boss: the brute and grunt blocks with
 * their HP numbers, and the streams of single bodies pouring between them.
 *
 * A block is `units` skeletons — minions for a grunt, warriors for a brute —
 * drawn from two crowds, so every block on the road costs two draw calls
 * between them however many blocks there are. The cluster thins as the block
 * loses units, and because a skeleton's spot in the cluster is derived from its
 * index, the survivors do not shuffle when one goes.
 *
 * The stream bodies (D29) go into the *same* minion crowd, after the blocks:
 * three hundred of them and every grunt block on screen are one draw call
 * together. They carry no slot, no label and no per-body state here — see
 * `./streamBodies.ts` for why — and only the stream's own floating count is
 * drawn over them.
 *
 * Who draws a block's death depends on `setPhysicsQuality`: at 1 and 2
 * `src/physics` throws real ragdolls, so this only takes the instances away; at
 * 0 there is no Havok at all and the baked `death` range plays here instead.
 */

import type { Scene } from '@babylonjs/core/scene';

import type { Crowd } from './characters';
import { commitCrowd, gateCrowdsLabel, writeCluster } from './enemyBlocks';
import { labelPixels, type NumberLabels } from './labels';
import { loadCrowd } from './models';
import { RingPool } from './rings';
import { StreamBodies } from './streamBodies';
import {
  CAMERA,
  ENEMY_COLOR,
  ENEMY_DRAW_RANGE,
  ENEMY_LABEL_COLOR,
  ENEMY_LABEL_MIN,
  ENEMY_LABEL_SIZE,
  LABEL_BEHIND,
  LABEL_RANGE,
  POOL,
  SLOW_RING_COLOR,
} from './theme';
import { balance } from '@/data';
import { enemyFootprint } from '@/sim';
import type { EnemyKind, EnemyState, GateState, RunState } from '@/sim';

/** Where the HP number is anchored: on the cluster, not floating above it. */
const LABEL_HEIGHT = 0.95;

interface EnemySlot {
  /** This slot's label id in the shared atlas; see `src/render/labels.ts`. */
  label: number;
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
  /** Last hp printed, so the string is only rebuilt when the number changes. */
  shownHp: number;
  /** The string that number produced, handed back to the atlas every frame. */
  shownText: string;
}

export class EnemyView {
  private readonly scene: Scene;
  private readonly labels: NumberLabels;
  private readonly slots: EnemySlot[] = [];
  private readonly byEnemyId = new Map<number, EnemySlot>();
  private readonly rings: RingPool;
  private readonly streams: StreamBodies;

  private grunts: Crowd | null = null;
  private brutes: Crowd | null = null;
  private physicsQuality = 2;
  /** Per kind: the baked `death` range is shorter for a warrior than a minion. */
  private gruntDeath = 1;
  private bruteDeath = 1;
  private frame = 0;
  /** The last state drawn, for `positionOf` to find a stream body in. Read
   *  only; the renderer never mutates sim state. */
  private lastState: RunState | null = null;

  constructor(scene: Scene, labels: NumberLabels) {
    this.scene = scene;
    this.labels = labels;
    this.streams = new StreamBodies(labels);
    this.rings = new RingPool(scene, 'frostRing', SLOW_RING_COLOR, POOL.slowRings, {
      thickness: 0.1,
      alpha: 0.7,
      additive: true,
      y: 0.05,
    });

    for (let i = 0; i < POOL.enemies; i++) {
      this.slots.push({
        label: labels.claim(),
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
        shownText: '',
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
    this.streams.setDeathSeconds(this.gruntDeath);
  }

  /** 0 means no Havok, so this view owes the player a death animation. */
  setPhysicsQuality(quality: number): void {
    this.physicsQuality = quality;
  }

  reset(): void {
    this.byEnemyId.clear();
    for (const slot of this.slots) this.release(slot);
    this.rings.reset();
    this.streams.reset();
  }

  /**
   * A stream body walked into the squad. It is taken off the road rather than
   * animated — it did not die, it arrived — and `Renderer` puts a puff where it
   * was.
   */
  onLeaked(enemyId: number): void {
    this.streams.onLeaked(enemyId);
  }

  /**
   * A block died. Stream bodies are not routed here at all: their death is read
   * off `EnemyState.diedAt` every frame (`./streamBodies.ts`), so there is
   * nothing for an event to start.
   */
  onKilled(enemyId: number): void {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined || slot.dying >= 0) return;
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

  /**
   * Where an enemy is, for the chain effect to draw an arc between two of them.
   *
   * Blocks answer from their slot. Stream bodies have no slot, so they are
   * looked up by a scan of the state the last `update` was given — up to three
   * hundred comparisons, but only on a `chain` event, of which there are at
   * most `POOL.chains` in a frame.
   */
  positionOf(enemyId: number, out: { x: number; z: number }): boolean {
    const slot = this.byEnemyId.get(enemyId);
    if (slot !== undefined) {
      out.x = slot.x;
      out.z = slot.z;
      return true;
    }

    const enemies = this.lastState?.enemies;
    if (enemies === undefined) return false;
    for (let i = 0; i < enemies.length; i++) {
      const enemy = enemies[i];
      if (enemy === undefined || enemy.id !== enemyId || !enemy.alive) continue;
      out.x = enemy.x;
      out.z = enemy.z;
      return true;
    }
    return false;
  }

  update(state: RunState, dt: number): void {
    this.frame++;
    this.lastState = state;
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
      // Stream bodies are drawn in one pass below and carry no slot, no label
      // and no frost ring: a river of three hundred would otherwise claim every
      // block slot in the pool on its first frame.
      if (enemy.streamId !== undefined) continue;
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

    // The streams go into the minion crowd after every block, so both are one
    // draw call, and their floating counts into the shared glyph atlas.
    if (grunts !== null) {
      gruntCount += this.streams.write(grunts, gruntCount, state, this.physicsQuality);
    }
    this.streams.writeLabels(state.streams, squadZ);

    this.rings.end();
    commitCrowd(grunts, gruntCount, dt);
    commitCrowd(brutes, bruteCount, dt);
  }

  /** Stream bodies drawn last frame, for the debug panel and the dev harness. */
  get streamBodies(): number {
    return this.streams.count;
  }

  dispose(): void {
    this.slots.length = 0;
    this.byEnemyId.clear();
    this.lastState = null;
    this.streams.dispose();
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
    slot.shownText = '';

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
    if (!readable) return;

    const hp = Math.max(0, Math.round(enemy.hp));
    if (hp !== slot.shownHp) {
      slot.shownHp = hp;
      slot.shownText = String(hp);
    }
    this.labels.set(
      slot.label,
      slot.shownText,
      enemy.x,
      LABEL_HEIGHT,
      enemy.z,
      ENEMY_LABEL_COLOR,
      labelPixels(ENEMY_LABEL_SIZE, ENEMY_LABEL_MIN, ahead),
    );
  }

  private release(slot: EnemySlot): void {
    if (slot.enemyId >= 0) this.byEnemyId.delete(slot.enemyId);
    slot.enemyId = -1;
    slot.dying = -1;
    slot.slow = 0;
    slot.shownHp = Number.NaN;
    slot.shownText = '';
  }
}
