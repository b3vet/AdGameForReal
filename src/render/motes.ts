/**
 * Ambient motes: a few dozen slow specks of light drifting over the road in the
 * three spell hues (Milestone 5 plan, "Props re-tinted to the palette; sky
 * dome; ambient motes").
 *
 * They are what keeps the air between the squad and the next gate row from
 * being empty. Everything else in frame is either on the ground or a spell in
 * flight, so a still frame of the road had nothing moving in it above knee
 * height; a mote field reads as a place with magic in it and costs one draw
 * call (`./tintedQuads.ts`).
 *
 * The field travels with the camera rather than being placed per level: motes
 * wrap around a box centred on the camera, so a level is never "out of motes"
 * and the pool is the whole cost. Nothing here allocates per frame.
 */

import type { Scene } from '@babylonjs/core/scene';

import { createMoteTexture } from './artTextures';
import {
  MOTE_ALPHA,
  MOTE_COUNT,
  MOTE_RISE,
  MOTE_SIZE_MAX,
  MOTE_SIZE_MIN,
  MOTE_SPAN_X,
  MOTE_SPAN_Z,
  MOTE_SWAY,
  MOTE_SWAY_RATE,
  MOTE_Y_MAX,
  MOTE_Y_MIN,
} from './roadLook';
import { paletteColor } from './theme';
import { TintedQuads } from './tintedQuads';
import { mulberry32 } from '@/sim';

/** Seeded, so the same frame of the same level has the same motes on it. */
const MOTE_SEED = 0x0f_1e_2d_3c;

/** One speck: where it stands in the world, and how it drifts. */
interface Mote {
  /** World position. Wrapped around the camera's box, never parented to it. */
  x: number;
  y: number;
  z: number;
  size: number;
  /** Index into `HUES`, fixed for the mote's life. */
  hue: number;
  /** Phase of its own sway, so no two motes drift together. */
  phase: number;
  /** How brightly this one burns, as a share of `MOTE_ALPHA`. */
  brightness: number;
}

export class MotesView {
  private readonly quads: TintedQuads;
  private readonly motes: Mote[] = [];
  private readonly hues: [number, number, number][];

  private time = 0;

  constructor(scene: Scene) {
    this.quads = new TintedQuads(scene, 'ambientMotes', createMoteTexture(scene), MOTE_COUNT);
    // The three staff hues at their palest, so a mote is a spark of the same
    // magic the squad is throwing rather than a fourth colour on the road.
    this.hues = (['spell.ember.core', 'spell.storm.core', 'spell.frost.core'] as const).map(
      (role) => {
        const color = paletteColor(role);
        return [color.r, color.g, color.b];
      },
    );

    const random = mulberry32(MOTE_SEED);
    for (let i = 0; i < MOTE_COUNT; i++) {
      this.motes.push({
        x: (random() * 2 - 1) * MOTE_SPAN_X,
        y: MOTE_Y_MIN + random() * (MOTE_Y_MAX - MOTE_Y_MIN),
        z: (random() * 2 - 1) * MOTE_SPAN_Z,
        size: MOTE_SIZE_MIN + random() * (MOTE_SIZE_MAX - MOTE_SIZE_MIN),
        hue: Math.floor(random() * this.hues.length),
        phase: random() * Math.PI * 2,
        brightness: 0.5 + random() * 0.5,
      });
    }
  }

  /**
   * Drifts the field and writes it.
   *
   * Motes live in world space and are *wrapped* around a box centred on the
   * camera: one that the camera has walked past is moved a box-length ahead
   * rather than being followed. That is the difference between air the squad
   * walks through and a swarm parented to the lens.
   */
  update(cameraX: number, cameraZ: number, dt: number): void {
    this.time += dt;
    this.quads.begin();
    for (const mote of this.motes) {
      mote.y += MOTE_RISE * dt;
      if (mote.y > MOTE_Y_MAX) mote.y = MOTE_Y_MIN;
      mote.z = wrap(mote.z, cameraZ, MOTE_SPAN_Z);
      mote.x = wrap(mote.x, cameraX, MOTE_SPAN_X);

      const sway = Math.sin(this.time * MOTE_SWAY_RATE + mote.phase) * MOTE_SWAY;
      const hue = this.hues[mote.hue] ?? this.hues[0];
      if (hue === undefined) continue;
      // A slow breath on top of the drift, so the field twinkles rather than
      // every mote holding one value for ever.
      const breath = 0.65 + 0.35 * Math.sin(this.time * 0.6 + mote.phase * 1.7);
      this.quads.add(
        mote.x + sway,
        mote.y,
        mote.z,
        mote.size,
        mote.size,
        hue[0],
        hue[1],
        hue[2],
        MOTE_ALPHA * mote.brightness * breath,
      );
    }
    this.quads.end();
  }

  /**
   * Wraps every mote back around a camera that has just jumped — a level load,
   * or the Academy backdrop coming up — so the field is already around the new
   * position on the first frame rather than streaming in over a second.
   */
  recentre(cameraZ: number): void {
    const random = mulberry32(MOTE_SEED ^ Math.floor(cameraZ));
    for (const mote of this.motes) mote.z = cameraZ + (random() * 2 - 1) * MOTE_SPAN_Z;
  }

  /** Motes drawn last frame, for the debug panel. */
  get drawn(): number {
    return this.quads.count;
  }

  dispose(): void {
    this.quads.dispose();
    this.motes.length = 0;
  }
}

/**
 * `value` moved by whole box-lengths until it is inside `centre ± span`. A
 * loop rather than a modulo, because the camera can jump a level's length
 * between two frames and a single wrap would leave the field behind.
 */
function wrap(value: number, centre: number, span: number): number {
  const width = span * 2;
  let wrapped = value;
  while (wrapped < centre - span) wrapped += width;
  while (wrapped > centre + span) wrapped -= width;
  return wrapped;
}
