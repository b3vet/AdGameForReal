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
import { loadCrowds } from './models';
import {
  ADVANCE_SMOOTHING,
  ADVANCE_START_SPEED,
  ADVANCE_STOP_SPEED,
  CASTING_SHARE,
  CAST2_CLIP_SPEED,
  CAST_CLIP_SPEED,
  CROWD_SCALE_FROM,
  CROWD_SCALE_MIN,
  DEATH_DURATION,
  EMBER_COLOR,
  FROST_COLOR,
  GATE_BOUNCE_DURATION,
  GATE_BOUNCE_HEIGHT,
  IDLE_CLIP_SPEED,
  IDLE_SWAY_LIFT,
  IDLE_SWAY_RATE,
  IDLE_SWAY_YAW,
  MAGE_LIFT,
  MAGE_SCALE,
  POOL,
  POP_DURATION,
  POP_STRETCH,
  RUN_CLIP_SPEED,
  STORM_COLOR,
} from './theme';
import { formationOffsets, startWeapon, unitSpacing, weaponIds, weaponOf } from '@/sim';
import type { RunStatus, SquadState, WeaponId } from '@/sim';

/** Sentinel in `spawnAge`: this unit finished its pop and needs no animation. */
const SETTLED = 1e9;

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
  /**
   * The formation slot this unit stood in. Its yaw and animation phase are
   * derived from it, and the ring compacts as corpses expire, so deriving them
   * from the *slot in the ring* instead would swing a dying mage's facing every
   * time an older one finished.
   */
  index: number;
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
  /** Low-passed forward speed in metres a second, `NaN` until primed. */
  private advanceSpeed = Number.NaN;
  private cheering = false;
  /** Seconds left of the hop the squad takes through a gate row, or 0. */
  private bounce = 0;
  /** The idle sway's own clock, in seconds of sim time. */
  private swayPhase = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    for (let i = 0; i < POOL.dyingUnits; i++) {
      this.corpses.push({ x: 0, z: 0, age: 0, scale: 1, index: 0 });
    }
  }

  /**
   * Loads all three staffs, from one parse of `mage.glb`: the file carries all
   * three props and one baked texture drives every one of them.
   */
  async load(): Promise<void> {
    const capacity = POOL.squad + POOL.dyingUnits;
    const loaded = await loadCrowds(this.scene, {
      modelId: 'mage',
      variants: weaponIds,
      capacity,
      fallbackColor: FALLBACK_COLORS[startWeapon],
      fallbackColors: FALLBACK_COLORS,
      fallbackName: 'mage',
      lift: MAGE_LIFT,
    });
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
    this.advanceSpeed = Number.NaN;
    this.corpseCount = 0;
    this.cheering = false;
    this.advancing = false;
    this.bounce = 0;
    this.swayPhase = 0;
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

  /**
   * The squad crossed a gate row: everyone hops. Restarted rather than
   * accumulated, so passing two rows in one turbo frame is one hop and not a
   * crowd bouncing at double height.
   */
  onGatePassed(): void {
    this.bounce = GATE_BOUNCE_DURATION;
  }

  update(squad: SquadState, arenaZ: number, dt: number): void {
    this.setWeapon(weaponOf(squad));
    const crowd = this.crowds.get(this.active);
    if (crowd === undefined) return;

    const count = Math.min(POOL.squad, Math.max(0, Math.floor(squad.count)));
    const crowdScaleNow = crowdScale(count);
    this.diffCount(count, squad.x, squad.z, crowdScaleNow);
    this.trackMotion(squad.z, dt);

    this.swayPhase += dt;
    this.bounce = Math.max(0, this.bounce - dt);

    const inArena = squad.z >= arenaZ - 0.5;
    const offsets = formationOffsets(count);
    // One hop for the whole crowd, so a row crossing reads as a beat rather
    // than as five hundred units each doing their own thing.
    const hop =
      this.bounce <= 0
        ? 0
        : Math.sin((1 - this.bounce / GATE_BOUNCE_DURATION) * Math.PI) * GATE_BOUNCE_HEIGHT;
    // The idle crowd sways; a running one is already in motion.
    const swaying = !this.advancing && !this.cheering && !inArena;

    for (let i = 0; i < count; i++) {
      const offset = offsets[i];
      if (offset === undefined) continue;

      let scale = crowdScaleNow;
      // Squash and stretch: a unit pops in thin and tall, then settles. The
      // overshoot alone reads as a unit that grew; the stretch is what reads as
      // a unit that landed.
      let stretch = 1;
      const age = this.spawnAge[i] ?? SETTLED;
      if (age < POP_DURATION) {
        const p = age / POP_DURATION;
        scale = crowdScaleNow * popScale(age);
        stretch = 1 + POP_STRETCH * Math.sin(Math.min(1, p) * Math.PI) * (1 - p * 0.5);
        this.spawnAge[i] = age + dt;
      } else if (age !== SETTLED) {
        this.spawnAge[i] = SETTLED;
      }

      const sway = swaying ? Math.sin(this.swayPhase * IDLE_SWAY_RATE * 6.283 + i * 0.7) : 0;
      const animation = this.animationFor(i, inArena);
      crowd.setInstance(
        i,
        squad.x + offset.x,
        hop + sway * IDLE_SWAY_LIFT,
        squad.z + offset.z,
        yawOf(i) + sway * IDLE_SWAY_YAW,
        scale * MAGE_SCALE,
        animation,
        timeOffsetOf(i),
        clipSpeed(animation),
        // Uniform except while a unit is popping, which is the whole point.
        scale * MAGE_SCALE * stretch,
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
    const casting = this.castFor(index);
    // The arena is tested before the run, because it is a hard stop the sim
    // announces by position: the smoothed speed takes a third of a second to
    // run down (`trackMotion`) and the squad must not jog on the spot in front
    // of the boss while it does.
    if (inArena) return casting;
    if (this.advancing) return index % CASTING_SHARE === 0 ? casting : 'run';
    return 'idle';
  }

  /**
   * Which of the two cast clips this unit throws. Milestone 2 had one, and a
   * crowd where every firing unit made the same shape at the same moment read
   * as one animated dummy repeated (docs/10-milestone-3-log.md, "more
   * animation"). Split by the formation index so a unit keeps its own spell for
   * the whole run rather than flickering between them.
   */
  private castFor(index: number): string {
    return index % 2 === 0 ? 'cast' : 'cast2';
  }

  /**
   * Is the squad running? Answered from a low-passed speed with hysteresis,
   * never from one frame's z delta: the sim moves the squad in fixed 1/60 s
   * steps, so a frame can legitimately see it standing still (`theme.ts`,
   * `ADVANCE_SMOOTHING`).
   *
   * The first sample after a reset primes the filter instead of easing into it,
   * so a level that starts with the squad already moving starts with it already
   * running.
   */
  private trackMotion(z: number, dt: number): void {
    const previous = this.previousZ;
    this.previousZ = z;
    if (Number.isNaN(previous) || dt <= 0) return;

    const measured = (z - previous) / dt;
    if (Number.isNaN(this.advanceSpeed)) {
      this.advanceSpeed = measured;
    } else {
      // Frame-rate independent: the same smoothing in seconds at 60 or 120 Hz,
      // and at turbo, where one frame is a second of sim time and this is 1.
      this.advanceSpeed += (measured - this.advanceSpeed) * (1 - Math.exp(-dt / ADVANCE_SMOOTHING));
    }
    this.advancing = this.advanceSpeed > (this.advancing ? ADVANCE_STOP_SPEED : ADVANCE_START_SPEED);
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
        this.pushCorpse(x + offset.x, z + offset.z, crowd, i);
      }
    }
  }

  private pushCorpse(x: number, z: number, scale: number, index: number): void {
    if (this.corpseCount >= POOL.dyingUnits) return;
    const corpse = this.corpses[this.corpseCount];
    if (corpse === undefined) return;
    corpse.x = x;
    corpse.z = z;
    corpse.age = 0;
    corpse.scale = scale;
    corpse.index = index;
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
        yawOf(corpse.index),
        corpse.scale * MAGE_SCALE * fade,
        'idle',
        timeOffsetOf(corpse.index),
        IDLE_CLIP_SPEED,
      );

      const kept = this.corpses[write];
      if (kept !== undefined && write !== i) {
        kept.x = corpse.x;
        kept.z = corpse.z;
        kept.age = corpse.age;
        kept.scale = corpse.scale;
        kept.index = corpse.index;
      }
      write++;
    }
    this.corpseCount = write;
    return write;
  }
}

/** Casual timing: every clip runs faster than the artist's tempo (D28). */
function clipSpeed(animation: string): number {
  if (animation === 'run') return RUN_CLIP_SPEED;
  if (animation === 'cast') return CAST_CLIP_SPEED;
  if (animation === 'cast2') return CAST2_CLIP_SPEED;
  return IDLE_CLIP_SPEED;
}

/** A little turn per unit, so five hundred mages are not one rigid block. */
function yawOf(index: number): number {
  return ((index % 7) - 3) * 0.05;
}

/** Seconds into the loop, spread over the crowd so nobody marches in lockstep. */
function timeOffsetOf(index: number): number {
  return (index % 29) * 0.041;
}

/**
 * How big a unit is drawn, as a share of `MAGE_HEIGHT`: the room the formation
 * actually gives it, measured against the room it has at `CROWD_SCALE_FROM`.
 *
 * Reading the sim's own `unitSpacing` rather than easing between two guessed
 * counts is the point (see `CROWD_SCALE_FROM` in `theme.ts`): the spacing is
 * what decides whether two mages overlap, it is not linear in the count, and
 * tying the two together means a change to the formation cannot silently make
 * the crowd a slab again.
 *
 * Exported for the stress scene, which has to draw the crowd at the size the
 * game draws it or it is measuring a scene the game never renders.
 */
export function crowdScale(count: number): number {
  if (count <= CROWD_SCALE_FROM) return 1;
  const room = unitSpacing(count) / unitSpacing(CROWD_SCALE_FROM);
  return Math.max(CROWD_SCALE_MIN, Math.min(1, room));
}

/** Ease-out-back: overshoots past 1 then settles, which reads as a pop. */
function popScale(age: number): number {
  const p = Math.min(1, age / POP_DURATION) - 1;
  const overshoot = 1.7;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}
