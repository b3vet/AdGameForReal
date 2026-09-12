/**
 * The soft toon ramp (D28: "bright and flat with a soft toon ramp, no outlines").
 *
 * A `MaterialPluginBase` that injects a few lines into the fragment shader of
 * whatever material it is attached to, just before the fog is applied. Those
 * lines band the shading into three levels with a smooth transition between
 * them, so a character reads as flat shapes with a lit side and a shaded side
 * rather than as a smooth photographic gradient.
 *
 * Three things decided the shape of this:
 *
 *  1. **It bands a term of its own, not the pixel's colour.** Quantising the
 *     final colour would quantise the albedo too, and the KayKit characters are
 *     a texture atlas of flat colours — half the palette would collapse into
 *     its neighbour. So the plugin recomputes `N·L` against a fixed light
 *     direction, steps *that* into three levels, and multiplies the pixel by
 *     the result. The albedo is untouched.
 *  2. **It is a multiplier centred near 1.** The scene's own lighting is
 *     deliberately soft (a 0.7 ambient plus a 0.6 key, `scene.ts`), and this
 *     puts the hard edges back on top of it. A ramp that replaced the lighting
 *     would have to know about every light in the scene; one that modulates it
 *     only has to not change the average exposure.
 *  3. **Its constants are baked into the GLSL string, not sent as uniforms.**
 *     There is one key light in this game and it never moves. A uniform would
 *     be a per-frame bind and another thing for the warm-up to get wrong.
 *
 * It has to work on the PBR materials the glTF loader builds (crowds, boss,
 * props, ragdolls), on the `StandardMaterial`s of the greybox fallbacks, and on
 * the baked-vertex-animation and thin-instance *variants* of both. That is why
 * it hangs off `CUSTOM_FRAGMENT_BEFORE_FOG`, the one injection point where both
 * shaders have a world normal (`normalW`) and the pixel still in a variable,
 * and why `src/render/warmup.ts` runs after every material exists: a plugin
 * adds a shader variant, and an uncompiled variant is a stall waiting for the
 * frame that first needs it.
 *
 * Unlit materials — the sky dome, the gate panels, every additive effect — are
 * deliberately never given the ramp: they have no lighting to band, and their
 * flatness is the look.
 */

import { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';

const PLUGIN_NAME = 'ArcaneToonRamp';

/**
 * Where the light the ramp bands against comes from, in world space: the key
 * light of `scene.ts`, normalised and negated, because the shader wants the
 * vector *toward* the light.
 */
const LIGHT = normalise(0.35, 0.8, -0.45);

/**
 * The three bands and the two edges between them.
 *
 * `N·L` is wrapped to 0..1 (`* 0.5 + 0.5`) so a surface facing away from the
 * key still lands inside the ramp rather than clamping to the shadow band —
 * with an ambient this high, nothing in the scene is actually unlit.
 *
 * The levels bracket 1: the middle band is neutral, so the ramp neither
 * brightens nor darkens the scene overall, it only separates it. `SOFTNESS` is
 * the half-width of each transition; at 0 this is a hard cel edge, and the plan
 * asked for a soft one.
 */
const SHADE = 0.8;
const MID = 1;
const LIT = 1.16;
const EDGE_LOW = 0.42;
const EDGE_HIGH = 0.68;
const SOFTNESS = 0.1;

/**
 * The band itself. `normalW` is in scope at the injection point in both
 * shaders: `default.fragment` declares it at the top of `main`, and
 * `pbr.fragment` gets it from `pbrBlockNormalGeometric`.
 */
const BAND =
  `  float toonNdl = dot(normalize(normalW), vec3(${f(LIGHT.x)}, ${f(LIGHT.y)}, ${f(LIGHT.z)})) * 0.5 + 0.5;\n` +
  `  float toonBand = ${f(SHADE)}\n` +
  `    + ${f(MID - SHADE)} * smoothstep(${f(EDGE_LOW - SOFTNESS)}, ${f(EDGE_LOW + SOFTNESS)}, toonNdl)\n` +
  `    + ${f(LIT - MID)} * smoothstep(${f(EDGE_HIGH - SOFTNESS)}, ${f(EDGE_HIGH + SOFTNESS)}, toonNdl);\n`;

class ToonRampPlugin extends MaterialPluginBase {
  /**
   * The pixel's name in this material's shader. Two shaders, two names:
   * `finalColor` in `pbr.fragment` (built by `pbrBlockFinalColorComposition`)
   * and `color` in `default.fragment`. Decided here, from the material's own
   * class, rather than with a `#ifdef` on some define that happens to correlate
   * — every define that looked like it would separate them (`REFLECTION`,
   * `PBR`) is set by both shaders under some configuration.
   */
  private readonly pixel: string;

  constructor(material: Material, pixel: string) {
    // No defines and `enable: true`: the plugin has no property to switch it on
    // with, because a material either gets the ramp when it is built or never.
    super(material, PLUGIN_NAME, 200, undefined, true, true);
    this.pixel = pixel;
  }

  override getClassName(): string {
    return PLUGIN_NAME;
  }

  override getCustomCode(shaderType: string): { [pointName: string]: string } | null {
    if (shaderType !== 'fragment') return null;
    return { CUSTOM_FRAGMENT_BEFORE_FOG: `${BAND}  ${this.pixel}.rgb *= toonBand;\n` };
  }
}

/**
 * Gives `material` the ramp, unless it is unlit, not a material at all, or has
 * one already.
 *
 * Fail-soft on purpose: this is called on materials that came out of a glTF
 * file and on ones that may be `null` because a model failed to load, and a
 * missing ramp is a look, never a crash.
 */
export function applyToonRamp(material: unknown): void {
  if (!(material instanceof Material)) return;
  if (material.pluginManager?.getPlugin(PLUGIN_NAME) != null) return;

  const name = material.getClassName();
  // `PBRMaterial`, `PBRMetallicRoughnessMaterial`, `PBRBaseMaterial`: every one
  // of them is the `pbr.fragment` shader.
  const pixel = name.startsWith('PBR') ? 'finalColor' : name === 'StandardMaterial' ? 'color' : '';
  if (pixel === '') return;

  // An unlit material has no shading to band, and multiplying its emissive
  // would only dim one side of a gate panel for no reason.
  if ('disableLighting' in material && material.disableLighting === true) return;
  if ('unlit' in material && material.unlit === true) return;

  new ToonRampPlugin(material, pixel);
}

/** The same, for every material a model arrived with. */
export function applyToonRampToAll(materials: Iterable<unknown>): void {
  for (const material of materials) applyToonRamp(material);
}

/**
 * Ramps every PBR material in the scene, whoever built it.
 *
 * PBR only, and that is the rule rather than an accident: everything the glTF
 * loader makes is PBR — the crowds, the boss, the roadside props and the
 * physics layer's ragdolls, which is the whole list the plan asks for — while
 * everything the renderer builds by hand is a `StandardMaterial`: the road, the
 * gate panels, the rings, the sky dome. Those are flat or unlit on purpose and
 * banding them would only dim one side of a gate number.
 *
 * Called from `Renderer.warmUp`, which runs at boot, again when the physics
 * pools attach, and again at every level start — so a ragdoll material that
 * arrives after boot is ramped *before* the pass that compiles it, and never in
 * the middle of a frame.
 */
export function applyToonRampToScene(scene: { materials: readonly unknown[] }): void {
  for (const material of scene.materials) {
    if (material instanceof Material && material.getClassName().startsWith('PBR')) {
      applyToonRamp(material);
    }
  }
}

function normalise(x: number, y: number, z: number): { x: number; y: number; z: number } {
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/** GLSL will not coerce an integer literal to a float inside an expression, so
 *  every number written into the shader needs a decimal point. */
function f(value: number): string {
  return value.toFixed(4);
}
