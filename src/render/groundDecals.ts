/**
 * Soft tinted discs lying on the road, as one draw call.
 *
 * The frost wake and the charger's dust were additive billboards in the spell
 * batch (`./sprites.ts`) until the first Frostfell hero set: additive light is
 * only ever visible against something darker than itself, and a Frostfell road
 * is `stone.light` — the brightest surface in the frame. A near-white puff on
 * it is arithmetically invisible, which is exactly how it photographed.
 *
 * So this layer blends instead of adding, and lies flat on the road instead of
 * facing the camera: a mark on the ground darker than the ground, which reads
 * on ice and on warm stone alike. The disc is computed in the fragment shader
 * from the quad's own uv rather than sampled, so the batch carries no texture
 * and the mask costs one `length` and one `smoothstep`.
 *
 * Immediate mode, in the family `./shadows.ts`, `./labels.ts` and
 * `./sprites.ts` already use: an owner `begin`s, `add`s what it wants this
 * frame, and `end`s. Nothing is retained. No allocation on the frame path —
 * every buffer is sized once and `add` only writes floats.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect imports: they register the `INSTANCES` chunks the vertex shader
// includes. `ShaderMaterial` does not pull them in itself.
import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import { DECAL_SOFT_EDGE } from './theme';

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 decalTint;
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec2 vUv;
varying vec4 vTint;
void main(void) {
  #include<instancesVertex>
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
  vUv = uv;
  vTint = decalTint;
}
`;

/**
 * A disc with a soft rim, cut out of the quad. Alpha reaches the blender here,
 * unlike the additive batches: this is ordinary source-over, so a decal fades
 * by becoming *more transparent* rather than by becoming darker.
 */
const FRAGMENT_SHADER = `
precision highp float;
uniform float softEdge;
varying vec2 vUv;
varying vec4 vTint;
void main(void) {
  float d = length(vUv - vec2(0.5)) * 2.0;
  float mask = 1.0 - smoothstep(softEdge, 1.0, d);
  gl_FragColor = vec4(vTint.rgb, vTint.a * mask);
}
`;

export class GroundDecals {
  readonly mesh: Mesh;

  private readonly material: ShaderMaterial;
  private readonly matrices: Float32Array;
  private readonly tints: Float32Array;

  private live = 0;

  /** `y` is how far the discs float over the road; see `SPRAY_Y` in the look. */
  constructor(
    scene: Scene,
    readonly capacity: number,
    private readonly y: number,
  ) {
    this.material = new ShaderMaterial(
      'groundDecals',
      scene,
      { vertexSource: VERTEX_SHADER, fragmentSource: FRAGMENT_SHADER },
      {
        attributes: ['position', 'uv', 'decalTint'],
        uniforms: ['world', 'viewProjection', 'softEdge'],
        needAlphaBlending: true,
      },
    );
    this.material.setFloat('softEdge', DECAL_SOFT_EDGE);
    this.material.alphaMode = Constants.ALPHA_COMBINE;
    this.material.backFaceCulling = false;
    // Depth-tested so a decal behind the boss is behind it, never written, so
    // two overlapping puffs blend instead of occluding each other.
    this.material.disableDepthWrite = true;
    // No fog: this shader has no fog uniforms, and a spray is thrown within a
    // dozen metres of the camera, which is well inside `FOG_START`.
    this.material.fogEnabled = false;

    // A ground rather than a plane: it already lies flat in xz, so an instance
    // matrix is a scale and a translate with no rotation in it.
    this.mesh = CreateGround('groundDecals', { width: 1, height: 1 }, scene);
    this.mesh.material = this.material;
    // Just after the blob shadows (`./shadows.ts` pins itself at 0) and before
    // every other transparent thing: a mark on the road is under all of them.
    this.mesh.alphaIndex = 1;
    this.mesh.freezeWorldMatrix();
    this.matrices = createMatrixBuffer(this.mesh, capacity);
    this.tints = new Float32Array(capacity * 4);
    this.mesh.thinInstanceSetBuffer('decalTint', this.tints, 4, false);
    this.mesh.setEnabled(false);
  }

  begin(): void {
    this.live = 0;
  }

  /** One disc, `size` metres across, centred on `(x, z)`. */
  add(x: number, z: number, size: number, r: number, g: number, b: number, alpha: number): void {
    if (this.live >= this.capacity || size <= 0 || alpha <= 0) return;
    writeInstance(this.matrices, this.live, size, 1, size, x, this.y, z);
    const at = this.live * 4;
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
    this.mesh.thinInstanceBufferUpdated('decalTint');
  }

  /** Discs drawn last frame, for the debug panel and the dev harness. */
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
  }
}
