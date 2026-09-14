/**
 * The one piece of Frostfell's roadside that is drawn rather than fetched: a
 * cluster of ice crystals (D49).
 *
 * Built from primitives for the same reason the gate ornaments are
 * (`./gateOrnaments.ts`): no CC0 pack in this project has a crystal, and a
 * handful of octahedra in a palette colour reads better at twenty metres than
 * a mismatched prop would — and costs no bytes in a build with a 12 MB
 * ceiling (D25). The whole cluster is merged into one mesh, so a level's worth
 * of them is one thin-instanced draw call exactly like every other prop kind.
 *
 * They are the biome's answer to the meadow's gravestones: the small, sharp,
 * self-coloured thing that breaks up a verge of trees. Frost hues rather than
 * the biome's greys, because they are the one place on a Frostfell roadside
 * where the palette's cold *saturated* end appears — the ground and the sky are
 * both near-white, and a frame with nothing saturated in it below the gates
 * reads as washed out rather than as cold.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { paletteColor } from './theme';

/**
 * The shards, as `[size, x, z, lean, stretch]` in metres and radians: a tall
 * one in the middle and two shorter ones leaning off it. Three rather than one
 * because a single spike reads as a traffic cone; three at different heights
 * read as something growing out of the ground.
 *
 * `size` is a polyhedron radius, so the tallest shard stands `size * stretch *
 * 1.9` off the road — about 1 m here. The first version was at 0.5 and put
 * two-and-a-half-metre spikes along both verges, taller than the gate plaques
 * and the first thing the eye went to in every frame.
 */
const SHARDS: readonly (readonly [number, number, number, number, number])[] = [
  [0.22, 0, 0, 0.05, 2.5],
  [0.14, 0.17, 0.07, -0.3, 2.1],
  [0.11, -0.13, -0.09, 0.34, 1.8],
];

/** How much of its own colour a crystal carries as emissive. */
const CRYSTAL_GLOW = 0.35;

/**
 * One ice-crystal cluster, ready to be thin-instanced.
 *
 * Octahedra (`CreatePolyhedron` type 1) stretched along y: eight flat faces is
 * the cheapest solid that still catches the key light differently on each side,
 * which is what makes a crystal read as faceted rather than as a smooth cone.
 */
export function createIceCrystals(scene: Scene): Mesh | null {
  const shards = SHARDS.map(([size, x, z, lean, stretch], index) => {
    const shard = CreatePolyhedron(`iceShard${String(index)}`, { type: 1, size }, scene);
    shard.scaling.set(1, stretch, 1);
    shard.rotation.set(lean, index * 1.1, lean * 0.6);
    // Half its stretched height, so the cluster stands on the road rather than
    // half inside it.
    shard.position.set(x, size * stretch * 0.9, z);
    return shard;
  });

  const merged = Mesh.MergeMeshes(shards, true, true);
  if (merged === null) return null;
  merged.name = 'prop_ice_crystal';

  const material = new StandardMaterial('iceCrystalMat', scene);
  const body = paletteColor('spell.frost.body');
  const core = paletteColor('spell.frost.core');
  material.diffuseColor = body.clone();
  // The core rather than the body: a crystal lit from inside is palest at its
  // brightest, which is what separates it from the gate's `fireRate` arch —
  // that one is a saturated blue all over.
  material.emissiveColor = core.scale(CRYSTAL_GLOW);
  material.specularColor = Color3.Black();
  merged.material = material;
  merged.isPickable = false;
  return merged;
}
