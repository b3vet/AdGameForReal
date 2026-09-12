/**
 * A crowd of animated characters as thin instances of one mesh.
 *
 * Every unit is four floats of transform plus four floats of animation state,
 * written into two `Float32Array`s and uploaded once per frame. There is one
 * draw call however many units there are, no per-unit skeleton, and no
 * allocation in `setInstance` — it is a hot loop that runs 500 times a frame.
 *
 * The one thing a VAT cannot do is blend. `bakedVertexAnimation` picks a single
 * texture row, so switching a unit from `run` to `cast` is a cut, not a
 * cross-fade. Stagger `timeOffset` across the crowd and the cut disappears into
 * the mass; a hero unit that needs blending has to be a normal skinned mesh.
 */

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side-effect import: this is what puts `thinInstance*` on `Mesh.prototype`.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import type { CharacterAsset } from './asset';
import type { Crowd } from './crowd';
import type { VatRangeMeta } from './manifest';

const FLOATS_PER_MATRIX = 16;
const FLOATS_PER_SETTING = 4;

/** Reused across every `setInstance` call so the hot loop allocates nothing. */
const scratchMatrix = Matrix.Identity();
const scratchScale = Vector3.One();
const scratchRotation = Quaternion.Identity();
const scratchTranslation = Vector3.Zero();

export class VatCrowd implements Crowd {
  readonly mesh: Mesh;

  private readonly matrices: Float32Array;
  private readonly settings: Float32Array;
  private readonly ranges: ReadonlyMap<string, VatRangeMeta>;
  private readonly fps: number;
  private readonly baseScale: number;
  private readonly manager;

  private count = 0;
  /** Highest instance index written since the last `commit`, for the upload. */
  private dirty = false;

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

    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, FLOATS_PER_MATRIX, false);
    this.mesh.thinInstanceSetBuffer(
      'bakedVertexAnimationSettingsInstanced',
      this.settings,
      FLOATS_PER_SETTING,
      false,
    );
    this.mesh.thinInstanceCount = 0;
    // Hidden until something commits instances into it: an empty thin-instance
    // mesh draws one full-size copy of itself at the origin (see `commit`).
    this.mesh.setEnabled(false);
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
   * the shader's clock is `fract(time * speed / frames)`, so at speed 0 the
   * instance holds the single frame `timeOffset` picks out — which is how a
   * block that has not activated yet stands still instead of marching on the
   * spot, without a second baked range.
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
    this.dirty = true;
  }

  /** How many instances `commit` will draw. Extra slots keep their old data. */
  setCount(count: number): void {
    this.count = Math.max(0, Math.min(this.capacity, Math.floor(count)));
    this.dirty = true;
  }

  /**
   * Uploads both buffers. Cheap enough to call every frame, once.
   *
   * The mesh is disabled when the crowd is empty, and that is not an
   * optimisation: Babylon's `hasThinInstances` is `instancesCount > 0`, so a
   * mesh whose count has dropped to zero falls back to the *non-instanced*
   * path and draws one full-size character at the world origin. A squad that
   * has just been wiped, or a crowd that has been built but not yet placed,
   * would otherwise put a three-metre mage in the middle of the road.
   */
  commit(): void {
    this.mesh.thinInstanceCount = this.count;
    this.mesh.setEnabled(this.count > 0);
    if (!this.dirty || this.count === 0) return;
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('bakedVertexAnimationSettingsInstanced');
    this.dirty = false;
  }

  /** Advances the shared clock every baked range is sampled against. */
  update(dt: number): void {
    this.manager.time += dt;
  }

  /** How long one loop of a range lasts, for callers timing a one-shot. */
  durationOf(animationId: string): number {
    const range = this.ranges.get(animationId);
    if (range === undefined) throw new Error(`no baked range "${animationId}"`);
    return (range.to - range.from + 1) / this.fps;
  }

  dispose(): void {
    this.asset.dispose();
  }
}
