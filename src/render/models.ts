/**
 * Loading the `.glb` assets the scene is dressed with, in the three shapes the
 * views need them: an animated crowd, a static mesh ready for thin instancing,
 * and a skinned model that still has its animation groups (the boss).
 *
 * Every loader here is fail-soft. A build whose `/assets/` are missing — a
 * production bundle before the copy step lands, a host that blocks the fetch —
 * must still boot into a readable game, so a failure is logged once and the
 * caller gets a greybox stand-in or `null` rather than an exception that kills
 * `Renderer.init` and with it the whole app.
 */

import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect import: registers the glTF 2.0 loader with `ImportMeshAsync`.
import '@babylonjs/loaders/glTF/2.0';

import {
  StaticCrowd,
  VatCrowd,
  loadCharacterAsset,
  loadCharacterAssets,
  modelAsset,
  resolveAssetUrl,
} from './characters';
import type { Crowd } from './characters';

export interface CrowdRequest {
  /** Manifest id, e.g. `mage` or `skeleton_minion`. */
  modelId: string;
  /** Which `variants` key to merge in — the staff, for the mage. */
  variant?: string;
  capacity: number;
  /** Colour of the capsule the fallback draws if the model cannot be loaded. */
  fallbackColor: Color3;
  /** Per-variant override of that colour, for a character with variants. */
  fallbackColors?: Readonly<Record<string, Color3>>;
  fallbackName: string;
  /** Self-lit share of the albedo; see `liftEmissive`. */
  lift?: number;
}

/**
 * How much of its own colour a character carries as emissive.
 *
 * The biome is a near-black dusk (decision: plan, "Palette and tone") and a
 * KayKit mage is navy with a black hat, so under scene light alone the crowd
 * is a silhouette with no colour in it at all. Feeding the albedo back in as a
 * weak emissive lifts the characters off the road without lighting the whole
 * scene, and keeps the hue the artist painted rather than washing it grey.
 */
const CHARACTER_LIFT = 0.26;

/** A crowd of `capacity` animated characters, or capsules if the load failed. */
export async function loadCrowd(scene: Scene, request: CrowdRequest): Promise<Crowd> {
  try {
    const asset = await loadCharacterAsset(
      scene,
      request.modelId,
      request.variant === undefined ? {} : { variant: request.variant },
    );
    liftEmissive(asset.mesh.material, request.lift ?? CHARACTER_LIFT);
    return new VatCrowd(asset, request.capacity);
  } catch (error) {
    warnOnce(request.modelId, error);
    return new StaticCrowd(scene, request.fallbackName, request.fallbackColor, request.capacity);
  }
}

/**
 * Several variants of one character — the three staffs — from a single parse
 * of the `.glb` and a single copy of its baked texture. Fail-soft like
 * `loadCrowd`: a failure hands back capsules, one crowd per variant.
 */
export async function loadCrowds(
  scene: Scene,
  request: Omit<CrowdRequest, 'variant'> & { variants: readonly string[] },
): Promise<Crowd[]> {
  try {
    const assets = await loadCharacterAssets(scene, request.modelId, request.variants);
    return assets.map((asset) => {
      liftEmissive(asset.mesh.material, request.lift ?? CHARACTER_LIFT);
      return new VatCrowd(asset, request.capacity);
    });
  } catch (error) {
    warnOnce(request.modelId, error);
    return request.variants.map(
      (variant) =>
        new StaticCrowd(
          scene,
          `${request.fallbackName}-${variant}`,
          request.fallbackColors?.[variant] ?? request.fallbackColor,
          request.capacity,
        ),
    );
  }
}

/**
 * One mesh in world space, with the loader's transforms (including its
 * right-to-left-handed x flip) baked into the vertices, so it can be drawn as
 * thin instances — which ignore any parent node.
 */
export async function loadStaticMesh(
  scene: Scene,
  modelId: string,
  name: string,
): Promise<Mesh | null> {
  try {
    const loaded = await ImportMeshAsync(resolveAssetUrl(modelId), scene);
    for (const group of loaded.animationGroups) group.dispose();

    const parts: Mesh[] = [];
    for (const node of loaded.meshes) {
      if (node instanceof Mesh && node.getTotalVertices() > 0) {
        // Bakes the flip too: `bakeTransformIntoVertices` reverses the winding
        // itself when the matrix determinant is negative.
        node.bakeCurrentTransformIntoVertices();
        node.parent = null;
        parts.push(node);
      }
    }

    const merged = parts.length === 1 ? parts[0] : Mesh.MergeMeshes(parts, true, true);
    if (merged === null || merged === undefined) throw new Error('no geometry');
    merged.name = name;
    merged.isPickable = false;
    merged.alwaysSelectAsActiveMesh = true;
    merged.doNotSyncBoundingInfo = true;

    for (const node of loaded.transformNodes) node.dispose(false, false);
    return merged;
  } catch (error) {
    warnOnce(modelId, error);
    return null;
  }
}

export interface AnimatedModel {
  /** The node to move, turn and scale. The loader's mirrored frame hangs off it. */
  readonly pivot: TransformNode;
  /** Game animation id (from the manifest's map) to the clip that plays it. */
  readonly groups: ReadonlyMap<string, AnimationGroup>;
  /** Every PBR material on the model, for emissive pulses. */
  readonly materials: readonly PBRMaterial[];
  /** Height in the file's own units, so a caller can scale to metres. */
  readonly height: number;
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/**
 * A skinned model with its animation groups intact — one boss, not a crowd, so
 * it pays for a real skeleton and gets blending between clips in return.
 *
 * The loader's `__root__` (scaled -1 on x to convert glTF's right-handed world)
 * is left exactly as it is and re-parented under a pivot the caller owns:
 * flattening it would mirror the model, and negating it twice would invert it.
 */
export async function loadAnimatedModel(
  scene: Scene,
  modelId: string,
): Promise<AnimatedModel | null> {
  try {
    const entry = modelAsset(modelId);
    const loaded = await ImportMeshAsync(resolveAssetUrl(modelId), scene);

    const pivot = new TransformNode(`${modelId}-pivot`, scene);
    const roots = loaded.meshes.filter((mesh) => mesh.parent === null);
    for (const root of roots) root.parent = pivot;

    const groups = new Map<string, AnimationGroup>();
    for (const [id, clip] of Object.entries(entry.animations)) {
      const group = loaded.animationGroups.find((each) => each.name === clip);
      if (group === undefined) continue;
      group.stop();
      group.enableBlending = true;
      group.blendingSpeed = 0.12;
      groups.set(id, group);
    }
    for (const group of loaded.animationGroups) {
      if (![...groups.values()].includes(group)) group.dispose();
    }

    const materials: PBRMaterial[] = [];
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    for (const mesh of loaded.meshes) {
      mesh.isPickable = false;
      // A skinned mesh's rest-pose bounds are wrong once it animates, and the
      // boss is always in frame anyway.
      mesh.alwaysSelectAsActiveMesh = true;
      const material = mesh.material;
      if (material instanceof PBRMaterial && !materials.includes(material)) materials.push(material);
      if (mesh.getTotalVertices() === 0) continue;
      const bounds = mesh.getBoundingInfo().boundingBox;
      low = Math.min(low, bounds.minimumWorld.y);
      high = Math.max(high, bounds.maximumWorld.y);
    }

    const height = Number.isFinite(high - low) && high > low ? high - low : 1;
    return {
      pivot,
      groups,
      materials,
      height,
      setEnabled: (enabled: boolean): void => {
        pivot.setEnabled(enabled);
      },
      dispose: (): void => {
        for (const group of groups.values()) group.dispose();
        pivot.dispose(false, true);
      },
    };
  } catch (error) {
    warnOnce(modelId, error);
    return null;
  }
}

/**
 * The staff meshes out of the mage `.glb`, centred on their own origin and
 * detached from the rig, for a `weapon` gate to float above its panel.
 *
 * They are parented to hand bones in the file, so the bake here is the rest
 * pose's world matrix — the pose the artist authored the grip in — followed by
 * a recentre, so a caller can spin one about its middle.
 */
export async function loadPropMeshes(
  scene: Scene,
  modelId: string,
  names: readonly string[],
): Promise<Map<string, Mesh>> {
  const props = new Map<string, Mesh>();
  try {
    const loaded = await ImportMeshAsync(resolveAssetUrl(modelId), scene);
    for (const group of loaded.animationGroups) group.dispose();

    for (const name of names) {
      const source = loaded.meshes.find((mesh) => mesh.name === name);
      if (!(source instanceof Mesh) || source.getTotalVertices() === 0) continue;
      source.bakeCurrentTransformIntoVertices();
      source.parent = null;
      source.refreshBoundingInfo();
      const centre = source.getBoundingInfo().boundingBox.centerWorld;
      source.bakeTransformIntoVertices(Matrix.Translation(-centre.x, -centre.y, -centre.z));
      source.refreshBoundingInfo();
      source.isPickable = false;
      source.setEnabled(false);
      props.set(name, source);
    }

    for (const mesh of loaded.meshes) {
      if (mesh instanceof Mesh && [...props.values()].includes(mesh)) continue;
      mesh.dispose(false, false);
    }
    for (const node of loaded.transformNodes) node.dispose(false, false);
  } catch (error) {
    warnOnce(`${modelId}:props`, error);
  }
  return props;
}

/** Longest side of a mesh's bounding box, for scaling a prop to a target size. */
export function meshExtent(mesh: Mesh): Vector3 {
  const bounds = mesh.getBoundingInfo().boundingBox;
  return bounds.maximumWorld.subtract(bounds.minimumWorld);
}

/**
 * Adds a fraction of a material's own albedo back as emissive. PBR multiplies
 * `emissiveColor` by `emissiveTexture`, so pointing the emissive at the albedo
 * map is a hue-preserving lift rather than a grey wash.
 */
export function liftEmissive(material: unknown, amount: number): void {
  if (!(material instanceof PBRMaterial) || amount <= 0) return;
  if (material.albedoTexture !== null) material.emissiveTexture = material.albedoTexture;
  material.emissiveColor = new Color3(amount, amount, amount);
}

const warned = new Set<string>();

function warnOnce(what: string, error: unknown): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[render] asset "${what}" failed to load; drawing the fallback`, error);
}
