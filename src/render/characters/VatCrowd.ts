/**
 * A crowd of animated characters as thin instances of one mesh.
 *
 * Every unit is sixteen floats of transform plus four floats of animation
 * state, written into two `Float32Array`s. There is one draw call however many
 * units there are, no per-unit skeleton, and no allocation in `setInstance` —
 * it is a hot loop that runs 500 times a frame. What reaches the GPU is the
 * part of those buffers the camera can see, packed and uploaded as the scene
 * renders (`./crowdCull.ts`).
 *
 * The one thing a VAT cannot do is blend *between clips*. A row of the texture
 * is one pose of one clip, so switching a unit from `run` to `cast` is a cut,
 * not a cross-fade. Stagger `timeOffset` across the crowd and the cut
 * disappears into the mass; a hero unit that needs blending has to be a normal
 * skinned mesh. Inside a clip the sampler does interpolate between the two rows
 * either side of the current time — see `./vatSampling.ts`, which is what makes
 * a 30 fps bake played at 1.3x look like motion rather than stepping.
 */

import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';

import type { CharacterAsset } from './asset';
import type { Crowd } from './crowd';
import type { CrowdBuffers } from './crowdCull';
import { CrowdDraw, FLOATS_PER_SETTING } from './crowdDraw';
import type { CrowdDrawStats } from './crowdDraw';
import { pick } from './lod';
import type { VatRangeMeta } from './manifest';

const FLOATS_PER_MATRIX = 16;

/** Reused across every `setInstance` call so the hot loop allocates nothing. */
const scratchMatrix = Matrix.Identity();
const scratchScale = Vector3.One();
const scratchRotation = Quaternion.Identity();
const scratchTranslation = Vector3.Zero();

export class VatCrowd implements Crowd {
  readonly mesh: Mesh;

  /**
   * What the caller wrote, slot by slot: storage, with holes in it and slots
   * written once and left alone. The GPU never reads these directly; `draw`
   * packs what it can see of them each time the camera renders.
   */
  private readonly source: CrowdBuffers;
  private readonly matrices: Float32Array;
  private readonly settings: Float32Array;
  private readonly draw: CrowdDraw;
  private readonly ranges: ReadonlyMap<string, VatRangeMeta>;
  private readonly fps: number;
  private readonly baseScale: number;
  private readonly manager;

  private count = 0;
  /**
   * The colour buffer the tints are written into, allocated on the first
   * cosmetic change and re-used for every later one: a wardrobe change is a
   * level load, not a frame, but it still may not allocate a megabyte each
   * time the player tries a hat on.
   */
  private tinted: Float32Array | null = null;
  /** The same for the small-on-screen copy, in its own vertex order. */
  private tintedLod: Float32Array | null = null;
  /** What is worn right now, so an unchanged selection writes nothing. */
  private wornKey = '';

  constructor(
    private readonly asset: CharacterAsset,
    readonly capacity: number,
  ) {
    this.mesh = asset.mesh;
    this.manager = asset.manager;
    this.fps = asset.vat.fps;
    this.baseScale = asset.scale;
    this.ranges = new Map(Object.entries(asset.vat.ranges));

    this.matrices = new Float32Array(capacity * FLOATS_PER_MATRIX);
    this.settings = new Float32Array(capacity * FLOATS_PER_SETTING);
    this.source = { matrices: this.matrices, settings: this.settings, count: 0 };
    this.draw = new CrowdDraw(this.source, this.mesh, asset.lod?.mesh ?? null, capacity);
  }

  /**
   * Dyes named parts of the merged mesh in a cosmetic's colours (D53).
   *
   * The merge baked the manifest's own tints into a vertex colour per vertex
   * (`./tint.ts`), and what arrives here is a *correction* on top of them: the
   * worn tint divided by what the part already reads as (`dyeAgainst` in
   * `src/render/cosmetics.ts`), so the product of the atlas texel, the
   * manifest's tint and this comes out as the colour the player chose. The base
   * buffer is kept untouched, so trying on a second hat starts from the
   * artist's colours rather than from the last one.
   *
   * One upload of one buffer, at a level load. There is no per-instance colour
   * involved: every mage in the crowd wears what the player is wearing.
   */
  setPartTints(tints: ReadonlyMap<string, readonly [number, number, number]>): void {
    const base = this.asset.baseColors;
    if (base === null) return;
    // Cheap identity check: the same selection twice is the normal case (every
    // level load re-applies whatever is worn).
    let key = '';
    for (const [name, tint] of tints) key += `${name}:${tint.join(',')};`;
    if (key === this.wornKey) return;
    this.wornKey = key;

    const colors = this.tinted ?? new Float32Array(base.length);
    this.tinted = colors;
    colors.set(base);
    for (const [name, tint] of tints) {
      const range = this.asset.parts.get(name);
      if (range === undefined) continue;
      const end = (range.start + range.count) * 4;
      for (let at = range.start * 4; at < end; at += 4) {
        colors[at] = (colors[at] ?? 1) * tint[0];
        colors[at + 1] = (colors[at + 1] ?? 1) * tint[1];
        colors[at + 2] = (colors[at + 2] ?? 1) * tint[2];
      }
    }
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, colors, false, false);

    // The copy's vertices are a subset of these, in their own order.
    const lod = this.asset.lod;
    if (lod === null) return;
    const lodColors = this.tintedLod ?? new Float32Array(lod.order.length * 4);
    this.tintedLod = lodColors;
    pick(colors, lod.order, 4, lodColors);
    lod.mesh.updateVerticesData(VertexBuffer.ColorKind, lodColors, false, false);
  }

  /** Animation ids this crowd's baked texture carries, in bake order. */
  animationIds(): readonly string[] {
    return [...this.ranges.keys()];
  }

  /**
   * Places unit `index` and tells it which baked range to play.
   *
   * `scale` multiplies the manifest's own scale, so callers pass 1 for a
   * normal unit. `timeOffset` is in seconds and is what keeps the crowd out of
   * lockstep; it wraps within the range, so any value is valid.
   *
   * `speed` scales this instance's playback. Zero is the useful special case:
   * the shader's clock is `mod(time * speed * fps + offsetFrames, frames)`, so
   * at speed 0 the instance holds the one pose `timeOffset` picks out — which
   * is how a block that has not activated yet stands still instead of marching
   * on the spot, without a second baked range.
   *
   * `scaleY` defaults to `scale` and is the only way to make an instance
   * non-uniform. It exists for squash and stretch on a unit popping in: the
   * baked shader has no place to put a per-instance deformation, so the
   * deformation has to be in the instance matrix.
   */
  setInstance(
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    animationId: string,
    timeOffset: number,
    speed = 1,
    scaleY = scale,
  ): void {
    const range = this.ranges.get(animationId);
    if (range === undefined) throw new Error(`no baked range "${animationId}"`);

    const size = this.baseScale * scale;
    scratchScale.set(size, this.baseScale * scaleY, size);
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, scratchRotation);
    scratchTranslation.set(x, y, z);
    Matrix.ComposeToRef(scratchScale, scratchRotation, scratchTranslation, scratchMatrix);
    this.matrices.set(scratchMatrix.m, index * FLOATS_PER_MATRIX);

    // (startFrame, endFrame, offsetInFrames, framesPerSecond) — the four
    // components `bakedVertexAnimation.fx` reads per instance.
    const at = index * FLOATS_PER_SETTING;
    this.settings[at] = range.from;
    this.settings[at + 1] = range.to;
    this.settings[at + 2] = timeOffset * this.fps;
    this.settings[at + 3] = this.fps * speed;
  }

  /** How many instances `commit` will draw. Extra slots keep their old data. */
  setCount(count: number): void {
    this.count = Math.max(0, Math.min(this.capacity, Math.floor(count)));
  }

  /**
   * Closes a frame's writes. Cheap enough to call every frame, once; what is
   * drawn is decided when the camera renders (`./crowdDraw.ts`).
   */
  commit(): void {
    this.draw.commit(this.count);
  }

  /** What the last render drew of this crowd: whole, small and left out. */
  get drawStats(): Readonly<CrowdDrawStats> {
    return this.draw.stats;
  }

  /** Advances the shared clock every baked range is sampled against. */
  update(dt: number): void {
    this.manager.time += dt;
  }

  /**
   * How long one loop of a range lasts, for callers timing a one-shot.
   *
   * Intervals, not rows: the bake's last row is the clip's end pose, which for
   * a looping range is its first pose again (`scripts/bake-vat.mjs`), so a
   * range of `n + 1` rows is `n` frames long.
   */
  durationOf(animationId: string): number {
    const range = this.ranges.get(animationId);
    if (range === undefined) throw new Error(`no baked range "${animationId}"`);
    return (range.to - range.from) / this.fps;
  }

  dispose(): void {
    this.draw.dispose();
    this.asset.dispose();
  }
}
