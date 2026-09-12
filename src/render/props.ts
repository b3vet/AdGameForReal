/**
 * Roadside dressing down both edges of the road, from the KayKit Halloween Bits
 * pack.
 *
 * Milestone 2 dressed a night graveyard: dead trees, gravestones and lanterns.
 * Under D28's daylight the same set reads as a cemetery at noon — the wrong
 * tone entirely — so the mix is re-weighted around the pack's orange pines,
 * with the fence runs that make a country lane and a quarter as many
 * gravestones. The dead trees are gone: seen from Milestone 3's lower camera
 * they are bare trunks at eye level, and in daylight a brown trunk beside the
 * road reads as a fallen log in the frame rather than as a silhouette against
 * the sky. Dropping the kind also gives a draw call back.
 *
 * Every prop type is one mesh drawn as thin instances, so the whole biome costs
 * one draw call per type however many of them there are. The layout is seeded
 * off the level index: the same level is dressed the same way every time it is
 * played, which matters for screenshots and for a player replaying a level.
 *
 * Placed once per level in `build`, never touched again — props do not move, so
 * nothing here runs per frame.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';

import { modelAsset } from './characters';
import { commitInstances, createMatrixBuffer, writeRotatedInstance } from './instanceBuffer';
import { liftEmissive, loadStaticMesh, meshExtent, tintMaterial } from './models';
import { applyToonRamp } from './toonRamp';
import { EMBER_COLOR, MAGE_SCALE, ROAD_HALF_WIDTH } from './theme';
import { mulberry32 } from '@/sim';

/**
 * What stands beside the road, how often, and how far out. `weight` is relative
 * within one band; `near` and `far` are metres from the road's edge.
 */
interface PropKind {
  id: string;
  weight: number;
  near: number;
  far: number;
  /** Extra turn applied to every instance, for props authored facing across. */
  yaw?: number;
  /** Multiplies the manifest scale, before the per-instance jitter. */
  size?: number;
  /** Albedo multiplier, for the daylight re-tint; see `tintMaterial`. */
  tint?: readonly [number, number, number];
}

/** Warmer and a shade lighter: the pack is painted for a night scene. */
const WARM: readonly [number, number, number] = [1.16, 1.06, 0.9];
/** For the greys — stone and iron — which go to soot under daylight. */
const PALE: readonly [number, number, number] = [1.28, 1.22, 1.12];

const KINDS: readonly PropKind[] = [
  { id: 'prop_tree_pine_orange_large', weight: 3.2, near: 2.2, far: 9, size: 1.2, tint: WARM },
  { id: 'prop_tree_pine_orange_medium', weight: 3, near: 1.4, far: 7, tint: WARM },
  { id: 'prop_fence', weight: 1.8, near: 0.5, far: 1.1, tint: PALE },
  { id: 'prop_gravestone', weight: 0.6, near: 0.9, far: 4, tint: PALE },
  { id: 'prop_post_lantern', weight: 0.8, near: 0.7, far: 1.4, tint: PALE },
];

/** Metres between one roadside prop and the next, per side. */
const GAP_MIN = 6;
const GAP_MAX = 10;
/** Props of one kind per level. Long levels simply stop dressing past this. */
const PER_KIND = 56;
const LANTERN_CAP = 24;
/**
 * See `liftEmissive`. Almost nothing now: Milestone 2 needed scenery to carry
 * its own light because the biome was a near-black dusk, and under daylight the
 * same lift flattens every trunk to a flat orange card.
 */
const PROP_LIFT = 0.05;
/** Where a lantern's flame sits, as a share of the post's own height. */
const LANTERN_FLAME_Y = 0.88;
const LANTERN_FLAME_SIZE = 0.34;

interface PropSlot {
  kind: PropKind;
  mesh: Mesh;
  matrices: Float32Array;
  count: number;
  scale: number;
  /** The model's own height, before scaling; the lantern hangs its flame off it. */
  height: number;
}

export class PropsView {
  private readonly scene: Scene;
  private readonly slots: PropSlot[] = [];
  private readonly flames: Mesh;
  private readonly flameMatrices: Float32Array;

  constructor(scene: Scene) {
    this.scene = scene;

    const material = new StandardMaterial('lanternFlameMat', scene);
    material.emissiveColor = EMBER_COLOR.scale(1.1);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.alphaMode = Constants.ALPHA_ADD;
    material.alpha = 0.85;

    this.flames = CreateSphere('lanternFlame', { diameter: LANTERN_FLAME_SIZE, segments: 6 }, scene);
    this.flames.material = material;
    this.flameMatrices = createMatrixBuffer(this.flames, LANTERN_CAP);
    this.flames.setEnabled(false);
  }

  async load(): Promise<void> {
    const loaded = await Promise.all(
      KINDS.map(async (kind) => loadStaticMesh(this.scene, kind.id, kind.id)),
    );
    KINDS.forEach((kind, index) => {
      const mesh = loaded[index];
      if (mesh === null || mesh === undefined) return;
      mesh.setEnabled(false);
      // Enough for a dead tree to read as a shape against the sky rather than
      // a hole in it; less than a character, because props are scenery.
      liftEmissive(mesh.material, PROP_LIFT);
      const tint = kind.tint;
      if (tint !== undefined) tintMaterial(mesh.material, tint[0], tint[1], tint[2]);
      applyToonRamp(mesh.material);
      const manifestScale = modelAsset(kind.id).scale ?? 1;
      this.slots.push({
        kind,
        mesh,
        matrices: createMatrixBuffer(mesh, PER_KIND),
        count: 0,
        scale: manifestScale * MAGE_SCALE * (kind.size ?? 1),
        height: meshExtent(mesh).y,
      });
    });
  }

  /**
   * Lays out one level's roadside. Seeded by the level index, so the same level
   * is always dressed the same way.
   */
  build(levelIndex: number, startZ: number, endZ: number): void {
    for (const slot of this.slots) slot.count = 0;
    let flames = 0;

    const random = mulberry32(0x1eaf_0000 + levelIndex * 7919);
    const total = KINDS.reduce((sum, kind) => sum + kind.weight, 0);

    for (const side of [-1, 1]) {
      let z = startZ + random() * GAP_MIN;
      while (z < endZ) {
        z += GAP_MIN + random() * (GAP_MAX - GAP_MIN);
        const slot = pick(this.slots, random() * total);
        if (slot === undefined || slot.count >= PER_KIND) continue;

        const out = slot.kind.near + random() * (slot.kind.far - slot.kind.near);
        const x = side * (ROAD_HALF_WIDTH + out);
        const scale = slot.scale * (0.85 + random() * 0.4);
        const yaw = (slot.kind.yaw ?? 0) + random() * Math.PI * 2;
        writeRotatedInstance(slot.matrices, slot.count, scale, scale, scale, yaw, x, 0, z);
        slot.count++;

        if (slot.kind.id === 'prop_post_lantern' && flames < LANTERN_CAP) {
          writeRotatedInstance(
            this.flameMatrices,
            flames,
            1,
            1,
            1,
            0,
            x,
            slot.height * scale * LANTERN_FLAME_Y,
            z,
          );
          flames++;
        }
      }
    }

    for (const slot of this.slots) commitInstances(slot.mesh, slot.count);
    commitInstances(this.flames, flames);
  }

  /**
   * Locks the roadside against per-frame work: props never move once `build`
   * has placed them, and their materials never change at all. Called after the
   * scene's first `whenReadyAsync`, never before (see `RoadView.freeze`).
   */
  freeze(): void {
    for (const slot of this.slots) {
      slot.mesh.material?.freeze();
      slot.mesh.computeWorldMatrix(true);
      slot.mesh.freezeWorldMatrix();
    }
    this.flames.material?.freeze();
    this.flames.computeWorldMatrix(true);
    this.flames.freezeWorldMatrix();
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.mesh.material?.dispose();
      slot.mesh.dispose();
    }
    this.slots.length = 0;
    this.flames.material?.dispose();
    this.flames.dispose();
  }
}

/** Weighted pick over the prop kinds that actually loaded. */
function pick(slots: readonly PropSlot[], roll: number): PropSlot | undefined {
  let seen = 0;
  for (const slot of slots) {
    seen += slot.kind.weight;
    if (roll <= seen) return slot;
  }
  return slots[slots.length - 1];
}
