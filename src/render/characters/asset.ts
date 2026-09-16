/**
 * Loads a character out of its `.glb` and turns it into one thin-instanceable
 * mesh driven by a baked vertex animation texture.
 *
 * The geometry surgery in the middle of it — the merge, the re-skin and the
 * un-mirror, and why each is needed — is `./merge.ts`. What is left here is the
 * load: one parse of the `.glb`, one baked texture, and a `CharacterAsset` per
 * variant that share both.
 */

import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager';
import { Constants } from '@babylonjs/core/Engines/constants';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { Material } from '@babylonjs/core/Materials/material';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect import: registers the glTF 2.0 loader with `ImportMeshAsync`.
import '@babylonjs/loaders/glTF/2.0';

import {
  assetBytes,
  assetJson,
  modelAsset,
  resolveAssetUrl,
  resolveVatMetaUrl,
  vatAsset,
} from './manifest';
import type { ModelAsset, VatMeta } from './manifest';
import { buildLodGeometry, createLodMesh } from './lod';
import { mergeCharacter } from './merge';
import type { PartRange } from './merge';
import { prepareVatSampling } from './vatSampling';

/** Where each part landed in the merged buffers (`./merge.ts`), re-exported
 *  because it is part of the asset a caller is handed. */
export type { PartRange };

/** What `VatCrowd` needs to draw a character, and what the caller must dispose. */
export interface CharacterAsset {
  /** Merged, un-mirrored, skinned to the rig the VAT was baked from. */
  readonly mesh: Mesh;
  /**
   * The colour buffer the merge produced, kept as the *base* a cosmetic tint
   * multiplies (`VatCrowd.setPartTints`). Null when the manifest names no tint
   * at all, in which case there is no buffer to multiply.
   */
  readonly baseColors: Float32Array | null;
  /** Where each named source mesh landed in that buffer. */
  readonly parts: ReadonlyMap<string, PartRange>;
  /**
   * The same character at about a third of the triangles, for units small on
   * screen (`./lod.ts`), with the full-mesh vertex each of its vertices came
   * from. Null when simplifying would not save enough to be worth a draw call.
   */
  readonly lod: { readonly mesh: Mesh; readonly order: Uint32Array } | null;
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
  // Nothing loaded here is drawn as it is, and the variants below yield to the
  // event loop between them: a frame in between must not find a raw
  // character standing at the origin.
  for (const source of loaded.meshes) source.setEnabled(false);

  const skeleton = loaded.skeletons[0];
  if (skeleton === undefined) throw new Error(`${model.url} has no skeleton`);

  const variantNames = Object.keys(model.variants ?? {});
  const { vat, texture } = await loadVatTexture(scene, model.vat);

  let live = variants.length;
  let material: Material | null = null;

  const assets: CharacterAsset[] = [];
  for (const requested of variants) {
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
    // Off until a crowd commits instances into it (`VatCrowd.commit`).
    mesh.setEnabled(false);
    merged.data.applyToMesh(mesh, false);
    // The colour buffer alone is updatable, so a cosmetic can dye the hat and
    // the cape after the merge (D53, `VatCrowd.setPartTints`). Babylon silently
    // ignores an update to a buffer that was not made updatable, which is how
    // the first Phase C probe photographed a crowd still wearing the manifest's
    // own violet.
    if (merged.colors !== null) {
      mesh.setVerticesData(VertexBuffer.ColorKind, merged.colors, true);
    }
    material ??= pickMaterial(sources);
    mesh.material = material;
    // A clone per variant: the mesh only needs *a* skeleton for the shader to
    // take the baked-animation path, and one shared skeleton could not be
    // disposed with the first variant that goes away.
    const bones = skeleton.clone(`${model.id}:${variant}:rig`);
    mesh.skeleton = bones;
    mesh.numBoneInfluencers = BONE_INFLUENCERS;
    mesh.isPickable = false;
    // Thin-instance bounds are not tracked as the buffer changes, so let the
    // mesh skip frustum culling rather than have the crowd vanish at the edge.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;

    const manager = new BakedVertexAnimationManager(scene);
    manager.texture = texture;
    mesh.bakedVertexAnimationManager = manager;

    // The small-on-screen copy, one variant per task: simplifying is tens of
    // milliseconds a character, and three staffs in one go would be a stall
    // the title screen shows.
    await nextTask();
    const lodGeometry = buildLodGeometry(merged.data);
    const lod =
      lodGeometry === null
        ? null
        : {
            mesh: createLodMesh(scene, `${model.id}:${variant}:lod`, lodGeometry, {
              material,
              skeleton: bones,
              manager,
              numBoneInfluencers: BONE_INFLUENCERS,
            }),
            order: lodGeometry.order,
          };

    const asset: CharacterAsset = {
      mesh,
      baseColors: merged.colors,
      parts: merged.parts,
      lod,
      skeleton: bones,
      manager,
      vat,
      scale: model.scale ?? 1,
      dispose(): void {
        // `false`: the texture is shared, so it outlives any one variant.
        lod?.mesh.dispose();
        manager.dispose(false);
        mesh.dispose();
        bones.dispose();
        if (--live > 0) return;
        material?.dispose(true, true);
        material = null;
        texture.dispose();
      },
    };
    assets.push(asset);
  }

  // Everything the loader made: the merged copies own the geometry now, and
  // every variant carries its own clone of the rig.
  for (const source of loaded.meshes) source.dispose(false, false);
  for (const node of loaded.transformNodes) node.dispose(false, false);
  skeleton.dispose();

  return assets;
}

/** Bone influences a merged vertex carries (KayKit's glTF export). */
const BONE_INFLUENCERS = 4;

/** Waits for the next macrotask, so the work after it is a task of its own. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The one material every merged mesh shares; the first source that has one. */
function pickMaterial(sources: readonly Mesh[]): Material | null {
  for (const source of sources) {
    if (source.material !== null) return source.material;
  }
  return null;
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

  // The sampler and the filter mode are one decision, made in `./vatSampling.ts`
  // for the whole session: the interpolating shader reads a row *between* two
  // rows and wants the hardware to blend them.
  const texture = RawTexture.CreateRGBATexture(
    data,
    meta.width,
    meta.height,
    scene,
    false,
    false,
    prepareVatSampling(scene.getEngine()),
    Constants.TEXTURETYPE_HALF_FLOAT,
  );
  texture.name = `vat:${meta.rig}`;
  // A bone matrix is four texels of one row; nothing may wrap round to the
  // opposite edge of the texture, whichever way it is filtered.
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return { vat: meta, texture };
}
