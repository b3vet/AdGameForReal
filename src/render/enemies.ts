/**
 * Everything on the road that is not the boss: the blocks with their HP
 * numbers, the chargers that run a lane down, and the streams of single bodies
 * pouring between them.
 *
 * A block is `units` skeletons — minions for a grunt, warriors for a brute, the
 * same warriors carrying the pack's shield for a shielded brute (D49) — drawn
 * from three crowds, so every block on the road costs three draw calls between
 * them however many blocks there are. The cluster thins as the block loses
 * units, and because a skeleton's spot in the cluster is derived from its
 * index, the survivors do not shuffle when one goes.
 *
 * The stream bodies (D29) go into the *same* minion crowd, after the blocks:
 * three hundred of them and every grunt block on screen are one draw call
 * together. They carry no slot, no label and no per-body state here — see
 * `./streamBodies.ts` for why — and only the stream's own floating count is
 * drawn over them.
 *
 * A charger is not a block at all: one body, its own clips, its own crowd and
 * its own dust (`./chargers.ts`). It keeps a slot here because it needs exactly
 * what a block needs from this file — a label, a death clock and a place in the
 * id map — and nothing else.
 *
 * The slots themselves, and the numbers they print, are `./enemySlots.ts`.
 *
 * Who draws a block's death depends on `setPhysicsQuality`: at 1 and 2
 * `src/physics` throws real ragdolls, so this only takes the instances away; at
 * 0 there is no Havok at all and the baked `death` range plays here instead. A
 * charger is the exception and always plays its own, because the ragdoll pool
 * is made of skeletons and a charger is not one.
 */

import type { Scene } from '@babylonjs/core/scene';

import { ChargerBodies } from './chargers';
import { BlockCrowds, writeCluster } from './enemyBlocks';
import { EnemySlotBook } from './enemySlots';
import type { EnemySlot } from './enemySlots';
import type { GroundDecals } from './groundDecals';
import { createLabelView, setLabelView } from './labelClearance';
import type { LabelView } from './labelClearance';
import type { NumberLabels } from './labels';
import { RingPool } from './rings';
import { ShadowLayer } from './shadows';
import { StreamBodies } from './streamBodies';
import {
  CHARGER_ATTACK_RANGE,
  ENEMY_DRAW_RANGE,
  LABEL_BEHIND,
  POOL,
  SLOW_RING_COLOR,
} from './theme';
import { balance } from '@/data';
import { laneCenter } from '@/sim';
import type { EnemyState, RunState } from '@/sim';

export class EnemyView {
  private readonly scene: Scene;
  private readonly rings: RingPool;
  private readonly streams: StreamBodies;
  /** Ids to slots, and the numbers a slot prints (`./enemySlots.ts`). */
  private readonly book: EnemySlotBook;
  /** The three block crowds and their per-frame counts (`./enemyBlocks.ts`). */
  private readonly crowds = new BlockCrowds();
  /** The chargers, which are bodies rather than blocks (`./chargers.ts`). */
  private readonly chargers = new ChargerBodies();
  private readonly decals: GroundDecals;

  private physicsQuality = 0;
  private frame = 0;
  /** The last state drawn, for `positionOf` to find a stream body in. Read
   *  only; the renderer never mutates sim state. */
  private lastState: RunState | null = null;
  /** The camera pose the label-clearance rule reads. Written once a frame. */
  private readonly view: LabelView = createLabelView();

  /**
   * `decals` is the frame's shared ground-mark batch, opened around this view's
   * `update` by `Renderer`: a charger's dust goes into it, so the trail behind
   * a running body costs no draw call of its own.
   */
  constructor(scene: Scene, labels: NumberLabels, decals: GroundDecals) {
    this.scene = scene;
    this.decals = decals;
    this.book = new EnemySlotBook(labels, POOL.enemies);
    this.streams = new StreamBodies(labels);
    this.rings = new RingPool(scene, 'frostRing', SLOW_RING_COLOR, POOL.slowRings, {
      thickness: 0.1,
      alpha: 0.7,
      additive: true,
      y: 0.05,
    });
  }

  async load(): Promise<void> {
    await Promise.all([this.crowds.load(this.scene), this.chargers.load(this.scene)]);
    this.streams.setDeathSeconds(this.crowds.deathSeconds('grunt'));
  }

  /**
   * 0 means no Havok, so this view owes the player a death animation. It is
   * also where the view starts: the layer is loaded in the background and only
   * says what it can do once it is up (`Renderer.physicsQuality`).
   */
  setPhysicsQuality(quality: number): void {
    this.physicsQuality = quality;
  }

  reset(): void {
    this.book.releaseAll();
    this.rings.reset();
    this.streams.reset();
    this.chargers.reset();
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
   *
   * `z` is where the sim says it died, which is the only thing that separates a
   * charger that reached the crowd from one that was shot on the way in: both
   * arrive as this one event (`src/sim/contact.ts`).
   */
  onKilled(enemyId: number, z?: number): void {
    const slot = this.book.get(enemyId);
    if (slot === undefined || slot.dying >= 0) return;
    if (slot.kind === 'charger') {
      const squadZ = this.lastState?.squad.z ?? Number.NEGATIVE_INFINITY;
      slot.death = (z ?? slot.z) - squadZ <= CHARGER_ATTACK_RANGE ? 'arrived' : 'shot';
      slot.dying = 0;
      return;
    }
    // Physics is throwing ragdolls for this block: two deaths for one kill
    // would read as double vision.
    if (this.physicsQuality > 0) this.book.release(slot);
    else slot.dying = 0;
  }

  /** Frost: the block comes apart into shards, so nothing is left to animate. */
  onShattered(enemyId: number): void {
    const slot = this.book.get(enemyId);
    if (slot === undefined) return;
    this.book.release(slot);
  }

  onSlowed(enemyId: number, seconds: number): void {
    const slot = this.book.get(enemyId);
    if (slot === undefined) return;
    slot.slow = Math.max(slot.slow, seconds);
  }

  /**
   * A shielded brute's shield reached zero (D49). The shield count stops being
   * printed and the body's own number turns to the alarm colour for the rest of
   * its life: the block the player could not hurt is now the block they can.
   */
  onShieldBreak(enemyId: number): void {
    const slot = this.book.get(enemyId);
    if (slot === undefined) return;
    slot.broken = true;
  }

  /**
   * Where an enemy is, for the chain effect to draw an arc between two of them.
   *
   * Blocks answer from their slot. Stream bodies have no slot, so they are
   * looked up by a scan of the state the last `update` was given — up to three
   * hundred comparisons, but only on a `chain` event, of which there are at
   * most `POOL.chains` in a frame.
   */
  /**
   * Every live body within `radius` of `(x, z)`, up to `cap`, as positions.
   *
   * For storm's overcharge (D54), whose event says *how many* bodies the volley
   * reached rather than which: the sim damaged them as it walked its own lane
   * lists, and the set inside a circle is the same set however it is found. A
   * scan of the last state drawn, on an event that fires at most every fifth
   * volley — the same budget `positionOf` above already spends on a chain.
   */
  forEachNear(
    x: number,
    z: number,
    radius: number,
    cap: number,
    visit: (x: number, z: number) => void,
  ): void {
    const enemies = this.lastState?.enemies;
    if (enemies === undefined) return;
    const squared = radius * radius;
    let found = 0;
    for (let i = 0; i < enemies.length && found < cap; i++) {
      const enemy = enemies[i];
      if (enemy === undefined || !enemy.alive) continue;
      const dx = enemy.x - x;
      const dz = enemy.z - z;
      if (dx * dx + dz * dz > squared) continue;
      found++;
      visit(enemy.x, enemy.z);
    }
  }

  positionOf(enemyId: number, out: { x: number; z: number }): boolean {
    const slot = this.book.get(enemyId);
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

  /**
   * `shadows` is the scene's blob layer, already opened by the frame. Every
   * body on the road gets a contact patch: the blocks' through `writeCluster`,
   * the rivers' through `StreamBodies.write`, the chargers' through their own
   * view (D38, wired here in Phase E).
   */
  update(state: RunState, dt: number, shadows: ShadowLayer | null): void {
    this.frame++;
    this.lastState = state;
    const squadZ = state.squad.z;
    // Where the camera sits this frame, which is what turns metres of road into
    // pixels for the label-clearance rule. Hoisted out of the loop and written
    // into one re-used object: one rig serves every block and every stream on
    // screen.
    const view = setLabelView(this.view, squadZ, state.squad.count, state.squad.formationWidth);

    this.crowds.begin();
    this.chargers.begin();
    this.rings.begin();

    for (const enemy of state.enemies) {
      if (enemy.kind === 'boss') continue;
      // Stream bodies are drawn in one pass below and carry no slot, no label
      // and no frost ring: a river of three hundred would otherwise claim every
      // block slot in the pool on its first frame.
      if (enemy.streamId !== undefined) continue;
      const slot = this.book.bind(enemy);
      if (slot === undefined || slot.dying >= 0) continue;
      slot.seen = this.frame;
      const slow = this.book.track(slot, enemy, state, dt);
      if (slow > 0) this.rings.add(enemy.x, enemy.z, slot.footprint + 0.25);
      this.book.paint(slot, enemy, state.gates, squadZ, view);

      const ahead = enemy.z - squadZ;
      if (ahead > ENEMY_DRAW_RANGE || ahead < -LABEL_BEHIND * 2) continue;
      this.writeBody(slot, enemy, shadows, ShadowLayer.fade(ahead), state.time);
    }

    this.sweep(dt, shadows);

    // The streams go into the minion crowd after every block, so both are one
    // draw call, and their floating counts into the shared glyph atlas.
    const grunts = this.crowds.crowdFor('grunt');
    if (grunts !== null) {
      const base = this.crowds.writtenFor('grunt');
      this.crowds.advance(
        'grunt',
        this.streams.write(grunts, base, state, this.physicsQuality, shadows),
      );
    }
    this.streams.writeLabels(state.streams, squadZ, state.gates, view);

    this.rings.end();
    this.crowds.commit(dt);
    this.chargers.commit(this.decals, dt, state.time);
  }

  /** Stream bodies drawn last frame, for the debug panel and the dev harness. */
  get streamBodies(): number {
    return this.streams.count;
  }

  /** Chargers drawn last frame, for the same two readers. */
  get chargerBodies(): number {
    return this.chargers.count;
  }

  dispose(): void {
    this.book.releaseAll();
    this.lastState = null;
    this.streams.dispose();
    this.rings.dispose();
    this.chargers.dispose();
    this.crowds.dispose();
  }

  /**
   * One live body into whichever crowd draws its kind. `time` is the sim's
   * clock, which only the charger's dust reads (`./frostSpray.ts`).
   */
  private writeBody(
    slot: EnemySlot,
    enemy: EnemyState,
    shadows: ShadowLayer | null,
    shadowAlpha: number,
    time: number,
  ): void {
    if (enemy.kind === 'charger') {
      this.chargers.writeLive(
        enemy.id,
        enemy.x,
        enemy.z,
        slot.charging,
        slot.charging ? laneCenter(enemy.charge?.lane ?? 0, balance.road.laneWidth) - enemy.x : 0,
        shadows,
        shadowAlpha,
        time,
      );
      return;
    }
    const crowd = this.crowds.crowdFor(enemy.kind);
    if (crowd === null) return;
    const written = writeCluster(
      crowd,
      this.crowds.writtenFor(enemy.kind),
      slot,
      enemy.active,
      -1,
      shadows,
      shadowAlpha,
    );
    this.crowds.advance(enemy.kind, written);
  }

  /**
   * Ages the dying, draws them, and releases the slots of bodies that simply
   * walked off the back of the level.
   */
  private sweep(dt: number, shadows: ShadowLayer | null): void {
    for (const slot of this.book.slots) {
      if (slot.enemyId < 0) continue;
      if (slot.dying < 0) {
        // Walked off the back of the level rather than dying: no animation.
        if (slot.seen !== this.frame) this.book.release(slot);
        continue;
      }

      slot.dying += dt;
      if (slot.kind === 'charger') {
        // Its own clips' length: run past it and the baked range wraps and the
        // body dies a second time (docs/ASSETS.md, open issue 4).
        if (slot.dying >= this.chargers.deathLength(slot.death)) {
          this.book.release(slot);
          continue;
        }
        this.chargers.writeDying(slot.x, slot.z, slot.dying, slot.death);
        continue;
      }

      if (slot.dying >= this.crowds.deathSeconds(slot.kind)) {
        this.book.release(slot);
        continue;
      }
      const crowd = this.crowds.crowdFor(slot.kind);
      if (crowd === null) continue;
      // A dying block's blob goes with it: the bodies are falling over, and a
      // full-strength disc under a corpse outlives the corpse.
      const written = writeCluster(
        crowd,
        this.crowds.writtenFor(slot.kind),
        slot,
        true,
        slot.dying,
        shadows,
        0,
      );
      this.crowds.advance(slot.kind, written);
    }
  }
}
