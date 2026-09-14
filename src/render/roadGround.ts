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
import { paletteColor } from './theme';
import type { BiomeId } from '@/data/biome-types';

/** The three materials a biome's ground is painted on. */
export interface GroundMaterials {
  /** The road surface: the biome's road albedo under `stone.light`. */
  road: StandardMaterial;
  /** The open field either side: the verge albedo under `grass.light`. */
  field: StandardMaterial;
  /** The band that overlaps the kerb into the field, one step darker. */
  fringe: StandardMaterial;
  /** The cut stones down both edges; it carries a painted grain, not an albedo. */
  kerb: StandardMaterial;
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
 * The colours are re-read from the roles rather than left to the palette's own
 * in-place rewrite: a material that fell back to a painted tile, or one built
 * from a scaled colour, would not follow the shared instance.
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

  materials.road.diffuseColor.copyFrom(paletteColor('stone.light'));
  materials.field.diffuseColor.copyFrom(paletteColor('grass.light'));
  materials.fringe.diffuseColor.copyFrom(paletteColor('grass.base'));
  materials.kerb.diffuseColor.copyFrom(paletteColor('stone.kerb'));
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
