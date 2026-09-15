/**
 * The wisp (D33): the familiar that hovers beside the squad.
 *
 * Everything here is a billboarded quad written into the shared `SpriteLayer`
 * (`./sprites.ts`), so the whole familiar — orb, tier rings, trail, and the
 * sparks and impacts in `./wispSparks.ts` — lands in the batch the projectiles
 * already use and costs no draw call of its own.
 *
 * Tier is read off the `FamiliarState` the sim writes, and it is shown twice:
 * the orb is a shade bigger at every tier, and it carries one ring per tier.
 * Size alone is not readable next to a crowd whose own scale changes with its
 * count, so the rings are the countable half.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import { NO_TINT, dyeToRef } from './cosmetics';
import type { Tint } from './cosmetics';
import type { SpriteLayer } from './sprites';
import { bookCellLooping } from './spriteSheets';
import {
  POOL,
  WISP_ALPHA,
  WISP_BOB_HEIGHT,
  WISP_BOB_RATE,
  WISP_COLOR,
  WISP_RING_ALPHA,
  WISP_RING_SCALE,
  WISP_RING_SPIN,
  WISP_RING_STEP,
  WISP_SIZE,
  WISP_TIER_GROWTH,
  WISP_TRAIL_DURATION,
  WISP_TRAIL_EVERY,
  WISP_TRAIL_SIZE,
  WISP_Y,
} from './theme';
import { SparkPool } from './wispSparks';
import type { TargetLookup } from './wispSparks';
import type { FamiliarState } from '@/sim';

export type { TargetLookup } from './wispSparks';

interface Mote {
  x: number;
  y: number;
  z: number;
  age: number;
}

export class WispView {
  private readonly sprites: SpriteLayer;
  private readonly sparks: SparkPool;

  /**
   * The orb's colour: the palette's own wisp hue with the worn tint multiplied
   * into it (D53). An instance of its own rather than the palette's shared one,
   * because this one is *derived* — the palette rewrites its objects in place
   * on a biome switch and a derived colour must not be one of them.
   */
  private readonly color = new Color3();
  /**
   * How much trail the worn tint asks for: a brighter tint sheds more of it
   * and holds it longer, so two wisps differ in shape and not only in hue.
   * Derived from the tint's own brightness rather than from a table, so a tint
   * added to `cosmetics.json` needs no entry here.
   */
  private trailEvery = WISP_TRAIL_EVERY;
  private trailLife = WISP_TRAIL_DURATION;
  /** Scratch for the dye, so `setCosmetic` allocates nothing. */
  private readonly dyed: [number, number, number] = [0, 0, 0];

  private readonly motes: Mote[] = [];
  private moteCount = 0;

  /** The orb's own clock: the bob, the ring spin and the trail all ride it. */
  private phase = 0;
  private trailTimer = 0;
  private visible = false;

  constructor(sprites: SpriteLayer) {
    this.sprites = sprites;
    this.sparks = new SparkPool(sprites);
    for (let i = 0; i < POOL.wispTrail; i++) this.motes.push({ x: 0, y: 0, z: 0, age: 0 });
    this.setCosmetic(NO_TINT);
  }

  /**
   * The worn wisp tint (D53): the orb's colour, and the shape of what it sheds.
   *
   * Called at a level load and when the Academy re-dresses its backdrop. The
   * colour is read back from the palette every time rather than multiplied into
   * itself, so trying on three tints in a row is three tints and not the
   * product of all of them.
   */
  setCosmetic(tint: Tint): void {
    // Dyed rather than multiplied, for the reason `dyeToRef` gives: the wisp's
    // own hue is a strong green, and multiplying a warm tint into it leaves a
    // green wisp with a cast rather than the colour the player chose.
    dyeToRef(WISP_COLOR.r, WISP_COLOR.g, WISP_COLOR.b, tint, this.dyed);
    this.color.set(this.dyed[0], this.dyed[1], this.dyed[2]);
    // The mean of the multiplier, held in a band: a tint twice as bright is
    // half again as much trail, not twice as much, and a dark one still trails.
    const weight = Math.min(1.6, Math.max(0.6, (tint[0] + tint[1] + tint[2]) / 3));
    this.trailEvery = WISP_TRAIL_EVERY / weight;
    this.trailLife = WISP_TRAIL_DURATION * weight;
  }

  reset(): void {
    this.moteCount = 0;
    this.phase = 0;
    this.trailTimer = 0;
    this.visible = false;
    this.sparks.reset();
  }

  /** `familiarShot`: throw a spark at `targetId`; see `./wispSparks.ts`. */
  onShot(x: number, z: number, targetId: number, lookup: TargetLookup): void {
    this.sparks.launch(x, z, targetId, lookup);
  }

  /**
   * Draws the familiar and everything in flight.
   *
   * `familiar` is null for a player who owns no wisp, which is most of them —
   * and the sparks still have to be aged out, because a run can end with one in
   * the air.
   */
  update(familiar: FamiliarState | null | undefined, lookup: TargetLookup, dt: number): void {
    this.phase += dt;
    this.visible = familiar !== null && familiar !== undefined;
    if (familiar !== null && familiar !== undefined) this.drawOrb(familiar, dt);
    this.sparks.update(lookup, dt);
    this.updateMotes(dt);
  }

  /** Sparks in the air, for the debug panel and the dev harness. */
  get sparksInFlight(): number {
    return this.sparks.inFlight;
  }

  get drawn(): boolean {
    return this.visible;
  }

  /** The orb, its rings and the mote it sheds. */
  private drawOrb(familiar: FamiliarState, dt: number): void {
    const tier = Math.max(1, Math.min(3, Math.round(familiar.tier)));
    const bob = Math.sin(this.phase * WISP_BOB_RATE * Math.PI * 2) * WISP_BOB_HEIGHT;
    const size = WISP_SIZE * (1 + (tier - 1) * WISP_TIER_GROWTH);
    const y = WISP_Y + bob;

    this.sprites.add(
      bookCellLooping('wispCore', this.phase * 0.8),
      familiar.x,
      y,
      familiar.z,
      size,
      this.color.r,
      this.color.g,
      this.color.b,
      WISP_ALPHA,
    );

    for (let ring = 0; ring < tier; ring++) {
      // Each ring is wider, fainter and turning the other way from the one
      // inside it, so three of them read as three rather than as a halo.
      const scale = WISP_RING_SCALE + ring * WISP_RING_STEP;
      this.sprites.add(
        bookCellLooping('wispRing', this.phase * 0.6 + ring * 0.3),
        familiar.x,
        y,
        familiar.z,
        size * scale,
        this.color.r,
        this.color.g,
        this.color.b,
        WISP_RING_ALPHA / (1 + ring * 0.35),
        this.phase * WISP_RING_SPIN * (ring % 2 === 0 ? 1 : -1),
      );
    }

    this.trailTimer += dt;
    if (this.trailTimer < this.trailEvery) return;
    this.trailTimer = 0;
    this.pushMote(familiar.x, y, familiar.z);
  }

  private pushMote(x: number, y: number, z: number): void {
    if (this.moteCount >= this.motes.length) return;
    const mote = this.motes[this.moteCount];
    if (mote === undefined) return;
    mote.x = x;
    mote.y = y;
    mote.z = z;
    mote.age = 0;
    this.moteCount++;
  }

  private updateMotes(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.moteCount; i++) {
      const mote = this.motes[i];
      if (mote === undefined) continue;
      mote.age += dt;
      if (mote.age >= this.trailLife) continue;
      const fade = 1 - mote.age / this.trailLife;
      this.sprites.add(
        bookCellLooping('sparkle', mote.age * 4),
        mote.x,
        // The mote drifts up as it dies, which is what makes a trail read as
        // smoke off a hovering light rather than as a dotted line.
        mote.y + (1 - fade) * 0.12,
        mote.z,
        WISP_TRAIL_SIZE * fade,
        this.color.r,
        this.color.g,
        this.color.b,
        fade * 0.8,
      );
      const kept = this.motes[write];
      if (kept !== undefined && write !== i) {
        kept.x = mote.x;
        kept.y = mote.y;
        kept.z = mote.z;
        kept.age = mote.age;
      }
      write++;
    }
    this.moteCount = write;
  }
}
