/**
 * Roadside dressing down both edges of the road: how a biome's prop kinds
 * (`./propKinds.ts`) are laid out, instanced and frozen.
 *
 * Every prop type is one mesh drawn as thin instances, so a biome costs one
 * draw call per type it dresses with, however many of them there are — and a
 * type the biome does not dress with costs nothing at all, because a mesh with
 * no instances is not drawn. The layout is seeded off the level index: the same
 * level is dressed the same way every time it is played, which matters for
 * screenshots and for a player replaying a level.
 *
 * Every kind of every biome is loaded once, at boot, and a biome switch only
 * changes which of them the next `build` writes instances for and what albedo
 * multiplier each wears (D49). Nothing here allocates at a level load beyond
 * growing an instance buffer for a longer road, and nothing runs per frame.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Scene } from '@babylonjs/core/scene';

import { modelAsset } from './characters';
import { commitInstances, createMatrixBuffer, writeRotatedInstance } from './instanceBuffer';
import { dustEmissive, liftEmissive, loadStaticMesh, meshExtent, tintMaterial } from './models';
import { PROP_KINDS, tintFrom } from './propKinds';
import type { PropKind } from './propKinds';
import { applyToonRamp } from './toonRamp';
import { EMBER_COLOR, MAGE_SCALE, ROAD_HALF_WIDTH } from './theme';
import { mulberry32 } from '@/sim';
import type { BiomeId } from '@/data/biome-types';

/** Metres between one roadside prop and the next, per side. */
const GAP_MIN = 6;
const GAP_MAX = 10;
/**
 * Slack over a kind's expected share of a road's placements.
 *
 * The layout is a weighted roll per slot, so a kind's count is a binomial
 * around its share and lands above it about half the time. Twenty percent
 * covers that spread on the longest road the game builds; a kind that still
 * runs out only loses the odd tree at the very end of a level, which is the
 * same fail-soft the cap has always had.
 */
const CAP_SLACK = 1.2;
/** Floor under any kind's cap, so a rare kind is never one instance. */
const CAP_MIN = 8;
/** Flames the roadside can carry at once, whichever kind is lighting it. */
const FLAME_CAP = 24;
/**
 * See `liftEmissive`. Almost nothing now: Milestone 2 needed scenery to carry
 * its own light because the biome was a near-black dusk, and under daylight the
 * same lift flattens every trunk to a flat orange card.
 */
const PROP_LIFT = 0.05;
/** The flame mesh's own diameter; a kind's `flame.size` scales this. */
const FLAME_SIZE = 0.34;

/**
 * How many props of one kind a stretch of road can hold: its share of the
 * placements the road has room for, with slack for the roll's own variance.
 *
 * Derived rather than fixed (Milestone 5 Phase E). The road runs from
 * `ROAD_START_Z` to eighty metres past the arena — 416 m on level 1 and 470 m
 * from level 9 on — and the old flat 56 was measured against a much shorter
 * Milestone 2 level. Replaying the layout's own seeded roll, level 10 places 52
 * orange pines on its 470 m: four short of the ceiling, which is not a margin,
 * it is a coincidence. One roll further and the last stretch of the longest
 * levels dresses itself with whatever kinds are left.
 *
 * The cap is a *buffer* size, not a design decision: it only has to be past
 * what the road can ask for. So it is the road's own placement count — both
 * verges at the tightest spacing the roll can produce — times this kind's share
 * of the weights, times `CAP_SLACK`. On that same 470 m road the pines get 62
 * and the gravestones 12, and a 416 m level asks for proportionally less.
 */
function capFor(weight: number, total: number, length: number): number {
  if (weight <= 0 || total <= 0) return CAP_MIN;
  // Both verges, at the tightest spacing the roll can produce: the most slots a
  // road of this length can ever offer.
  const placements = (2 * Math.max(0, length)) / GAP_MIN;
  return Math.max(CAP_MIN, Math.ceil(((placements * weight) / total) * CAP_SLACK));
}

interface PropSlot {
  kind: PropKind;
  mesh: Mesh;
  matrices: Float32Array;
  /** Instances `matrices` has room for; grown by `build` for a longer road. */
  capacity: number;
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

  /** Which biome's kinds are dressed and which tint they wear (D49). */
  private biome: BiomeId = 'meadow';

  constructor(scene: Scene) {
    this.scene = scene;

    const material = new StandardMaterial('propFlameMat', scene);
    material.emissiveColor = EMBER_COLOR.scale(1.1);
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.alphaMode = Constants.ALPHA_ADD;
    material.alpha = 0.85;

    this.flames = CreateSphere('propFlame', { diameter: FLAME_SIZE, segments: 6 }, scene);
    this.flames.material = material;
    this.flameMatrices = createMatrixBuffer(this.flames, FLAME_CAP);
    this.flames.setEnabled(false);
  }

  async load(): Promise<void> {
    const loaded = await Promise.all(
      PROP_KINDS.map(async (kind) =>
        kind.build === undefined
          ? await loadStaticMesh(this.scene, kind.id, kind.id)
          : kind.build(this.scene),
      ),
    );
    PROP_KINDS.forEach((kind, index) => {
      const mesh = loaded[index];
      if (mesh === null || mesh === undefined) return;
      // Every prop mesh is named for its slot, and every name starts with the
      // kind's id: `addPropShadows` finds the roadside by the `prop_` prefix
      // (`./shadows.ts`), and two biomes' pines are the same model under
      // different tints, so the slot index is what keeps the names apart.
      mesh.name = `${kind.id}#${String(index)}`;
      mesh.setEnabled(false);
      // Enough for a tree to read as a shape against the sky rather than a hole
      // in it; less than a character, because props are scenery. A kind with a
      // `dust` recipe writes the same material property and is left to
      // `setBiome`, which is where a role can have moved under it.
      if (kind.dust === undefined) liftEmissive(mesh.material, PROP_LIFT);
      applyToonRamp(mesh.material);
      // A built mesh has no manifest entry to take a scale from and is authored
      // in metres by construction.
      const manifestScale = kind.build === undefined ? (modelAsset(kind.id).scale ?? 1) : 1;
      const unit = kind.metres === true || kind.build !== undefined
        ? manifestScale
        : manifestScale * MAGE_SCALE;
      this.slots.push({
        kind,
        mesh,
        // One slot's worth until the first level says how long its road is;
        // `build` grows it to that road's own cap before it places anything.
        matrices: createMatrixBuffer(mesh, CAP_MIN),
        capacity: CAP_MIN,
        count: 0,
        scale: unit * (kind.size ?? 1),
        height: meshExtent(mesh).y,
      });
    });
    this.setBiome(this.biome);
  }

  /**
   * Re-tints the roadside for a biome (D49) and remembers which kinds it
   * dresses with; the next `build` lays out that set.
   *
   * Only albedo multipliers change here — no mesh, no material and no buffer is
   * created or freed, because every kind of every biome was loaded at boot.
   * That is what keeps the scene's mesh count flat across a campaign's worth of
   * level loads, and it is why the tints are recipes rather than numbers: the
   * roles they name mean something different once the palette has switched.
   */
  setBiome(id: BiomeId): void {
    this.biome = id;
    for (const slot of this.slots) {
      const tint = slot.kind.tint;
      if (tint !== undefined) {
        const [r, g, b] = tintFrom(tint);
        tintMaterial(slot.mesh.material, r, g, b);
      }
      const dust = slot.kind.dust;
      if (dust !== undefined) {
        const [r, g, b] = tintFrom(dust);
        dustEmissive(slot.mesh.material, r, g, b);
      }
    }
  }

  /**
   * Lays out one level's roadside. Seeded by the level index, so the same level
   * is always dressed the same way.
   */
  build(levelIndex: number, startZ: number, endZ: number): void {
    for (const slot of this.slots) slot.count = 0;
    let flames = 0;

    const random = mulberry32(0x1eaf_0000 + levelIndex * 7919);
    // Only the kinds this level dresses with: the lantern gives way to the
    // dungeon torch at level 6, and a weight that is not in the roll is what
    // keeps the layout from leaving a gap where the other one would have gone.
    const lit = this.slots.filter((slot) => dressedOn(slot.kind, levelIndex, this.biome));
    const total = lit.reduce((sum, slot) => sum + slot.kind.weight, 0);
    // What this road can hold, per kind. Buffers only ever grow, and only at a
    // level load: a later level with a longer road pays one allocation for the
    // extra trees and every level after it re-uses it.
    for (const slot of lit) {
      const cap = capFor(slot.kind.weight, total, endZ - startZ);
      if (cap <= slot.capacity) continue;
      slot.matrices = createMatrixBuffer(slot.mesh, cap);
      slot.capacity = cap;
    }

    for (const side of [-1, 1]) {
      let z = startZ + random() * GAP_MIN;
      while (z < endZ) {
        z += GAP_MIN + random() * (GAP_MAX - GAP_MIN);
        const slot = pick(lit, random() * total);
        if (slot === undefined || slot.count >= slot.capacity) continue;

        const out = slot.kind.near + random() * (slot.kind.far - slot.kind.near);
        const x = side * (ROAD_HALF_WIDTH + out);
        const scale = slot.scale * (0.85 + random() * 0.4);
        const yaw = (slot.kind.yaw ?? 0) + random() * Math.PI * 2;
        // A piece authored around its own middle has to be lifted to stand on
        // the road; one authored on its base has `lift` 0 and is untouched.
        const base = (slot.kind.lift ?? 0) * scale;
        writeRotatedInstance(slot.matrices, slot.count, scale, scale, scale, yaw, x, base, z);
        slot.count++;

        const flame = slot.kind.flame;
        if (flame !== undefined && flames < FLAME_CAP) {
          const size = flame.size / FLAME_SIZE;
          // Measured from the prop's *top*, not from its full height: a piece
          // that hangs below its own origin has already been lifted by `base`,
          // and counting that overhang twice put the torch's flame half a metre
          // above the torch.
          const above = (slot.height - (slot.kind.lift ?? 0)) * scale * flame.at;
          writeRotatedInstance(
            this.flameMatrices,
            flames,
            size,
            size,
            size,
            0,
            x,
            base + above,
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

/**
 * Whether a kind is dressed on this level, in this biome. Absent bounds mean
 * every level, and an absent biome list means every biome.
 */
function dressedOn(kind: PropKind, levelIndex: number, biome: BiomeId): boolean {
  if (kind.fromLevel !== undefined && levelIndex < kind.fromLevel) return false;
  if (kind.untilLevel !== undefined && levelIndex > kind.untilLevel) return false;
  if (kind.biomes !== undefined && !kind.biomes.includes(biome)) return false;
  return true;
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
