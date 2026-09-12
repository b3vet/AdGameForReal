/**
 * Loads a character out of its `.glb` and turns it into one thin-instanceable
 * mesh driven by a baked vertex animation texture.
 *
 * Three things happen here that are not obvious:
 *
 *   1. **Merge.** KayKit splits a character into eight or ten meshes (body,
 *      head, jaw, limbs, cloak, hat). All of them share one material, so they
 *      are merged into a single mesh: a crowd of 500 is then one draw call
 *      instead of ten.
 *   2. **Re-skin.** The hat, the cape and each staff are *not* skinned — they
 *      are plain meshes parented to a bone. Bones do not exist once the
 *      animation is baked, so each one is rewritten as a skinned mesh with all
 *      of its weight on that bone, in the mage's rest pose, and then merged in
 *      like the rest. That is why a staff costs no extra draw call and why one
 *      baked texture serves all three staffs.
 *   3. **Un-mirror.** Babylon's glTF loader converts right-handed glTF to its
 *      own left-handed world with a `__root__` node scaled `-1` on x. A thin
 *      instance cannot inherit that node, so the flip is folded into the
 *      vertices here (and into the baked matrices in `scripts/bake-vat.mjs`),
 *      with the triangle winding reversed to match.
 */

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager';
import { Constants } from '@babylonjs/core/Engines/constants';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Material } from '@babylonjs/core/Materials/material';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect import: registers the glTF 2.0 loader with `ImportMeshAsync`.
import '@babylonjs/loaders/glTF/2.0';

import type { TintPatch } from '@/data/assets-types';

import {
  assetBytes,
  assetJson,
  modelAsset,
  resolveAssetUrl,
  resolveVatMetaUrl,
  vatAsset,
} from './manifest';
import type { ModelAsset, VatMeta } from './manifest';
import { tintColors } from './tint';

/** What `VatCrowd` needs to draw a character, and what the caller must dispose. */
export interface CharacterAsset {
  /** Merged, un-mirrored, skinned to the rig the VAT was baked from. */
  readonly mesh: Mesh;
  /** Kept alive because the shader only takes the VAT path when a mesh has one. */
  readonly skeleton: Skeleton;
  readonly manager: BakedVertexAnimationManager;
  readonly vat: VatMeta;
  /** Metres per model unit, from the manifest. */
  readonly scale: number;
  dispose(): void;
}

export interface LoadCharacterOptions {
  /** Which `variants` key to merge in. Defaults to the first one declared. */
  variant?: string;
}

/** One variant of a character. See `loadCharacterAssets` for why this is a list. */
export async function loadCharacterAsset(
  scene: Scene,
  entry: ModelAsset | string,
  options: LoadCharacterOptions = {},
): Promise<CharacterAsset> {
  const assets = await loadCharacterAssets(scene, entry, [options.variant]);
  const asset = assets[0];
  if (asset === undefined) throw new Error('loadCharacterAssets returned nothing');
  return asset;
}

/**
 * Every variant of a character from **one** parse of the `.glb`.
 *
 * The mage is one file that carries three staffs, and Phase B2 loaded it once
 * per staff: four parses of half a megabyte and four copies of a 400 KB baked
 * texture, all identical. The variants are built here from a single load
 * instead, and they share the file's material and its VAT texture — the texture
 * goes when the last of them is disposed, which is what `live` counts.
 *
 * `undefined` in `variants` means "the first variant the manifest declares".
 */
export async function loadCharacterAssets(
  scene: Scene,
  entry: ModelAsset | string,
  variants: readonly (string | undefined)[],
): Promise<CharacterAsset[]> {
  const model = typeof entry === 'string' ? modelAsset(entry) : entry;
  if (model.vat === undefined) throw new Error(`asset "${model.id}" has no baked animation`);
  if (model.body === undefined) throw new Error(`asset "${model.id}" declares no body meshes`);
  const body = model.body;

  const loaded = await ImportMeshAsync(resolveAssetUrl(model.id), scene);
  // The loader starts the first clip on its own; nothing here is played back.
  for (const group of loaded.animationGroups) group.dispose();

  const skeleton = loaded.skeletons[0];
  if (skeleton === undefined) throw new Error(`${model.url} has no skeleton`);

  const variantNames = Object.keys(model.variants ?? {});
  const { vat, texture } = await loadVatTexture(scene, model.vat);

  let live = variants.length;
  let material: Material | null = null;

  const assets = variants.map((requested) => {
    const variant = requested ?? variantNames[0] ?? '';
    const extra = model.variants?.[variant];
    if (variant !== '' && extra === undefined) {
      throw new Error(
        `asset "${model.id}" has no variant "${variant}" (have ${variantNames.join(', ')})`,
      );
    }

    const wanted = [...body, ...(extra ?? [])];
    const sources = wanted.map((name) => {
      const found = loaded.meshes.find((each) => each.name === name);
      // Everything the glTF loader makes with geometry is a `Mesh`; the
      // narrowing is here because `ImportMeshAsync` is typed to the base.
      if (!(found instanceof Mesh)) throw new Error(`${model.url} has no mesh "${name}"`);
      return found;
    });

    const merged = mergeCharacter(sources, skeleton, model);
    const mesh = new Mesh(`${model.id}:${variant}`, scene);
    merged.applyToMesh(mesh, false);
    material ??= pickMaterial(sources);
    mesh.material = material;
    // A clone per variant: the mesh only needs *a* skeleton for the shader to
    // take the baked-animation path, and one shared skeleton could not be
    // disposed with the first variant that goes away.
    const bones = skeleton.clone(`${model.id}:${variant}:rig`);
    mesh.skeleton = bones;
    mesh.numBoneInfluencers = 4;
    mesh.isPickable = false;
    // Thin-instance bounds are not tracked as the buffer changes, so let the
    // mesh skip frustum culling rather than have the crowd vanish at the edge.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;

    const manager = new BakedVertexAnimationManager(scene);
    manager.texture = texture;
    mesh.bakedVertexAnimationManager = manager;

    const asset: CharacterAsset = {
      mesh,
      skeleton: bones,
      manager,
      vat,
      scale: model.scale ?? 1,
      dispose(): void {
        // `false`: the texture is shared, so it outlives any one variant.
        manager.dispose(false);
        mesh.dispose();
        bones.dispose();
        if (--live > 0) return;
        material?.dispose(true, true);
        material = null;
        texture.dispose();
      },
    };
    return asset;
  });

  // Everything the loader made: the merged copies own the geometry now, and
  // every variant carries its own clone of the rig.
  for (const source of loaded.meshes) source.dispose(false, false);
  for (const node of loaded.transformNodes) node.dispose(false, false);
  skeleton.dispose();

  return assets;
}

/** The one material every merged mesh shares; the first source that has one. */
function pickMaterial(sources: readonly Mesh[]): Material | null {
  for (const source of sources) {
    if (source.material !== null) return source.material;
  }
  return null;
}

/** `undefined` and `null` both mean "this mesh has no such attribute". */
function array(data: Float32Array | number[] | null | undefined): Float32Array | null {
  if (data === null || data === undefined) return null;
  return data instanceof Float32Array ? data : Float32Array.from(data);
}

/** Uniform scale about the origin of the part's own local space. */
function scaleAbout(positions: Float32Array, scale: number): void {
  for (let i = 0; i < positions.length; i++) positions[i] = (positions[i] ?? 0) * scale;
}

/** The glTF right-handed to Babylon left-handed flip, as a plain x negation. */
function unmirror(data: Float32Array): void {
  for (let i = 0; i < data.length; i += 3) data[i] = -(data[i] ?? 0);
}

/**
 * Merges the source meshes into one skinned `VertexData` in the rig's bind
 * space, re-skinning any mesh that is parented to a bone rather than skinned.
 *
 * The manifest's `tints` and `tintPatches` recolour single parts, and single
 * patches of the atlas inside a part, on the way in (`./tint.ts`). Every part
 * gets a colour attribute, white unless the manifest names it:
 * `VertexData.merge` needs the same attributes on every part, and a white
 * multiplier is the source texture unchanged.
 */
function mergeCharacter(
  sources: readonly Mesh[],
  skeleton: Skeleton,
  model: ModelAsset,
): VertexData {
  const parts: VertexData[] = [];
  const boneIndex = new Map(skeleton.bones.map((bone, index) => [bone.name, index]));
  const bindInverse = bindSpaceInverse(sources);
  const tints = model.tints;
  const patches: Record<string, readonly TintPatch[]> | undefined = model.tintPatches;
  const anyTint =
    (tints !== undefined && Object.keys(tints).length > 0) ||
    (patches !== undefined && Object.keys(patches).length > 0);

  for (const source of sources) {
    // `ExtractFromMesh` leaves an absent attribute `undefined` rather than
    // `null`, so every check here has to treat the two the same.
    const data = VertexData.ExtractFromMesh(source, false, true);
    const positions = array(data.positions);
    if (positions === null || data.indices === null || data.indices === undefined) continue;

    // Before the re-skin, so the shrink happens in the part's *own* local
    // space, about its node origin — which for the hat is where it sits on the
    // head, so a 0.8 hat keeps its grip and loses only brim.
    const partScale = model.partScales?.[source.name];
    if (partScale !== undefined && partScale !== 1) scaleAbout(positions, partScale);

    if (array(data.matricesIndices) === null || array(data.matricesWeights) === null) {
      reskinToParentBone(data, source, boneIndex, bindInverse);
    }

    unmirror(positions);
    const normals = array(data.normals);
    if (normals !== null) unmirror(normals);
    reverseWinding(data);
    if (anyTint) {
      data.colors = tintColors(
        positions.length / 3,
        tints?.[source.name],
        patches?.[source.name],
        array(data.uvs),
      );
    }
    parts.push(data);
  }

  const first = parts[0];
  if (first === undefined) throw new Error('nothing to merge');
  return parts.length === 1 ? first : first.merge(parts.slice(1), true);
}

/** World-to-bind transform, taken from the first genuinely skinned source. */
function bindSpaceInverse(sources: readonly Mesh[]): Matrix {
  for (const source of sources) {
    if (source.skeleton === null) continue;
    source.computeWorldMatrix(true);
    return source.getWorldMatrix().clone().invert();
  }
  return Matrix.Identity();
}

/**
 * Rewrites an unskinned accessory as a mesh weighted entirely to the bone it
 * hangs off. Its vertices move into the rig's bind space first, where the
 * bone's baked matrix is the identity, so the pose it was authored in is the
 * pose it keeps.
 */
function reskinToParentBone(
  data: VertexData,
  source: Mesh,
  boneIndex: ReadonlyMap<string, number>,
  bindInverse: Matrix,
): void {
  let node = source.parent;
  let index: number | undefined;
  while (node !== null && index === undefined) {
    index = boneIndex.get(node.name);
    if (index === undefined) node = node.parent;
  }
  if (index === undefined) throw new Error(`"${source.name}" is not parented to a bone`);

  source.computeWorldMatrix(true);
  const toBind = source.getWorldMatrix().multiply(bindInverse);

  const positions = array(data.positions);
  if (positions === null) throw new Error(`"${source.name}" has no positions`);
  const scratch = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    scratch.set(positions[i] ?? 0, positions[i + 1] ?? 0, positions[i + 2] ?? 0);
    const moved = Vector3.TransformCoordinates(scratch, toBind);
    positions[i] = moved.x;
    positions[i + 1] = moved.y;
    positions[i + 2] = moved.z;
  }
  const normals = array(data.normals);
  if (normals !== null) {
    for (let i = 0; i < normals.length; i += 3) {
      scratch.set(normals[i] ?? 0, normals[i + 1] ?? 0, normals[i + 2] ?? 0);
      const moved = Vector3.TransformNormal(scratch, toBind).normalize();
      normals[i] = moved.x;
      normals[i + 1] = moved.y;
      normals[i + 2] = moved.z;
    }
  }

  const count = positions.length / 3;
  const indices = new Float32Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = index;
    weights[i * 4] = 1;
  }
  data.positions = positions;
  data.normals = normals;
  data.matricesIndices = indices;
  data.matricesWeights = weights;
}

/** A mirror flips handedness, so the triangles have to be wound back. */
function reverseWinding(data: VertexData): void {
  const indices = data.indices;
  if (indices === null || indices === undefined) return;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const swap = indices[i] ?? 0;
    indices[i] = indices[i + 2] ?? 0;
    indices[i + 2] = swap;
  }
}

/** Fetches a baked texture and its metadata and builds the RGBA half-float. */
async function loadVatTexture(
  scene: Scene,
  vatId: string,
): Promise<{ vat: VatMeta; texture: RawTexture }> {
  const entry = vatAsset(vatId);
  const [meta, binary] = await Promise.all([
    assetJson<VatMeta>(resolveVatMetaUrl(vatId)),
    assetBytes(resolveAssetUrl(entry.id)),
  ]);

  const data = new Uint16Array(binary);
  const expected = meta.width * meta.height * 4;
  if (data.length !== expected) {
    throw new Error(`${entry.url}: ${String(data.length)} halfs, expected ${String(expected)}`);
  }

  const texture = RawTexture.CreateRGBATexture(
    data,
    meta.width,
    meta.height,
    scene,
    false,
    false,
    Texture.NEAREST_NEAREST,
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  texture.name = `vat:${meta.rig}`;
  return { vat: meta, texture };
}
