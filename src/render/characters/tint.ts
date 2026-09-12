/**
 * Per-vertex colour for a merged character, from the manifest's tints.
 *
 * A KayKit character is one mesh set on one atlas, and that atlas is not a
 * texture in the usual sense: it is a palette of flat patches and short
 * gradient strips, and every part of every model points its UVs at one of them.
 * So the only handle the renderer has on "make the hat violet but leave its
 * band gold" is the vertex colour the shader multiplies the albedo by — and the
 * only way to tell the band from the hat is where its UVs land.
 *
 * That is what a patch is here: a rectangle of the atlas and the multiplier its
 * texels get. `tints` in `assets.json` is the per-mesh default and
 * `tintPatches` overrides it inside those rectangles. The rectangles were read
 * off `assets/models/mage.glb` directly (see docs/ASSETS.md); if the art is
 * ever re-exported with a different layout they have to be read off again,
 * which is why each one carries a `note` saying what it is.
 *
 * Multipliers run well above 1 because the atlas is dark where the game wants
 * colour: the mage's hat is a near-black navy in the file and a squad of five
 * hundred of them has to read as wizards from two metres of phone screen.
 */

import type { TintPatch } from '@/data/assets-types';

/**
 * One RGBA per vertex: the multiplier that vertex's patch asks for, the part's
 * own default where no patch claims it, or white where the part has neither.
 *
 * White is not a special case in the shader — it is the source texture
 * unchanged — which is what lets `VertexData.merge` see the same attribute on
 * every part.
 */
export function tintColors(
  count: number,
  tint: readonly number[] | undefined,
  patches: readonly TintPatch[] | undefined,
  uvs: Float32Array | null,
): Float32Array {
  const colors = new Float32Array(count * 4);
  const base = rgb(tint);
  const usable = uvs !== null && uvs.length >= count * 2 ? patches : undefined;

  for (let i = 0; i < count; i++) {
    const chosen =
      usable === undefined
        ? base
        : (patchAt(usable, uvs?.[i * 2] ?? 0, uvs?.[i * 2 + 1] ?? 0) ?? base);
    colors[i * 4] = chosen[0];
    colors[i * 4 + 1] = chosen[1];
    colors[i * 4 + 2] = chosen[2];
    colors[i * 4 + 3] = 1;
  }
  return colors;
}

/** The first patch whose rectangle contains `(u, v)`; first declared wins. */
function patchAt(
  patches: readonly TintPatch[],
  u: number,
  v: number,
): readonly [number, number, number] | null {
  for (const patch of patches) {
    if (!within(patch.u, u) || !within(patch.v, v)) continue;
    return rgb(patch.tint);
  }
  return null;
}

/** An omitted or malformed range means "the whole axis". */
function within(range: readonly number[] | undefined, value: number): boolean {
  if (range === undefined || range.length < 2) return true;
  return value >= (range[0] ?? 0) && value <= (range[1] ?? 1);
}

function rgb(tint: readonly number[] | undefined): readonly [number, number, number] {
  return [tint?.[0] ?? 1, tint?.[1] ?? 1, tint?.[2] ?? 1];
}
