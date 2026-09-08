/**
 * Schema for `assets.json`: every file the game loads at runtime, with the
 * source pack recorded in `docs/ASSETS.md`.
 *
 * Owner: asset pipeline (Milestone 2, Phase A). `src/data/types.ts` is the
 * tuning schema and is owned by the sim; this file is deliberately separate.
 *
 * `url` is relative to `basePath`. The single-file builds rewrite these to
 * `data:` URIs at build time (decision D22), which is why nothing in the code
 * may build an asset path by hand — always go through
 * `src/render/characters/manifest.ts`.
 */

export type AssetKind = 'model' | 'vat' | 'audio' | 'texture';

interface AssetBase {
  id: string;
  kind: AssetKind;
  /** Relative to `basePath`, or an absolute `data:` URI after inlining. */
  url: string;
}

/**
 * A glTF model. `animations` maps the id the game uses to the name the artist
 * gave the clip, so gameplay code never repeats a KayKit or Quaternius string.
 */
export interface ModelAsset extends AssetBase {
  kind: 'model';
  animations: Record<string, string>;
  /** The baked-animation asset id, when this model is drawn as a VAT crowd. */
  vat?: string;
  /**
   * Meshes inside the file that make up the character, merged into one so a
   * crowd is one draw call. Omitted for props and for the boss, which are
   * drawn as they come out of the file.
   */
  body?: readonly string[];
  /**
   * Extra meshes merged in per variant — the staff each weapon carries. They
   * are parented to a bone rather than skinned, so the loader re-skins them to
   * that bone before merging (see `asset.ts`).
   */
  variants?: Record<string, readonly string[]>;
  /** Metres per model unit. KayKit and Quaternius do not agree on scale. */
  scale?: number;
  /**
   * Per-mesh albedo multipliers, baked into the merged mesh as vertex colours
   * (`[r, g, b]`, above 1 to lighten). One material and one atlas serve the
   * whole character, so this is the only way to lift one part of it: the mage's
   * hat is a black brim seen from the camera's pitch, and a crowd of them reads
   * as a field of dark discs rather than as five hundred wizards.
   */
  tints?: Record<string, readonly number[]>;
}

/** A baked vertex animation texture: raw half-float RGBA plus its dimensions. */
export interface VatAsset extends AssetBase {
  kind: 'vat';
  /** The `.json` written next to the `.bin` by `scripts/bake-vat.mjs`. */
  metaUrl: string;
}

export interface AudioAsset extends AssetBase {
  kind: 'audio';
}

export interface TextureAsset extends AssetBase {
  kind: 'texture';
}

export type AssetEntry = ModelAsset | VatAsset | AudioAsset | TextureAsset;

export interface AssetManifest {
  /** Prefix for every relative `url`. Rewritten by the single-file builds. */
  basePath: string;
  entries: readonly AssetEntry[];
}

/** The shape `scripts/bake-vat.mjs` writes beside each `.bin`. */
export interface VatRangeMeta {
  /** The clip's name in the source file, kept for traceability. */
  animation: string;
  /** Inclusive row indices into the texture. */
  from: number;
  to: number;
  loop: boolean;
}

export interface VatMeta {
  rig: string;
  source: string;
  boneCount: number;
  width: number;
  height: number;
  fps: number;
  format: string;
  ranges: Record<string, VatRangeMeta>;
}
