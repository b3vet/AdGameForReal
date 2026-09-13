/**
 * Blob shadows: one soft disc under everything that stands on the road (D38).
 *
 * The scene has no shadow map and will not get one. A real one costs a depth
 * pass over five hundred animated crowd instances every frame, and the look it
 * buys is the wrong look anyway — the game is flat-lit by a 0.7 ambient with a
 * 0.6 key on top (`./scene.ts`), which is a deliberately shadowless world. What
 * the frame was actually missing is *contact*: a mage, a skeleton and a stream
 * body all floated a centimetre over the stone, because nothing under them was
 * darker than the road. One soft disc fixes that, and it is the trick every
 * mobile crowd game in this genre uses.
 *
 * ## One mesh, one draw call
 *
 * A single unit quad with a radial-gradient texture, drawn through a
 * thin-instance buffer: five hundred shadows cost one draw call and one buffer
 * upload, exactly like the crowd above them. The texture is painted once at
 * init (`./textures.ts`'s pattern) and never touched again.
 *
 * ## The API, and who calls it
 *
 * Immediate mode, per frame, in the family the labels and the sprites already
 * use here:
 *
 *   `begin()`               once a frame, before anything writes
 *   `reserve(count)`        a block of slots for one view, or -1 when full
 *   `setInstance(i, x, z, radius, alpha)`   write slot `i`
 *   `add(x, z, radius, alpha)`              reserve one and write it
 *   `commit()`              upload and close the frame
 *
 * `reserve` exists because several views write into the same buffer — the
 * squad, the enemy blocks, the stream bodies, the boss and the roadside props —
 * and a shared index space with no allocator is two views quietly overwriting
 * each other's shadows. A view that knows its own count takes a block once and
 * writes `base + k`; anything writing a handful calls `add`.
 *
 * Props are the exception: they never move, so they are written once at level
 * load into a reserved block at the front of the buffer (`setStatic`) and left
 * there, and `begin` rewinds to just past them rather than to zero.
 *
 * ## Why it is cheap
 *
 * Alpha-blended, no depth write, `alphaIndex` 0 so it sorts ahead of every
 * other transparent thing in the scene, and a range cap (`SHADOW.range`) so the
 * far half of a long level is not drawing three hundred two-pixel discs.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import { BOSS_WIDTH, SHADOW, SHADOW_COLOR } from './theme';
import type { RunState } from '@/sim';

/** Pixels of the disc sheet. Small on purpose: it is a blur, not a shape. */
const TEXTURE_SIZE = 64;
/** Where the gradient starts falling off, as a share of the radius. */
const SOFT_EDGE = 0.42;

export interface ShadowLayerOptions {
  /** Moving shadows per frame. Squad, stream bodies, blocks, boss. */
  capacity: number;
  /** Slots held for the level's props, which are written once and kept. */
  staticCapacity: number;
}

export class ShadowLayer {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private readonly texture: DynamicTexture;
  private readonly matrices: Float32Array;

  private readonly staticCapacity: number;
  private readonly capacity: number;

  /** Slots the level's props claimed; everything else starts above this. */
  private statics = 0;
  /** Next free slot this frame, and the highest one written. */
  private cursor = 0;
  private used = 0;

  constructor(scene: Scene, options: ShadowLayerOptions) {
    this.staticCapacity = options.staticCapacity;
    this.capacity = options.staticCapacity + options.capacity;

    this.texture = buildDiscTexture(scene);

    const material = new StandardMaterial('blobShadowMat', scene);
    material.diffuseTexture = this.texture;
    material.useAlphaFromDiffuseTexture = true;
    // The disc carries its colour in `emissiveColor`, not in the lighting: a
    // shadow that is lit is a shadow that goes away when the key light swings.
    material.emissiveColor = SHADOW_COLOR;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.ambientColor = Color3.Black();
    material.disableLighting = true;
    // Ordinary source-over, not `ALPHA_MULTIPLY`: multiply blending ignores the
    // source alpha, so the quad's transparent corners would still multiply the
    // road by the shadow's colour and every blob would be a dark square. At the
    // alpha the disc carries (`SHADOW.alpha`) a blended dark is a multiply for
    // all anyone can see — the road's stone pattern reads straight through it.
    material.alphaMode = Constants.ALPHA_COMBINE;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    // Fogged like the ground it lies on, or a shadow at 200 m is the one dark
    // thing left in a frame that has otherwise faded to haze.
    material.fogEnabled = true;
    this.material = material;

    // A ground rather than a plane: it is already flat in xz, so an instance
    // matrix is a scale and a translate with no rotation in it.
    this.mesh = CreateGround('blobShadows', { width: 1, height: 1 }, scene);
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.alphaIndex = 0;
    this.mesh.doNotSyncBoundingInfo = true;
    // The crowd it belongs to opts out of frustum culling for the same reason:
    // the instances move every frame and the mesh's own bounds never do.
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.matrices = createMatrixBuffer(this.mesh, this.capacity);
    // Disabled until the first `commit`: an enabled mesh with an empty
    // thin-instance buffer falls off the instanced path and draws one full-size
    // copy of itself at the world origin (the Milestone 2 bug `warmUpScene`
    // documents), and the warm-up only lends a pooled mesh an instance to
    // compile against while it is disabled.
    this.mesh.setEnabled(false);
  }

  /** Freezes the material after the scene's first readiness pass. */
  freeze(): void {
    this.material.freeze();
    this.mesh.computeWorldMatrix(true);
    this.mesh.freezeWorldMatrix();
  }

  /** Slots left for moving shadows this frame. */
  get free(): number {
    return this.capacity - this.cursor;
  }

  /** What was drawn last frame, for the debug panel and the dev harness. */
  get drawn(): number {
    return this.used;
  }

  /** A level is starting: the props' block is empty again. */
  reset(): void {
    this.statics = 0;
    this.cursor = 0;
    this.used = 0;
  }

  /**
   * Places one shadow that never moves again and answers whether it fitted.
   * Only valid between `reset` and the first `begin` of the level — the props
   * are laid out at level load, before any frame is drawn.
   */
  setStatic(x: number, z: number, radius: number, alpha: number): boolean {
    if (this.statics >= this.staticCapacity) return false;
    this.write(this.statics, x, z, radius, alpha);
    this.statics++;
    return true;
  }

  /** Opens the frame: every moving shadow is written between here and `commit`. */
  begin(): void {
    this.cursor = this.statics;
  }

  /**
   * Claims `count` consecutive slots and answers the first one's index, or -1
   * if the buffer has no room left. The caller then writes `base + k`.
   */
  reserve(count: number): number {
    if (count <= 0) return -1;
    const base = this.cursor;
    if (base + count > this.capacity) return -1;
    this.cursor = base + count;
    return base;
  }

  /**
   * Writes one slot. `radius` is the thing's own half-width in metres — the
   * blob is drawn `SHADOW.spread` wider — and `alpha` is a share of
   * `SHADOW.alpha`, so a caller passes 1 for a solid contact shadow and less
   * for something leaving the ground.
   */
  setInstance(index: number, x: number, z: number, radius: number, alpha: number): void {
    if (index < 0 || index >= this.capacity) return;
    this.write(index, x, z, radius, alpha);
  }

  /** `reserve(1)` and `setInstance` in one call, for a view writing a few. */
  add(x: number, z: number, radius: number, alpha: number): void {
    const at = this.reserve(1);
    if (at < 0) return;
    this.write(at, x, z, radius, alpha);
  }

  /**
   * The alpha a shadow at `distance` metres in front of the camera should
   * carry, or 0 once it is out of range — the fade the callers share, so a
   * shadow never pops on at the edge of the range.
   */
  static fade(distance: number): number {
    if (distance >= SHADOW.range) return 0;
    const start = SHADOW.range * (1 - SHADOW.fade);
    if (distance <= start) return 1;
    return 1 - (distance - start) / (SHADOW.range - start);
  }

  /** Uploads the frame's instances. Call once, after every view has written. */
  commit(): void {
    this.used = this.cursor;
    commitInstances(this.mesh, this.cursor);
  }

  dispose(): void {
    this.material.dispose();
    this.texture.dispose();
    this.mesh.dispose();
  }

  /**
   * The one place a matrix is written. Alpha rides in the *scale*: there is no
   * per-instance colour buffer on this mesh, so a fading shadow is a shrinking
   * one, which at a blob's softness reads as the same thing and costs nothing.
   */
  private write(index: number, x: number, z: number, radius: number, alpha: number): void {
    const size = Math.max(0, radius) * SHADOW.spread * 2 * Math.min(1, Math.max(0, alpha));
    writeInstance(this.matrices, index, size, 1, size, x, SHADOW.y, z);
  }
}

/**
 * The disc: opaque in the middle, falling to nothing at the rim.
 *
 * A radial gradient rather than a blurred circle, because a `DynamicTexture`
 * has no blur and a hand-rolled one would be a second pass over the pixels for
 * a shape that is already only a gradient. `SOFT_EDGE` is where the falloff
 * starts; below it the blob is flat, which is the contact patch.
 */
function buildDiscTexture(scene: Scene): DynamicTexture {
  const texture = new DynamicTexture(
    'blobShadowDisc',
    { width: TEXTURE_SIZE, height: TEXTURE_SIZE },
    scene,
    true,
  );
  const context = texture.getContext();
  const half = TEXTURE_SIZE / 2;

  // Transparent everywhere the disc is not: the quad is square and the shadow
  // is round, and the corners must not darken the road.
  context.clearRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, `rgba(255,255,255,${String(SHADOW.alpha)})`);
  gradient.addColorStop(SOFT_EDGE, `rgba(255,255,255,${String(SHADOW.alpha * 0.86)})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);

  texture.update(false);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/**
 * The boss's blob, and the frame's one upload of the whole buffer.
 *
 * The boss is the render core's to place because `BossView` belongs to the art
 * track: everything the shadow needs is in the sim state, and a blob under a
 * demon is a position and a width. Bigger than a mage's by the same ratio the
 * model is, and gone once the body has been killed and is sinking through the
 * road.
 *
 * `commit` lives here too, so the layer is opened by `Renderer.update` and
 * closed by one call rather than by whoever happens to write last.
 */
export function writeBossShadow(shadows: ShadowLayer, state: RunState): void {
  const boss = state.boss;
  if (boss !== null && boss !== undefined && boss.hp > 0) {
    const fade = ShadowLayer.fade(boss.z - state.squad.z);
    if (fade > 0) shadows.add(boss.x, boss.z, BOSS_WIDTH / 2, fade);
  }
  shadows.commit();
}

/**
 * A blob under every roadside prop.
 *
 * Read off the scene rather than handed over by `PropsView`: the props are
 * thin instances placed by their own view from a seeded layout, and the render
 * art track owns that file. Walking the meshes it has already committed keeps
 * the shadow layer out of it — and a prop kind that gets renamed or a build
 * whose models failed to load simply has no shadow, which is the same
 * fail-soft rule the props themselves are loaded under.
 *
 * `prop_` is the manifest's own id prefix (`src/data/assets.json`), which is
 * what `PropsView` names its meshes after.
 */
export function addPropShadows(scene: Scene, shadows: ShadowLayer): void {
  for (const mesh of scene.meshes) {
    if (!(mesh instanceof Mesh)) continue;
    if (!mesh.name.startsWith('prop_')) continue;
    const count = mesh.thinInstanceCount;
    if (count === 0) continue;

    // Half the model's own width, so a pine gets a pine's shadow and a
    // gravestone a gravestone's. Measured once per kind, not per instance.
    const extent = mesh.getBoundingInfo().boundingBox.extendSize.x;
    const matrices = mesh.thinInstanceGetWorldMatrices();
    for (let i = 0; i < count; i++) {
      const matrix = matrices[i];
      if (matrix === undefined) continue;
      const scale = scaleOf(matrix);
      // Thinner than a moving shadow: scenery sits at the edge of the frame
      // and a full-strength blob under every tree reads as a row of holes.
      if (!shadows.setStatic(matrix.m[12] ?? 0, matrix.m[14] ?? 0, extent * scale, 0.7)) return;
    }
  }
}

/** The uniform scale in a thin instance's matrix: the length of its x axis. */
function scaleOf(matrix: Matrix): number {
  const m = matrix.m;
  return Math.hypot(m[0] ?? 1, m[1] ?? 0, m[2] ?? 0);
}
