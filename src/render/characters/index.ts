/**
 * Animated characters for the render layer.
 *
 * Owner: asset pipeline (Milestone 2, Phase A). The render, physics and app
 * agents import from here; nothing else should reach into the files directly.
 *
 *   const asset = await loadCharacterAsset(scene, 'mage', { variant: 'ember' });
 *   const crowd = new VatCrowd(asset, 500);
 *   crowd.setInstance(i, x, 0, z, yaw, 1, 'run', i * 0.037);
 *   crowd.setCount(n);
 *   crowd.commit();            // once per frame, after the writes
 *   crowd.update(dt);          // advances the shared animation clock
 */

export { loadCharacterAsset, loadCharacterAssets } from './asset';
export type { CharacterAsset, LoadCharacterOptions } from './asset';
// The two halves of "merge a KayKit character into one skinned mesh" that the
// physics layer's own merge needs as well (`src/physics/rig.ts`): a ragdoll is
// skinned live rather than from a baked texture, so it cannot use the merge
// above — but a hat parented to a bone has to become a weighted vertex either
// way, and that rule may only exist once.
export { bindSpaceInverse, reskinToParentBone } from './merge';
export { tintColors } from './tint';
export { StaticCrowd } from './crowd';
export type { Crowd } from './crowd';
export { VatCrowd } from './VatCrowd';
export {
  assetBytes,
  assetEntry,
  assetJson,
  assetManifest,
  audioAsset,
  audioAssets,
  modelAsset,
  resolveAssetUrl,
  resolveVatMetaUrl,
  vatAsset,
} from './manifest';
export type {
  AssetEntry,
  AssetKind,
  AssetManifest,
  AudioAsset,
  ModelAsset,
  TextureAsset,
  VatAsset,
  VatMeta,
  VatRangeMeta,
} from './manifest';
