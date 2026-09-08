/**
 * The squad: a crowd of animated apprentice mages, one baked-animation thin
 * instance per unit, placed at `formationOffsets(count)` around
 * `(squad.x, squad.z)`.
 *
 * All three staffs are loaded at init and only the one in hand is drawn, so a
 * `weapon` gate swaps a mesh rather than loading anything mid-run. Because the
 * per-instance offsets are derived from the formation index and not stored on
 * the crowd, the swap keeps every mage exactly where it was.
 *
 * Count changes are read, not told: the view diffs `count` against the previous
 * frame. Because the phyllotaxis offset for index `i` does not depend on the
 * total, a unit keeps its place in the spiral as the squad grows, so growth
 * looks like recruits joining the edge rather than the whole blob reshuffling.
 */

import type { Scene } from '@babylonjs/core/scene';

import type { Crowd } from './characters';
import { loadCrowd } from './models';
import {
  CASTING_SHARE,
  CROWD_SCALE_FROM,
  CROWD_SCALE_MIN,
  CROWD_SCALE_TO,
  DEATH_DURATION,
  EMBER_COLOR,
  FROST_COLOR,
  MAGE_SCALE,
  POOL,
  POP_DURATION,
  STORM_COLOR,
} from './theme';
import { formationOffsets, startWeapon, weaponIds, weaponOf } from '@/sim';
import type { RunStatus, SquadState, WeaponId } from '@/sim';

/** Sentinel in `spawnAge`: this unit finished its pop and needs no animation. */
const SETTLED = 1e9;

/** Metres of forward travel per second below which the squad counts as stopped. */
const ADVANCE_EPSILON = 0.05;

/** Fallback capsule colours, one per staff, when the model cannot be loaded. */
const FALLBACK_COLORS: Record<WeaponId, typeof EMBER_COLOR> = {
  ember: EMBER_COLOR,
  storm: STORM_COLOR,
  frost: FROST_COLOR,
};

interface Corpse {
  x: number;
  z: number;
  age: number;
  /** The crowd scale this unit died at, so it shrinks from the size it had. */
  scale: number;
}

export class SquadView {
  private readonly scene: Scene;
  private readonly crowds = new Map<WeaponId, Crowd>();
  private active: WeaponId = startWeapon;

  /** Seconds since unit `i` appeared, or `SETTLED`. Indexed by formation slot. */
  private readonly spawnAge = new Float32Array(POOL.squad);

  /** Fixed-size ring of shrinking corpses; a full pool simply drops the extras. */
  private readonly corpses: Corpse[] = [];
  private corpseCount = 0;

  private previousCount = -1;
  private previousZ = Number.NaN;
  private advancing = false;
  private cheering = false;

  constructor(scene: Scene) {
    this.scene = scene;
    for (let i = 0; i < POOL.dyingUnits; i++) {
      this.corpses.push({ x: 0, z: 0, age: 0, scale: 1 });
    }
  }

  /** Loads all three staffs. Called once, from `Renderer.init`. */
  async load(): Promise<void> {
    const capacity = POOL.squad + POOL.dyingUnits;
    const loaded = await Promise.all(
      weaponIds.map(async (id) =>
        loadCrowd(this.scene, {
          modelId: 'mage',
          variant: id,
          capacity,
          fallbackColor: FALLBACK_COLORS[id],
          fallbackName: `mage-${id}`,
        }),
      ),
    );
    weaponIds.forEach((id, index) => {
      const crowd = loaded[index];
      if (crowd === undefined) return;
      // A crowd starts hidden and `commit` turns it on when it has instances,
      // so nothing here has to enable anything.
      this.crowds.set(id, crowd);
    });
  }

  /** New level: the starting squad is simply there, with no pop animation, and
   *  nothing is left standing from the run before. */
  reset(): void {
    this.previousCount = -1;
    this.previousZ = Number.NaN;
    this.corpseCount = 0;
    this.cheering = false;
    this.advancing = false;
    for (const crowd of this.crowds.values()) {
      crowd.setCount(0);
      crowd.commit();
    }
  }

  /** The squad picked up a different staff: draw the crowd that carries it. */
  setWeapon(weaponId: WeaponId): void {
    if (weaponId === this.active) return;
    // The old crowd keeps its stale instances but stops being drawn; the new
    // one is rewritten in full by the `update` that follows and enables itself
    // when it commits, so nothing has to be copied across.
    this.crowds.get(this.active)?.mesh.setEnabled(false);
    this.active = weaponId;
  }

  /** Won: the survivors cheer until the next level is loaded. */
  onRunEnded(status: RunStatus): void {
    this.cheering = status === 'won';
  }

  update(squad: SquadState, arenaZ: number, dt: number): void {
    this.setWeapon(weaponOf(squad));
    const crowd = this.crowds.get(this.active);
    if (crowd === undefined) return;

    const count = Math.min(POOL.squad, Math.max(0, Math.floor(squad.count)));
    const crowdScaleNow = crowdScale(count);
    this.diffCount(count, squad.x, squad.z, crowdScaleNow);
    this.trackMotion(squad.z, dt);

    const inArena = squad.z >= arenaZ - 0.5;
    const offsets = formationOffsets(count);

    for (let i = 0; i < count; i++) {
      const offset = offsets[i];
      if (offset === undefined) continue;

      let scale = crowdScaleNow;
      const age = this.spawnAge[i] ?? SETTLED;
      if (age < POP_DURATION) {
        scale = crowdScaleNow * popScale(age);
        this.spawnAge[i] = age + dt;
      } else if (age !== SETTLED) {
        this.spawnAge[i] = SETTLED;
      }

      crowd.setInstance(
        i,
        squad.x + offset.x,
        0,
        squad.z + offset.z,
        yawOf(i),
        scale * MAGE_SCALE,
        this.animationFor(i, inArena),
        timeOffsetOf(i),
      );
    }

    const dying = this.writeCorpses(crowd, count, dt);
    crowd.setCount(count + dying);
    crowd.commit();
    crowd.update(dt);
  }

  dispose(): void {
    for (const crowd of this.crowds.values()) crowd.dispose();
    this.crowds.clear();
  }

  /**
   * A VAT cannot blend, so the crowd's "firing while running" look is built out
   * of whole units: one mage in `CASTING_SHARE` throws a spell at any moment
   * while the rest run, which at any squad size reads as a firing crowd and
   * hides the fact that each unit's animation is a hard cut.
   */
  private animationFor(index: number, inArena: boolean): string {
    if (this.cheering) return 'cheer';
    if (this.advancing) return index % CASTING_SHARE === 0 ? 'cast' : 'run';
    return inArena ? 'cast' : 'idle';
  }

  private trackMotion(z: number, dt: number): void {
    const previous = this.previousZ;
    this.previousZ = z;
    if (Number.isNaN(previous) || dt <= 0) return;
    this.advancing = (z - previous) / dt > ADVANCE_EPSILON;
  }

  private diffCount(count: number, x: number, z: number, crowd: number): void {
    const previous = this.previousCount;
    this.previousCount = count;

    if (previous < 0) {
      // First frame of a level: everyone is already standing.
      this.spawnAge.fill(SETTLED);
      return;
    }

    if (count > previous) {
      for (let i = previous; i < count; i++) this.spawnAge[i] = 0;
      return;
    }

    if (count < previous) {
      // Offsets for index `i` are the same at any total, so the outgoing units
      // die exactly where they were standing.
      const offsets = formationOffsets(previous);
      for (let i = count; i < previous; i++) {
        const offset = offsets[i];
        if (offset === undefined) continue;
        this.pushCorpse(x + offset.x, z + offset.z, crowd);
      }
    }
  }

  private pushCorpse(x: number, z: number, scale: number): void {
    if (this.corpseCount >= POOL.dyingUnits) return;
    const corpse = this.corpses[this.corpseCount];
    if (corpse === undefined) return;
    corpse.x = x;
    corpse.z = z;
    corpse.age = 0;
    corpse.scale = scale;
    this.corpseCount++;
  }

  /**
   * Shrinking corpses, written into the same instance buffer straight after the
   * live units: same mesh, same draw call, and the dead keep the staff the
   * squad was holding when they fell.
   */
  private writeCorpses(crowd: Crowd, base: number, dt: number): number {
    let write = 0;
    for (let i = 0; i < this.corpseCount; i++) {
      const corpse = this.corpses[i];
      if (corpse === undefined) continue;
      corpse.age += dt;
      if (corpse.age >= DEATH_DURATION) continue;

      const fade = 1 - corpse.age / DEATH_DURATION;
      crowd.setInstance(
        base + write,
        corpse.x,
        0,
        corpse.z,
        yawOf(i),
        corpse.scale * MAGE_SCALE * fade,
        'idle',
        timeOffsetOf(i),
      );

      const kept = this.corpses[write];
      if (kept !== undefined && write !== i) {
        kept.x = corpse.x;
        kept.z = corpse.z;
        kept.age = corpse.age;
        kept.scale = corpse.scale;
      }
      write++;
    }
    this.corpseCount = write;
    return write;
  }
}

/** A little turn per unit, so five hundred mages are not one rigid block. */
function yawOf(index: number): number {
  return ((index % 7) - 3) * 0.05;
}

/** Seconds into the loop, spread over the crowd so nobody marches in lockstep. */
function timeOffsetOf(index: number): number {
  return (index % 29) * 0.041;
}

/** Full size for a small squad, easing to `CROWD_SCALE_MIN` at the count cap. */
function crowdScale(count: number): number {
  if (count <= CROWD_SCALE_FROM) return 1;
  const t = Math.min(1, (count - CROWD_SCALE_FROM) / (CROWD_SCALE_TO - CROWD_SCALE_FROM));
  return 1 + (CROWD_SCALE_MIN - 1) * t;
}

/** Ease-out-back: overshoots past 1 then settles, which reads as a pop. */
function popScale(age: number): number {
  const p = Math.min(1, age / POP_DURATION) - 1;
  const overshoot = 1.7;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}
