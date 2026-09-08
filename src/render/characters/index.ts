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

export { loadCharacterAsset } from './asset';
export type { CharacterAsset, LoadCharacterOptions } from './asset';
export { StaticCrowd } from './crowd';
export type { Crowd } from './crowd';
export { VatCrowd } from './VatCrowd';
export {
  assetEntry,
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
