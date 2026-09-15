/**
 * The road's ground materials and the two albedos each biome floors them with
 * (D49).
 *
 * Split out of `./road.ts` for the file-size rule (CLAUDE.md), along the line
 * that file already draws: `road.ts` is the *meshes* — which strip goes where,
 * how long it is stretched, what is frozen — and this is what they are painted
 * with. The tiling stays in `road.ts`, because a tile size is a length and the
 * lengths are that file's business.
 *
 * Every biome's albedo is built once, at boot, and a switch is a reference
 * assignment. That is deliberate and it is what makes two things true at once:
 * the warm-up pass compiles and uploads every material in the scene before the
 * title screen (`./warmup.ts`), so a Frostfell level cannot compile inside a
 * frame; and ten switches between biomes leave the scene with exactly the
 * meshes, materials and textures it booted with.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

import { tiledAlbedo } from './artTextures';
import { BIOME_GROUND } from './roadLook';
import { paletteHexIn } from './theme';
import type { PaletteRole } from './theme';
import type { BiomeId } from '@/data/biome-types';

/** The three materials a biome's ground is painted on. */
export interface GroundMaterials {
  /** The road surface: the biome's road albedo under `stone.light`. */
  road: StandardMaterial;
  /** The open field either side: the verge albedo under `grass.light`. */
  field: StandardMaterial;
  /** The band that overlaps the kerb into the field, one step darker. */
  fringe: StandardMaterial;
  /**
   * The cut stones down both edges; it carries a painted grain, not an albedo.
   *
   * Optional, and the one material of the four that a *half* of a spanned road
   * may not hold (D52): there is one set of kerbs down the whole road and the
   * far half shares it, so a far half that painted it would paint it in the
   * next span's biome — which is exactly what the Phase C probe caught, a
   * meadow kerb beside a snow road and an ice kerb beside a cobbled one.
   */
  kerb?: StandardMaterial;
}

/**
 * Every biome's ground albedo, by manifest id.
 *
 * `tiledAlbedo` assigns as well as builds — it has to, because its own
 * fail-soft path swaps a painted tile onto the material when a file will not
 * load — so after this loop each material carries whichever biome was built
 * last. `applyGround` is what puts the right one back, and `RoadView` calls it
 * before the first frame.
 */
export function buildGroundAlbedos(
  scene: Scene,
  materials: GroundMaterials,
  roadWidth: number,
  fieldWidth: number,
): Map<string, Texture> {
  const albedos = new Map<string, Texture>();
  for (const ground of Object.values(BIOME_GROUND)) {
    albedos.set(
      ground.road,
      tiledAlbedo(scene, materials.road, ground.road, roadWidth / ground.roadTile, 1),
    );
    albedos.set(
      ground.verge,
      tiledAlbedo(scene, materials.field, ground.verge, fieldWidth / ground.vergeTile, 1),
    );
  }
  return albedos;
}

/**
 * Puts one biome's albedos and palette colours onto the ground materials.
 *
 * Both halves of that matter. The albedo is the texture — cobble or ice — and
 * the colour over it is the palette's, and both are read *for the biome named
 * here* rather than for the one in force. That distinction is what the endless
 * road needs (D52): its far half is painted in the next span's biome while the
 * palette is still on this one, so a colour taken from the roles in force would
 * leave green verges running off into the snow.
 *
 * The colours are re-read rather than left to the palette's own in-place
 * rewrite for the same reason they always were: a material that fell back to a
 * painted tile, or one built from a scaled colour, would not follow the shared
 * instance.
 */
export function applyGround(
  materials: GroundMaterials,
  albedos: ReadonlyMap<string, Texture>,
  id: BiomeId,
): void {
  const ground = BIOME_GROUND[id];
  assignAlbedo(materials.road, albedos.get(ground.road));
  assignAlbedo(materials.field, albedos.get(ground.verge));
  assignAlbedo(materials.fringe, albedos.get(ground.verge));

  paint(materials.road, id, 'stone.light');
  paint(materials.field, id, 'grass.light');
  paint(materials.fringe, id, 'grass.base');

  // Every one of these has just changed, and each of them changed a *texture*:
  // without this the scene keeps drawing what was bound last.
  refreeze(materials.road);
  refreeze(materials.field);
  refreeze(materials.fringe);

  const kerb = materials.kerb;
  if (kerb === undefined) return;
  paint(kerb, id, 'stone.kerb');
  refreeze(kerb);
}

/** One role, resolved in `id` rather than in the biome in force. */
function paint(material: StandardMaterial, id: BiomeId, role: PaletteRole): void {
  material.diffuseColor.copyFrom(Color3.FromHexString(paletteHexIn(id, role)));
}

/**
 * Re-freezes a material that has just been changed, so the change reaches the
 * GPU.
 *
 * A frozen Babylon material is one the scene keeps as its cached material and
 * stops re-binding: the uniforms and the samplers of the *last* bind are what
 * every later frame draws with. Swapping a texture or a colour on one is
 * therefore invisible — which is what the Milestone 8 endless probe caught, and
 * what the campaign's own biome switch (D49) has been doing ever since the
 * ground materials were frozen: a Frostfell road drawn with whichever albedo
 * happened to be bound at boot.
 *
 * `markDirty(true)` is the one call that reopens it: the plain `markDirty()`
 * inside `freeze()` only clears "was previously ready", while the `true` also
 * sets the draw wrapper's `_forceRebindOnNextCall`, which is what `_mustRebind`
 * actually reads. The material stays frozen — one bind is let through, and
 * every frame after it is locked again.
 *
 * It costs no shader: the defines do not change when one texture is swapped for
 * another that is also present, so the effect comes back out of the engine's
 * cache (measured: the program count does not move across a crossing).
 */
export function refreeze(material: StandardMaterial): void {
  if (material.isFrozen) material.markDirty(true);
}

function assignAlbedo(material: StandardMaterial, texture: Texture | undefined): void {
  if (texture === undefined) return;
  material.diffuseTexture = texture;
}

/**
 * A flat material: an albedo times a colour, with no highlight.
 *
 * The colour is copied rather than referenced. `paletteColor` hands out shared
 * instances and rewrites them in place on a biome switch, and a material
 * holding one would change whether or not its view asked it to — which for the
 * ground is the difference between "the road follows the biome" and "the road
 * follows the biome one frame before the texture does".
 */
export function matte(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.clone();
  material.specularColor = Color3.Black();
  return material;
}

/** A self-lit material: the lane runes and the arena band. */
export function glow(
  scene: Scene,
  name: string,
  color: Color3,
  strength: number,
): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.scale(0.2);
  material.emissiveColor = color.scale(strength);
  material.specularColor = Color3.Black();
  return material;
}
