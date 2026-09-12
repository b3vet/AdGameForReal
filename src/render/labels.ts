/**
 * Every number the player reads in the world — gate values, block HP, stream
 * counts, the boss's number — as thin-instanced quads cut out of one glyph
 * sheet (`./glyphAtlas.ts`).
 *
 * This replaces Milestone 2's Babylon GUI layer (Milestone 3 plan, performance
 * step 1). That layer was a full-screen `DynamicTexture`: every frame it drew a
 * screen-sized quad, and every time a number moved it re-painted and re-uploaded
 * a 390x844 canvas — a texture upload in the middle of the frame, on the phone,
 * whenever a block took damage. Here the sheet is painted once at boot and the
 * per-frame cost is three buffer writes and one draw call, whatever is on
 * screen.
 *
 * Immediate mode, like `./rings.ts`: a view `set`s the labels it wants this
 * frame and `commit` draws exactly those. A label that is not set is not drawn,
 * so a view that forgets to hide one cannot leave a number floating.
 *
 * No allocation in the per-frame path: the text is a string the caller already
 * had, walked by char code, and every buffer is sized once at construction.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect imports: they are what register the `INSTANCES` shader chunks the
// vertex shader below includes. `ShaderMaterial` does not pull them in itself.
import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex';

import { GlyphAtlas } from './glyphAtlas';
import { commitInstances, createMatrixBuffer, FLOATS_PER_MATRIX } from './instanceBuffer';

/**
 * Glyphs on screen at once. Three rows of three gates at up to five characters,
 * a dozen blocks, a stream count per lane and the boss's number come to well
 * under two hundred; 600 is headroom that costs 38 KB of buffer and nothing per
 * frame, since only the live count is uploaded.
 */
const GLYPH_BUDGET = 600;

/**
 * Label sizes are authored against a 390x844 phone, as the GUI layer's were, so
 * the numbers in `theme.ts` carry over unchanged. The smaller of the two ratios
 * wins — the same rule as the GUI's `useSmallestIdeal` — which keeps a label
 * sane on a wide desktop window instead of scaling it to the full width.
 */
const IDEAL_WIDTH = 390;
const IDEAL_HEIGHT = 844;

/** Nearer than this to the camera plane a label is not drawn at all. */
const MIN_DEPTH = 0.3;

/**
 * Distance at which a label is drawn at its full size. Labels shrink past it,
 * so the rows stacked toward the horizon do not print on top of each other —
 * the row the player is deciding about is always the loud one. Inside it they
 * hold a constant *pixel* size, which is what the GUI layer did.
 */
const FULL_SIZE_DISTANCE = 12;

const VERTEX_SHADER = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
attribute vec4 glyphRect;
attribute vec4 glyphTint;
#include<instancesDeclaration>
uniform mat4 viewProjection;
varying vec2 vAtlasUv;
varying vec4 vTint;
void main(void) {
  #include<instancesVertex>
  gl_Position = viewProjection * finalWorld * vec4(position, 1.0);
  vAtlasUv = glyphRect.xy + uv * glyphRect.zw;
  vTint = glyphTint;
}
`;

const FRAGMENT_SHADER = `
precision highp float;
uniform sampler2D atlas;
varying vec2 vAtlasUv;
varying vec4 vTint;
void main(void) {
  vec4 texel = texture2D(atlas, vAtlasUv);
  if (texel.a < 0.01) discard;
  // The sheet's ink is white and its outline is near-black, so multiplying by
  // the tint colours the number and leaves the outline dark.
  gl_FragColor = vec4(texel.rgb * vTint.rgb, texel.a * vTint.a);
}
`;

export class NumberLabels {
  private readonly scene: Scene;
  private readonly atlas: GlyphAtlas;
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  private readonly matrices: Float32Array;
  private readonly rects: Float32Array;
  private readonly tints: Float32Array;

  /** One slot per claimed label id; every field is written by `set`. */
  private readonly texts: string[] = [];
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly sizes: number[] = [];
  private readonly live: boolean[] = [];

  /** Glyphs written since the last `commit`. */
  private glyphs = 0;
  /** Glyphs the budget refused last frame, for the boot-time warning. */
  private dropped = 0;
  /** Labels actually drawn last frame, which is what the debug panel names. */
  private drawn = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    this.atlas = new GlyphAtlas(scene);

    this.material = new ShaderMaterial(
      'numberLabels',
      scene,
      { vertexSource: VERTEX_SHADER, fragmentSource: FRAGMENT_SHADER },
      {
        attributes: ['position', 'uv', 'glyphRect', 'glyphTint'],
        uniforms: ['world', 'viewProjection'],
        samplers: ['atlas'],
        needAlphaBlending: true,
      },
    );
    this.material.setTexture('atlas', this.atlas.texture);
    this.material.alphaMode = Constants.ALPHA_COMBINE;
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    // Depth testing off, so a number is never swallowed by the panel, the block
    // or the demon it belongs to. Safe because the labels have a rendering
    // group of their own and are drawn after everything else.
    this.material.depthFunction = Constants.ALWAYS;
    this.material.fogEnabled = false;

    // A unit quad in the xy plane: the instance matrix carries the camera's own
    // right and up vectors, which is what billboards it.
    this.mesh = CreatePlane('numberLabels', { width: 1, height: 1 }, scene);
    this.mesh.material = this.material;
    this.mesh.renderingGroupId = 1;
    // The world matrix is identity for the mesh's whole life; thin instances
    // carry every transform (`finalWorld = world * instanceMatrix`).
    this.mesh.freezeWorldMatrix();
    this.matrices = createMatrixBuffer(this.mesh, GLYPH_BUDGET);
    this.rects = new Float32Array(GLYPH_BUDGET * 4);
    this.tints = new Float32Array(GLYPH_BUDGET * 4);
    this.mesh.thinInstanceSetBuffer('glyphRect', this.rects, 4, false);
    this.mesh.thinInstanceSetBuffer('glyphTint', this.tints, 4, false);
    this.mesh.setEnabled(false);

    // Group 1 exists only to put the labels last. Clearing the depth buffer
    // before it would be a full-screen write a frame for nothing: the material
    // neither tests nor writes depth.
    scene.setRenderingAutoClearDepthStencil(1, false, false, false);
  }

  /** True when the sheet was rasterised in Cinzel rather than the fallback. */
  get usesDisplayFont(): boolean {
    return this.atlas.usedDisplayFont;
  }

  /** Init-time only. Returns a label id the caller owns for the app's life. */
  claim(): number {
    const id = this.texts.length;
    this.texts.push('');
    this.positions.push(0, 0, 0);
    this.colors.push(1, 1, 1);
    this.sizes.push(0);
    this.live.push(false);
    return id;
  }

  /**
   * Draws `text` centred on `(x, y, z)` this frame.
   *
   * `scale` is a height in design pixels — the same numbers the GUI layer's
   * `fontSize` took — so the label is the same size on screen at every device
   * pixel ratio. `color` is read, never kept: callers pass a `theme.ts` constant.
   */
  set(
    id: number,
    text: string,
    x: number,
    y: number,
    z: number,
    color: Color3,
    scale: number,
  ): void {
    if (id < 0 || id >= this.texts.length) return;
    this.texts[id] = text;
    const at = id * 3;
    this.positions[at] = x;
    this.positions[at + 1] = y;
    this.positions[at + 2] = z;
    this.colors[at] = color.r;
    this.colors[at + 1] = color.g;
    this.colors[at + 2] = color.b;
    this.sizes[id] = scale;
    this.live[id] = true;
  }

  /** Takes a label off this frame. Idempotent; safe before the first `set`. */
  hide(id: number): void {
    if (id < 0 || id >= this.live.length) return;
    this.live[id] = false;
  }

  /**
   * Draws one degenerate glyph so the label shader is compiled by the scene's
   * boot-time readiness pass rather than by the first frame that shows a gate.
   *
   * It has to be a real instance: the `THIN_INSTANCES` define — and with it the
   * `world * instanceMatrix` in the vertex shader — only appears once the mesh
   * has instances, so forcing a compile on the empty mesh would warm the wrong
   * variant. The matrix is all zeros, which collapses the quad to a point and
   * rasterises nothing.
   */
  warmUp(): void {
    this.matrices.fill(0, 0, FLOATS_PER_MATRIX);
    this.matrices[FLOATS_PER_MATRIX - 1] = 1;
    this.rects.fill(0, 0, 4);
    this.tints.fill(0, 0, 4);
    this.glyphs = 1;
    this.publish();
  }

  /** Lays out every label set this frame and uploads them. Once per frame. */
  commit(): void {
    this.glyphs = 0;
    this.dropped = 0;
    this.drawn = 0;

    const camera = this.scene.activeCamera;
    if (camera === null) {
      this.publish();
      return;
    }

    // Right, up and forward in world space, read off the view matrix, which is
    // the inverse of the camera's pose: its columns are those three axes. Using
    // them as the quad's own axes is what makes every glyph face the camera and
    // stay upright on screen, exactly as the GUI's screen-space text did.
    const view = camera.getViewMatrix().m;
    const rightX = view[0] ?? 1;
    const rightY = view[4] ?? 0;
    const rightZ = view[8] ?? 0;
    const upX = view[1] ?? 0;
    const upY = view[5] ?? 1;
    const upZ = view[9] ?? 0;
    const forwardX = view[2] ?? 0;
    const forwardY = view[6] ?? 0;
    const forwardZ = view[10] ?? 1;

    const eye = camera.globalPosition;
    const engine = this.scene.getEngine();
    const scaling = engine.getHardwareScalingLevel();
    // CSS pixels, not backing-store ones: a label has to be the same physical
    // size on a 1x screen and a 3x one.
    const cssWidth = engine.getRenderWidth() * scaling;
    const cssHeight = engine.getRenderHeight() * scaling;
    if (cssHeight <= 0) {
      this.publish();
      return;
    }
    const ui = Math.min(cssWidth / IDEAL_WIDTH, cssHeight / IDEAL_HEIGHT);
    // World metres one design pixel covers, per metre of depth.
    const perPixel = (ui * 2 * Math.tan(camera.fov / 2)) / cssHeight;

    for (let id = 0; id < this.texts.length; id++) {
      if (this.live[id] !== true) continue;
      this.live[id] = false;
      const text = this.texts[id] ?? '';
      if (text.length === 0) continue;

      const at = id * 3;
      const x = this.positions[at] ?? 0;
      const y = this.positions[at + 1] ?? 0;
      const z = this.positions[at + 2] ?? 0;
      const depth =
        (x - eye.x) * forwardX + (y - eye.y) * forwardY + (z - eye.z) * forwardZ;
      if (depth < MIN_DEPTH) continue;

      const size = (this.sizes[id] ?? 0) * perPixel * depth;
      if (size <= 0) continue;
      this.drawn++;

      // Two passes over the string: one for the width, one to place the pen.
      // Cheaper than the array of glyphs the alternative would allocate.
      let advance = 0;
      for (let i = 0; i < text.length; i++) {
        advance += this.atlas.get(text.charCodeAt(i))?.advance ?? 0;
      }
      let pen = -(advance * size) / 2;

      const red = this.colors[at] ?? 1;
      const green = this.colors[at + 1] ?? 1;
      const blue = this.colors[at + 2] ?? 1;

      for (let i = 0; i < text.length; i++) {
        const glyph = this.atlas.get(text.charCodeAt(i));
        if (glyph === undefined) continue;
        const step = glyph.advance * size;
        if (this.glyphs >= GLYPH_BUDGET) {
          this.dropped++;
          pen += step;
          continue;
        }

        // The quad's centre: along the camera's right axis from the label's
        // anchor by the pen, which puts the string's middle on the anchor.
        const centre = pen + step / 2;
        const cx = x + rightX * centre;
        const cy = y + rightY * centre;
        const cz = z + rightZ * centre;
        const width = glyph.width * size;
        const height = glyph.height * size;

        const o = this.glyphs * FLOATS_PER_MATRIX;
        this.matrices[o] = rightX * width;
        this.matrices[o + 1] = rightY * width;
        this.matrices[o + 2] = rightZ * width;
        this.matrices[o + 3] = 0;
        this.matrices[o + 4] = upX * height;
        this.matrices[o + 5] = upY * height;
        this.matrices[o + 6] = upZ * height;
        this.matrices[o + 7] = 0;
        this.matrices[o + 8] = forwardX;
        this.matrices[o + 9] = forwardY;
        this.matrices[o + 10] = forwardZ;
        this.matrices[o + 11] = 0;
        this.matrices[o + 12] = cx;
        this.matrices[o + 13] = cy;
        this.matrices[o + 14] = cz;
        this.matrices[o + 15] = 1;

        const r = this.glyphs * 4;
        this.rects[r] = glyph.u;
        this.rects[r + 1] = glyph.v;
        this.rects[r + 2] = glyph.du;
        this.rects[r + 3] = glyph.dv;
        this.tints[r] = red;
        this.tints[r + 1] = green;
        this.tints[r + 2] = blue;
        this.tints[r + 3] = 1;

        this.glyphs++;
        pen += step;
      }
    }

    this.publish();
  }

  /**
   * Labels and glyphs drawn last frame, and how many glyphs the budget refused.
   * Read by the debug panel and the boot-time warning; never inside a frame.
   */
  get stats(): { labels: number; glyphs: number; dropped: number } {
    return { labels: this.drawn, glyphs: this.glyphs, dropped: this.dropped };
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
    this.atlas.dispose();
    this.texts.length = 0;
    this.positions.length = 0;
    this.colors.length = 0;
    this.sizes.length = 0;
    this.live.length = 0;
  }

  private publish(): void {
    commitInstances(this.mesh, this.glyphs);
    if (this.glyphs === 0) return;
    this.mesh.thinInstanceBufferUpdated('glyphRect');
    this.mesh.thinInstanceBufferUpdated('glyphTint');
  }
}

/**
 * The size a label is drawn at, in design pixels, for its distance.
 *
 * Full size up close and shrinking as `1/distance` past `FULL_SIZE_DISTANCE`,
 * which is what keeps three rows of gate numbers from printing on top of each
 * other as they stack toward the horizon. Past that distance the pixel size and
 * the perspective cancel, so a far label is a fixed size in the world; nearer,
 * it is a fixed size on screen. This is the rule Milestone 2's `scaleLabel`
 * applied to the GUI's `fontSize`, kept so the frames still match.
 */
export function labelPixels(base: number, minimum: number, distance: number): number {
  const scaled = (base * FULL_SIZE_DISTANCE) / Math.max(FULL_SIZE_DISTANCE / 2, distance);
  return Math.max(minimum, Math.min(base, scaled));
}
