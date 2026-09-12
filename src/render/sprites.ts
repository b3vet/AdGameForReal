/**
 * Every magical thing on screen, as one draw call.
 *
 * Projectiles, their tails, the sparkles they shed, impact bursts and muzzle
 * flashes are all billboarded quads cut out of the one spell sheet
 * (`./spriteSheets.ts`), drawn as thin instances of a single unit plane with a
 * per-instance uv rect, tint and roll. Milestone 2 drew these as five separate
 * meshes — a bolt core, a tail, an impact per staff and a flash — which is five
 * of the frame's forty draw calls before a single skeleton is on the road.
 *
 * Immediate mode, like `./labels.ts` and `./rings.ts`: an owner `begin`s,
 * `add`s what it wants this frame, and `end`s. Nothing is retained, so an owner
 * that stops adding a sprite has already removed it.
 *
 * Additive, with depth *testing* on and depth *writing* off. Testing on, so a
 * bolt behind the boss is behind the boss; writing off, because a hundred
 * additive quads that wrote depth would each occlude the next and the volley
 * would come apart into tiles. Additive blending is order-independent, so the
 * order instances land in the buffer never matters.
 *
 * No allocation in the per-frame path: every buffer is sized once at
 * construction, and `add` only writes floats.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect imports: they are what register the `INSTANCES` shader chunks the
// vertex shader below includes. `ShaderMaterial` does not pull them in itself.
import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';

import { commitInstances, createMatrixBuffer, FLOATS_PER_MATRIX } from './instanceBuffer';
import { cellRect, createSpellSheet, type CellRect } from './spriteSheets';

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 spriteRect;
attribute vec4 spriteTint;
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec2 vSheetUv;
varying vec4 vTint;
void main(void) {
  #include<instancesVertex>
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
  vSheetUv = spriteRect.xy + uv * spriteRect.zw;
  vTint = spriteTint;
}
`;

/**
 * The sheet is painted white-hot on black and the tint carries the hue, so the
 * fragment is a multiply. Alpha is folded into the colour rather than into
 * `gl_FragColor.a`: under additive blending the destination factor is one and
 * the source factor is one, so alpha never reaches the blender — a sprite fades
 * by getting darker, which on an additive layer is exactly the same thing.
 */
const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D sheet;
varying vec2 vSheetUv;
varying vec4 vTint;
void main(void) {
  vec4 texel = texture2D(sheet, vSheetUv);
  gl_FragColor = vec4(texel.rgb * vTint.rgb * vTint.a, 1.0);
}
`;

export class SpriteLayer {
  readonly mesh: Mesh;

  private readonly material: ShaderMaterial;
  private readonly sheet: DynamicTexture;

  private readonly matrices: Float32Array;
  private readonly rects: Float32Array;
  private readonly tints: Float32Array;

  /** Scratch for `cellRect`, which must not allocate inside `add`. */
  private readonly rect: CellRect = { u: 0, v: 0, du: 0, dv: 0 };

  /** The camera's right and up axes in world space, refreshed by `begin`. */
  private rightX = 1;
  private rightY = 0;
  private rightZ = 0;
  private upX = 0;
  private upY = 1;
  private upZ = 0;

  private live = 0;

  constructor(
    private readonly scene: Scene,
    readonly capacity: number,
  ) {
    this.sheet = createSpellSheet(scene);

    this.material = new ShaderMaterial(
      'spellSprites',
      scene,
      { vertexSource: VERTEX_SHADER, fragmentSource: FRAGMENT_SHADER },
      {
        attributes: ['position', 'uv', 'spriteRect', 'spriteTint'],
        uniforms: ['world', 'viewProjection'],
        samplers: ['sheet'],
        needAlphaBlending: true,
      },
    );
    this.material.setTexture('sheet', this.sheet);
    this.material.alphaMode = Constants.ALPHA_ADD;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    // Fog would tint an additive quad toward the haze colour, which on this
    // shader means *adding* the haze to it: a spell would get brighter with
    // distance. The size falloff already sells the depth.
    this.material.fogEnabled = false;

    this.mesh = CreatePlane('spellSprites', { width: 1, height: 1 }, scene);
    this.mesh.material = this.material;
    // The world matrix is identity for the mesh's whole life; thin instances
    // carry every transform (`finalWorld = world * instanceMatrix`).
    this.mesh.freezeWorldMatrix();
    this.matrices = createMatrixBuffer(this.mesh, capacity);
    this.rects = new Float32Array(capacity * 4);
    this.tints = new Float32Array(capacity * 4);
    this.mesh.thinInstanceSetBuffer('spriteRect', this.rects, 4, false);
    this.mesh.thinInstanceSetBuffer('spriteTint', this.tints, 4, false);
    this.mesh.setEnabled(false);
  }

  /** Reads the camera's pose for this frame and empties the buffer. */
  begin(): void {
    this.live = 0;
    const camera = this.scene.activeCamera;
    if (camera === null) return;
    // Right and up in world space are the first two columns of the view
    // matrix, which is the inverse of the camera's pose. Using them as the
    // quad's own axes is what billboards it.
    const view = camera.getViewMatrix().m;
    this.rightX = view[0] ?? 1;
    this.rightY = view[4] ?? 0;
    this.rightZ = view[8] ?? 0;
    this.upX = view[1] ?? 0;
    this.upY = view[5] ?? 1;
    this.upZ = view[9] ?? 0;
  }

  /**
   * One quad, `size` metres across, centred on `(x, y, z)`, showing sheet cell
   * `cell` tinted `(r, g, b)` at `alpha`.
   *
   * `roll` turns the quad about the view axis, which is the only rotation a
   * billboard can have. Extras past the capacity are dropped rather than
   * wrapping: a dropped sparkle is invisible, a wrapped one overwrites
   * something the player is looking at.
   */
  add(
    cell: number,
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    roll = 0,
  ): void {
    if (this.live >= this.capacity || size <= 0 || alpha <= 0) return;

    let ax = this.rightX;
    let ay = this.rightY;
    let az = this.rightZ;
    let bx = this.upX;
    let by = this.upY;
    let bz = this.upZ;
    if (roll !== 0) {
      const cos = Math.cos(roll);
      const sin = Math.sin(roll);
      ax = this.rightX * cos + this.upX * sin;
      ay = this.rightY * cos + this.upY * sin;
      az = this.rightZ * cos + this.upZ * sin;
      bx = this.upX * cos - this.rightX * sin;
      by = this.upY * cos - this.rightY * sin;
      bz = this.upZ * cos - this.rightZ * sin;
    }

    const o = this.live * FLOATS_PER_MATRIX;
    this.matrices[o] = ax * size;
    this.matrices[o + 1] = ay * size;
    this.matrices[o + 2] = az * size;
    this.matrices[o + 3] = 0;
    this.matrices[o + 4] = bx * size;
    this.matrices[o + 5] = by * size;
    this.matrices[o + 6] = bz * size;
    this.matrices[o + 7] = 0;
    // The quad is flat, so its third axis only has to be non-degenerate: a unit
    // normal off the plane keeps the matrix invertible without scaling anything.
    this.matrices[o + 8] = ay * bz - az * by;
    this.matrices[o + 9] = az * bx - ax * bz;
    this.matrices[o + 10] = ax * by - ay * bx;
    this.matrices[o + 11] = 0;
    this.matrices[o + 12] = x;
    this.matrices[o + 13] = y;
    this.matrices[o + 14] = z;
    this.matrices[o + 15] = 1;

    const rect = cellRect(cell, this.rect);
    const at = this.live * 4;
    this.rects[at] = rect.u;
    this.rects[at + 1] = rect.v;
    this.rects[at + 2] = rect.du;
    this.rects[at + 3] = rect.dv;
    this.tints[at] = r;
    this.tints[at + 1] = g;
    this.tints[at + 2] = b;
    this.tints[at + 3] = alpha;

    this.live++;
  }

  /** Uploads whatever was added this frame. Once per frame, after the adds. */
  end(): void {
    commitInstances(this.mesh, this.live);
    if (this.live === 0) return;
    this.mesh.thinInstanceBufferUpdated('spriteRect');
    this.mesh.thinInstanceBufferUpdated('spriteTint');
  }

  /** Quads drawn last frame, for the debug panel and the dev harness. */
  get count(): number {
    return this.live;
  }

  reset(): void {
    this.begin();
    this.end();
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
    this.sheet.dispose();
  }
}
