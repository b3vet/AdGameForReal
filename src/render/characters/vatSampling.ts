/**
 * How a baked vertex animation is sampled: interpolated, and looping cleanly.
 *
 * Babylon's own `bakedVertexAnimation` shader include picks one baked row with
 * `floor` and shows it whole. That is the source of two artefacts the product
 * owner saw as "the walking animation is a bit glitchy" at the start of a run,
 * where five mages fill a third of the screen (Milestone 4, task P):
 *
 *   1. **Stepping.** The mage is baked at 30 fps and the run clip is played at
 *      1.3x (`RUN_CLIP_SPEED`), so 39 poses reach a 60 Hz display: each pose is
 *      held for one frame, then two, then one — an uneven judder that reads as
 *      a limp. Measured on the real sequence before this file existed:
 *      `2122122121221212...` display frames per baked pose.
 *   2. **A skipped pose once per cycle.** Babylon adds one to the first frame
 *      as soon as its clock passes one cycle (`frameCorrection`), because it
 *      expects the range's last row to repeat its first. Milestone 3's bake
 *      dropped that repeat, so the wrap stepped *two* baked poses at once —
 *      a hitch every 0.6 s of running. `scripts/bake-vat.mjs` bakes the repeat
 *      again, and the maths below uses it as the wrap partner.
 *
 * The fix is to sample the *fractional* row and blend the two poses around it,
 * which costs nothing extra when the GPU can filter a half-float texture (one
 * bilinear fetch instead of one point fetch, the blend done by the sampler) and
 * two fetches when it cannot. Both variants are written out below; which one is
 * installed is decided once, from the engine's own capabilities, and the
 * texture's filter mode has to agree with it — which is why `prepareVatSampling`
 * returns the sampling mode the caller must create the texture with.
 *
 * **This replaces two of Babylon's shader includes**, rather than hanging a
 * `MaterialPluginBase` off each crowd material like `../toonRamp.ts` does. A
 * plugin can only inject into the shader *after* the includes have been
 * resolved, so it would have to find Babylon's generated lines with a regular
 * expression and rewrite them in place; replacing the include is one known
 * string for one known string, and every VAT in this game wants the fix. The
 * store keeps whichever text is registered first (`ShaderStore` only writes an
 * include it does not already have), so installing before the first effect is
 * compiled is enough — Babylon's own module then finds the slot taken.
 */

import { ShaderStore } from '@babylonjs/core/Engines/shaderStore';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
// Side-effect imports: they are what register Babylon's own versions of the two
// includes. Importing them here means this module runs *after* them and the
// assignments below are a deliberate replacement rather than a race.
import '@babylonjs/core/Shaders/ShadersInclude/bakedVertexAnimation';
import '@babylonjs/core/Shaders/ShadersInclude/bakedVertexAnimationDeclaration';

/**
 * The frame the shader lands on, from the four per-instance floats
 * `VatCrowd.setInstance` writes: `(from, to, offsetInFrames, framesPerSecond)`.
 *
 * `VATSpan` is the count of *intervals* in the range, which is one less than
 * its rows because the bake repeats the first pose at `to`. The phase is kept
 * in baked frames rather than in cycles (Babylon divides by the row count,
 * which makes a clip play its own length over one row too many) and carries its
 * fraction into `readMatrixFromRawSamplerVAT`, so a row is never floored: at
 * `VATSpan - 0.5` the sampler blends the last unique pose with the repeat of
 * the first, which is the loop's wrap and is continuous through it.
 *
 * A `speed` of zero still holds one still pose, which is what an enemy block
 * that has not activated yet is drawn with: the phase collapses to the
 * instance's own offset and stops moving.
 */
const BLOCK = `#ifdef BAKED_VERTEX_ANIMATION_TEXTURE
{
#ifdef INSTANCES
#define BVASNAME bakedVertexAnimationSettingsInstanced
#else
#define BVASNAME bakedVertexAnimationSettings
#endif
float VATStartFrame=BVASNAME.x;float VATEndFrame=BVASNAME.y;float VATOffsetFrame=BVASNAME.z;float VATSpeed=BVASNAME.w;float VATSpan=max(1.0,VATEndFrame-VATStartFrame);float VATFrameNum=VATStartFrame+mod(bakedVertexAnimationTime*VATSpeed+VATOffsetFrame,VATSpan);mat4 VATInfluence;VATInfluence=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndices[0],VATFrameNum)*matricesWeights[0];
#if NUM_BONE_INFLUENCERS>1
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndices[1],VATFrameNum)*matricesWeights[1];
#endif
#if NUM_BONE_INFLUENCERS>2
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndices[2],VATFrameNum)*matricesWeights[2];
#endif
#if NUM_BONE_INFLUENCERS>3
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndices[3],VATFrameNum)*matricesWeights[3];
#endif
#if NUM_BONE_INFLUENCERS>4
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndicesExtra[0],VATFrameNum)*matricesWeightsExtra[0];
#endif
#if NUM_BONE_INFLUENCERS>5
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndicesExtra[1],VATFrameNum)*matricesWeightsExtra[1];
#endif
#if NUM_BONE_INFLUENCERS>6
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndicesExtra[2],VATFrameNum)*matricesWeightsExtra[2];
#endif
#if NUM_BONE_INFLUENCERS>7
VATInfluence+=readMatrixFromRawSamplerVAT(bakedVertexAnimationTexture,matricesIndicesExtra[3],VATFrameNum)*matricesWeightsExtra[3];
#endif
finalWorld=finalWorld*VATInfluence;}
#endif
`;

/**
 * The sampler, in the variant the GPU can afford.
 *
 * `filtered`: one fetch per bone matrix, with the row's fraction left in the
 * texture coordinate so the sampler blends the two rows itself. The column
 * coordinate sits exactly on a texel centre, where the horizontal half of the
 * bilinear filter puts all of its weight on that one texel — a matrix must
 * never be blended with the *next matrix along*, only with the same matrix on
 * the next row.
 *
 * Otherwise: two point fetches per bone matrix and the blend in the shader.
 * Twice the fetches, and the reason it is not the only variant.
 *
 * Both paths address the texture in normalised coordinates rather than
 * `texelFetch`, because `bakedVertexAnimationTextureSizeInverted` is bound on
 * every engine (`BakedVertexAnimationManager.bind`) and a fractional row is
 * what this whole file is about.
 */
function declaration(filtered: boolean): string {
  const body = filtered
    ? `float dx=bakedVertexAnimationTextureSizeInverted.x;float offset=index*4.0;float v=(frame+0.5)*bakedVertexAnimationTextureSizeInverted.y;vec4 m0=texture2D(smp,vec2(dx*(offset+0.5),v));vec4 m1=texture2D(smp,vec2(dx*(offset+1.5),v));vec4 m2=texture2D(smp,vec2(dx*(offset+2.5),v));vec4 m3=texture2D(smp,vec2(dx*(offset+3.5),v));return mat4(m0,m1,m2,m3);`
    : `float dx=bakedVertexAnimationTextureSizeInverted.x;float dy=bakedVertexAnimationTextureSizeInverted.y;float offset=index*4.0;float row=floor(frame);float blend=frame-row;float v0=(row+0.5)*dy;float v1=(row+1.5)*dy;vec4 m0=mix(texture2D(smp,vec2(dx*(offset+0.5),v0)),texture2D(smp,vec2(dx*(offset+0.5),v1)),blend);vec4 m1=mix(texture2D(smp,vec2(dx*(offset+1.5),v0)),texture2D(smp,vec2(dx*(offset+1.5),v1)),blend);vec4 m2=mix(texture2D(smp,vec2(dx*(offset+2.5),v0)),texture2D(smp,vec2(dx*(offset+2.5),v1)),blend);vec4 m3=mix(texture2D(smp,vec2(dx*(offset+3.5),v0)),texture2D(smp,vec2(dx*(offset+3.5),v1)),blend);return mat4(m0,m1,m2,m3);`;

  return `#ifdef BAKED_VERTEX_ANIMATION_TEXTURE
uniform float bakedVertexAnimationTime;uniform vec2 bakedVertexAnimationTextureSizeInverted;uniform vec4 bakedVertexAnimationSettings;uniform sampler2D bakedVertexAnimationTexture;
#ifdef INSTANCES
attribute vec4 bakedVertexAnimationSettingsInstanced;
#endif
#define inline
mat4 readMatrixFromRawSamplerVAT(sampler2D smp,float index,float frame)
{${body}}
#endif
`;
}

/** Decided once, and then true for every VAT texture in the session. */
let samplingMode: number | null = null;

/**
 * Installs the interpolating sampler and returns the texture sampling mode the
 * VAT textures must be created with. Idempotent; safe to call per texture.
 *
 * The two have to be decided together: the cheap variant reads a row *between*
 * two rows and needs the sampler to interpolate, and the fallback reads two
 * rows exactly and needs it not to. `textureHalfFloatLinearFiltering` is core
 * on WebGL 2 and true everywhere this game has run, so the fallback is
 * insurance against a device that reports otherwise rather than a path anyone
 * is expected to take.
 */
export function prepareVatSampling(engine: AbstractEngine): number {
  if (samplingMode !== null) return samplingMode;

  const filtered = engine.getCaps().textureHalfFloatLinearFiltering;
  ShaderStore.IncludesShadersStore.bakedVertexAnimationDeclaration = declaration(filtered);
  ShaderStore.IncludesShadersStore.bakedVertexAnimation = BLOCK;
  samplingMode = filtered ? Texture.LINEAR_LINEAR : Texture.NEAREST_NEAREST;
  return samplingMode;
}

