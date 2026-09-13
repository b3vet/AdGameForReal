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
import { EMBER_COLOR, MAGE_SCALE, ROAD_HALF_WIDTH, paletteColor } from './theme';
import type { PaletteRole } from './theme';
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
  /**
   * True when the manifest's `scale` is already metres per model unit. The
   * KayKit *character* packs are authored at a scale the mage's own 0.35 was
   * derived from, and the roadside inherited that; the dungeon pieces (D39) are
   * authored in metres, so they must not be put through it twice.
   */
  metres?: boolean;
  /** How far below its own origin the model hangs, in model units. */
  lift?: number;
  /** A flame rides at this share of the prop's height, this many metres across. */
  flame?: { at: number; size: number };
  /** Levels this kind is dressed on. Absent means every level. */
  fromLevel?: number;
  untilLevel?: number;
}

/**
 * The daylight re-tint, as a palette role rather than three numbers (D36).
 *
 * `mix` is how much of the role's own hue is folded into white and `gain` is
 * how much the result is lifted: the Halloween pack is painted for a night
 * scene, so every prop needs both a hue and a lift or it reads as soot under
 * D28's daylight. The gain is a look number, the hue is the palette's.
 */
function tintFrom(role: PaletteRole, mix: number, gain: number): [number, number, number] {
  const color = paletteColor(role);
  const blend = (channel: number): number => (1 - mix + mix * channel) * gain;
  return [blend(color.r), blend(color.g), blend(color.b)];
}

/** Warmer and a shade lighter, for the foliage. */
const WARM = tintFrom('gold.light', 0.3, 1.12);
/** For the greys — stone and iron — which go to soot under daylight. */
const PALE = tintFrom('stone.light', 0.45, 1.3);
/** The dungeon pieces are painted for torchlight; this brings them outside. */
const DUNGEON = tintFrom('stone.light', 0.35, 1.18);

/** From this level, the roadside lights are dungeon torches, not lanterns. */
const TORCH_FROM_LEVEL = 6;

const KINDS: readonly PropKind[] = [
  { id: 'prop_tree_pine_orange_large', weight: 3.2, near: 2.2, far: 9, size: 1.2, tint: WARM },
  { id: 'prop_tree_pine_orange_medium', weight: 3, near: 1.4, far: 7, tint: WARM },
  { id: 'prop_fence', weight: 1.8, near: 0.5, far: 1.1, tint: PALE },
  { id: 'prop_gravestone', weight: 0.6, near: 0.9, far: 4, tint: PALE },
  {
    id: 'prop_post_lantern',
    weight: 0.8,
    near: 0.7,
    far: 1.4,
    tint: PALE,
    flame: { at: 0.88, size: 0.34 },
    untilLevel: TORCH_FROM_LEVEL - 1,
  },
  /**
   * The dungeon torch takes the lantern's place from level 6 (plan, "a few
   * torches near gates on later levels"): the same slot in the layout and the
   * same flame, in the stonework the arches and walls are built from, so the
   * later road reads as a dungeon approach rather than as a country lane.
   */
  {
    id: 'prop_dungeon_torch_lit',
    weight: 1.1,
    near: 0.55,
    far: 1.2,
    tint: DUNGEON,
    metres: true,
    size: 1.5,
    lift: 0.395,
    flame: { at: 0.94, size: 0.3 },
    fromLevel: TORCH_FROM_LEVEL,
  },
];

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
      const unit = kind.metres === true ? manifestScale : manifestScale * MAGE_SCALE;
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
    const lit = this.slots.filter((slot) => dressedOn(slot.kind, levelIndex));
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

/** Whether a kind is dressed on this level. Absent bounds mean every level. */
function dressedOn(kind: PropKind, levelIndex: number): boolean {
  if (kind.fromLevel !== undefined && levelIndex < kind.fromLevel) return false;
  if (kind.untilLevel !== undefined && levelIndex > kind.untilLevel) return false;
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
