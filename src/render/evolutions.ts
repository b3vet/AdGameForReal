/**
 * The four Milestone 8 evolutions that need a picture of their own (D54): the
 * meteor, overcharge, the freeze pulse and the glacier.
 *
 * The other two need none. Wildfire is the burn already drawn on one more body
 * (`./burn.ts`) — a fire handed on looks like a fire — and full chains are the
 * chain arc the staff already throws, at its own length.
 *
 * Everything here is pooled and immediate: the quads go into the shared sprite
 * batch (`./sprites.ts`), the crater and the pulse ring into the shared ground
 * batch (`./groundDecals.ts`), and the arcs into the chain pool the storm staff
 * already owns (`./effects.ts`). The only mesh in the milestone is the ice wall,
 * which is one box with one material (`./glacierWall.ts`).
 *
 * Positions come from the events; how long anything lives is `./evolutionLook.ts`.
 * Nothing here reads sim state except the ice wall, which is *on* the state
 * because a wall is part of what a run is at an instant (`RunState.ice`).
 */

import type { EffectsView } from './effects';
import {
  FREEZE_RING_ALPHA,
  FREEZE_RING_INNER,
  FREEZE_RING_SECONDS,
  FREEZE_RING_START,
  METEOR_CRATER_ALPHA,
  METEOR_CRATER_INNER,
  METEOR_CRATER_SECONDS,
  METEOR_FALL_SECONDS,
  METEOR_HEAD_SIZE,
  METEOR_HEIGHT,
  METEOR_LEAD,
  METEOR_TAIL,
  METEOR_TAIL_GAP,
} from './evolutionLook';
import type { GroundDecals } from './groundDecals';
import type { SpriteLayer } from './sprites';
import { bookCellLooping } from './spriteSheets';
import { EMBER_COLOR, FROST_COLOR } from './theme';

/** One meteor in the air: where it lands, and how far through its fall it is. */
interface Falling {
  x: number;
  z: number;
  radius: number;
  age: number;
}

/** A mark on the road that fades: the crater, and the pulse's ring. */
interface Mark {
  x: number;
  z: number;
  radius: number;
  age: number;
  life: number;
  /** True for the pulse, whose ring grows out to its radius as it fades. */
  expanding: boolean;
}

/** Meteors in the air and marks on the road at once. Both are rare events. */
const FALLING_POOL = 4;
const MARK_POOL = 8;

export class EvolutionView {
  private readonly sprites: SpriteLayer;
  private readonly decals: GroundDecals;
  private readonly effects: EffectsView;

  private readonly falling: Falling[] = [];
  private fallingCount = 0;
  private readonly marks: Mark[] = [];
  private markCount = 0;

  /** The flipbook clock the falling head runs on. Sim time, like every other. */
  private phase = 0;

  constructor(sprites: SpriteLayer, decals: GroundDecals, effects: EffectsView) {
    this.sprites = sprites;
    this.decals = decals;
    this.effects = effects;
    for (let i = 0; i < FALLING_POOL; i++) {
      this.falling.push({ x: 0, z: 0, radius: 1, age: 0 });
    }
    for (let i = 0; i < MARK_POOL; i++) {
      this.marks.push({ x: 0, z: 0, radius: 1, age: 0, life: 1, expanding: false });
    }
  }

  reset(): void {
    this.fallingCount = 0;
    this.markCount = 0;
    this.phase = 0;
  }

  /**
   * Ember tier 4: a charged shot landed here.
   *
   * The sim resolves the strike in one step, so the fall is drawn *backwards*
   * from the landing — the head is placed where it would have been a fraction
   * of a second ago and catches up with a hit that has already happened. The
   * flash, the bursts and the crater are all thrown now, which is what keeps
   * the picture honest: the damage is already done.
   */
  onMeteor(x: number, z: number, radius: number): void {
    this.pushFalling(x, z, radius);
    this.pushMark(x, z, radius, METEOR_CRATER_SECONDS, false);
    this.effects.onMeteorLanding(x, z, radius);
  }

  /** Frost tier 3: a body that died frozen chilled everything around it. */
  onFreezePulse(x: number, z: number, radius: number): void {
    this.pushMark(x, z, radius, FREEZE_RING_SECONDS, true);
  }

  /** Draws whatever is in the air and whatever is still on the road. */
  update(dt: number): void {
    this.phase += dt;
    this.updateFalling(dt);
    this.updateMarks(dt);
  }

  /** Meteors in the air, for the debug panel and the probes. */
  get inFlight(): number {
    return this.fallingCount;
  }

  /**
   * Marks still on the road — a meteor's crater, a freeze pulse's ring.
   *
   * Beside `inFlight` because between them they answer "did one of these just
   * happen" for a probe that has to *find* a frame with a rare thing in it: a
   * meteor is in the air for a fraction of a second and its crater is there for
   * over a second, and under a software rasteriser a fraction of a second can
   * be less than one frame.
   */
  get marksDrawn(): number {
    return this.markCount;
  }

  private pushFalling(x: number, z: number, radius: number): void {
    if (this.fallingCount >= FALLING_POOL) return;
    const head = this.falling[this.fallingCount];
    if (head === undefined) return;
    head.x = x;
    head.z = z;
    head.radius = radius;
    head.age = 0;
    this.fallingCount++;
  }

  private pushMark(
    x: number,
    z: number,
    radius: number,
    life: number,
    expanding: boolean,
  ): void {
    if (this.markCount >= MARK_POOL) return;
    const mark = this.marks[this.markCount];
    if (mark === undefined) return;
    mark.x = x;
    mark.z = z;
    mark.radius = radius;
    mark.age = 0;
    mark.life = life;
    mark.expanding = expanding;
    this.markCount++;
  }

  /** The head and its tail, falling from `METEOR_HEIGHT` onto the strike. */
  private updateFalling(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.fallingCount; i++) {
      const head = this.falling[i];
      if (head === undefined) continue;
      head.age += dt;
      if (head.age >= METEOR_FALL_SECONDS) continue;

      // 1 at the top of the fall, 0 at the road. Squared, so it accelerates
      // into the ground rather than drifting down at a constant speed.
      const left = 1 - head.age / METEOR_FALL_SECONDS;
      const fall = left * left;
      const y = METEOR_HEIGHT * fall;
      const z = head.z + METEOR_LEAD * fall;
      const size = METEOR_HEAD_SIZE * (0.7 + 0.3 * (1 - fall));

      this.sprites.add(
        bookCellLooping('ember', this.phase * 0.9 + i),
        head.x,
        y,
        z,
        size,
        EMBER_COLOR.r * 2.4,
        EMBER_COLOR.g * 2.4,
        EMBER_COLOR.b * 2.4,
        1,
      );
      for (let tail = 1; tail <= METEOR_TAIL; tail++) {
        const share = 1 - tail / (METEOR_TAIL + 1);
        this.sprites.add(
          bookCellLooping('ember', this.phase * 0.9 + i + tail * 0.4),
          head.x,
          y + METEOR_TAIL_GAP * tail,
          z + METEOR_TAIL_GAP * tail * 0.35,
          size * share,
          EMBER_COLOR.r * 1.6,
          EMBER_COLOR.g * 1.6,
          EMBER_COLOR.b * 1.6,
          share * 0.8,
        );
      }

      const kept = this.falling[write];
      if (kept !== undefined && write !== i) {
        kept.x = head.x;
        kept.z = head.z;
        kept.radius = head.radius;
        kept.age = head.age;
      }
      write++;
    }
    this.fallingCount = write;
  }

  /** The crater's rim, and the pulse's ring going out. Both into the decals. */
  private updateMarks(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.markCount; i++) {
      const mark = this.marks[i];
      if (mark === undefined) continue;
      mark.age += dt;
      if (mark.age >= mark.life) continue;

      const phase = mark.age / mark.life;
      const fade = 1 - phase;
      if (mark.expanding) {
        const size = mark.radius * 2 * (FREEZE_RING_START + (1 - FREEZE_RING_START) * phase);
        this.decals.add(
          mark.x,
          mark.z,
          size,
          FROST_COLOR.r,
          FROST_COLOR.g,
          FROST_COLOR.b,
          FREEZE_RING_ALPHA * fade,
          FREEZE_RING_INNER,
        );
      } else {
        this.decals.add(
          mark.x,
          mark.z,
          mark.radius * 2,
          EMBER_COLOR.r * 0.4,
          EMBER_COLOR.g * 0.3,
          EMBER_COLOR.b * 0.3,
          METEOR_CRATER_ALPHA * fade,
          METEOR_CRATER_INNER,
        );
      }

      const kept = this.marks[write];
      if (kept !== undefined && write !== i) {
        kept.x = mark.x;
        kept.z = mark.z;
        kept.radius = mark.radius;
        kept.age = mark.age;
        kept.life = mark.life;
        kept.expanding = mark.expanding;
      }
      write++;
    }
    this.markCount = write;
  }
}
