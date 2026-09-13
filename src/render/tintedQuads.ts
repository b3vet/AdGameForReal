/**
 * A batch of additive billboard quads with a per-instance tint, a per-instance
 * size and a per-instance scroll offset — one mesh, one draw call, whatever it
 * is drawing.
 *
 * `./sprites.ts` is the same idea for the spell sheet, and this is deliberately
 * *not* that class: the sprite layer is a shared immediate-mode batch the whole
 * frame writes into through `SceneViews`, and the two things here — the shimmer
 * inside a gate arch and the ambient motes over the road — belong to views that
 * are handed a scene and nothing else. A batch of their own costs one draw call
 * each and keeps them from having to be wired through the frame.
 *
 * Per-instance tint is what makes one mesh enough: five gate kinds and three
 * spell hues would otherwise be eight meshes and eight draw calls.
 *
 * No allocation in the per-frame path: the buffers are sized once and `add`
 * only writes floats.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect imports: they register the `INSTANCES` chunks the vertex shader
// includes. `ShaderMaterial` does not pull them in itself.
import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';

import { commitInstances, createMatrixBuffer, FLOATS_PER_MATRIX } from './instanceBuffer';

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 quadTint;
attribute vec2 quadScroll;
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec2 vUv;
varying vec4 vTint;
void main(void) {
  #include<instancesVertex>
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
  vUv = uv + quadScroll;
  vTint = quadTint;
}
`;

/**
 * Painted white on black and tinted here, like the spell sheet. Alpha is folded
 * into the colour rather than into `gl_FragColor.a`: under additive blending the
 * blender never sees alpha, so fading is darkening.
 */
const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D sheet;
varying vec2 vUv;
varying vec4 vTint;
void main(void) {
  vec4 texel = texture2D(sheet, vUv);
  gl_FragColor = vec4(texel.rgb * texel.a * vTint.rgb * vTint.a, 1.0);
}
`;

export class TintedQuads {
  readonly mesh: Mesh;

  private readonly material: ShaderMaterial;
  private readonly matrices: Float32Array;
  private readonly tints: Float32Array;
  private readonly scrolls: Float32Array;

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
    name: string,
    texture: BaseTexture,
    readonly capacity: number,
  ) {
    this.material = new ShaderMaterial(
      name,
      scene,
      { vertexSource: VERTEX_SHADER, fragmentSource: FRAGMENT_SHADER },
      {
        attributes: ['position', 'uv', 'quadTint', 'quadScroll'],
        uniforms: ['world', 'viewProjection'],
        samplers: ['sheet'],
        needAlphaBlending: true,
      },
    );
    this.material.setTexture('sheet', texture);
    this.material.alphaMode = Constants.ALPHA_ADD;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    // Fog on an additive quad *adds* the haze colour, so a mote would get
    // brighter with distance. The size falloff sells the depth instead.
    this.material.fogEnabled = false;

    this.mesh = CreatePlane(name, { width: 1, height: 1 }, scene);
    this.mesh.material = this.material;
    this.mesh.freezeWorldMatrix();
    this.matrices = createMatrixBuffer(this.mesh, capacity);
    this.tints = new Float32Array(capacity * 4);
    this.scrolls = new Float32Array(capacity * 2);
    this.mesh.thinInstanceSetBuffer('quadTint', this.tints, 4, false);
    this.mesh.thinInstanceSetBuffer('quadScroll', this.scrolls, 2, false);
    this.mesh.setEnabled(false);
  }

  /** Reads the camera's pose for this frame and empties the buffer. */
  begin(): void {
    this.live = 0;
    const camera = this.scene.activeCamera;
    if (camera === null) return;
    const view = camera.getViewMatrix().m;
    this.rightX = view[0] ?? 1;
    this.rightY = view[4] ?? 0;
    this.rightZ = view[8] ?? 0;
    this.upX = view[1] ?? 0;
    this.upY = view[5] ?? 1;
    this.upZ = view[9] ?? 0;
  }

  /**
   * One billboard, `width` by `height` metres, centred on `(x, y, z)`, tinted
   * `(r, g, b)` at `alpha`, with its texture offset by `(scrollU, scrollV)`.
   */
  add(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    scrollU = 0,
    scrollV = 0,
  ): void {
    if (this.live >= this.capacity || alpha <= 0 || width <= 0 || height <= 0) return;

    const o = this.live * FLOATS_PER_MATRIX;
    this.matrices[o] = this.rightX * width;
    this.matrices[o + 1] = this.rightY * width;
    this.matrices[o + 2] = this.rightZ * width;
    this.matrices[o + 3] = 0;
    this.matrices[o + 4] = this.upX * height;
    this.matrices[o + 5] = this.upY * height;
    this.matrices[o + 6] = this.upZ * height;
    this.matrices[o + 7] = 0;
    // The quad is flat, so its third axis only has to be non-degenerate.
    this.matrices[o + 8] = this.rightY * this.upZ - this.rightZ * this.upY;
    this.matrices[o + 9] = this.rightZ * this.upX - this.rightX * this.upZ;
    this.matrices[o + 10] = this.rightX * this.upY - this.rightY * this.upX;
    this.matrices[o + 11] = 0;
    this.matrices[o + 12] = x;
    this.matrices[o + 13] = y;
    this.matrices[o + 14] = z;
    this.matrices[o + 15] = 1;

    const at = this.live * 4;
    this.tints[at] = r;
    this.tints[at + 1] = g;
    this.tints[at + 2] = b;
    this.tints[at + 3] = alpha;
    this.scrolls[this.live * 2] = scrollU;
    this.scrolls[this.live * 2 + 1] = scrollV;

    this.live++;
  }

  /** Uploads whatever was added this frame. Once per frame, after the adds. */
  end(): void {
    commitInstances(this.mesh, this.live);
    if (this.live === 0) return;
    this.mesh.thinInstanceBufferUpdated('quadTint');
    this.mesh.thinInstanceBufferUpdated('quadScroll');
  }

  /** Quads drawn last frame, for the debug panel and the dev harness. */
  get count(): number {
    return this.live;
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
  }
}
