/**
 * The dressing a gate wears, so its kind reads before its number does
 * (Milestone 5 plan, "Gates too basic"): vines on `add`, thorns on `sub`, a
 * gold crown on `mul`, crystals on `fireRate`. A `weapon` gate wears the
 * floating staff it is offering instead, which `./gates.ts` already had.
 *
 * They are built from spheres, cones and octahedra rather than fetched: the
 * dungeon pack has no vines, thorns, crowns or crystals, and a handful of
 * primitives tinted by a palette role reads better at twenty metres than a
 * mismatched prop would. Each kind is merged into one mesh, so a kind costs one
 * thin instance per gate and one draw call for the whole row — and only while a
 * gate of that kind is inside `ORNAMENT_RANGE`.
 *
 * Everything is placed about the arch's own origin (`./gateLook.ts`), so an
 * ornament sits *on* the stone rather than beside it: `onRing` is the curve the
 * voussoirs follow, and `legX` the middle of a leg.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreatePolyhedron } from '@babylonjs/core/Meshes/Builders/polyhedronBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import {
  ARCH_APEX,
  ARCH_CLEAR_WIDTH,
  ARCH_HEIGHT,
  ARCH_LEG_THICKNESS,
  ARCH_RING_RADIUS,
  ARCH_RING_THICKNESS,
  ARCH_SPRING_Y,
  ORNAMENT_SIZE,
} from './gateLook';
import { applyToonRamp } from './toonRamp';
import { paletteColor } from './theme';
import type { PaletteRole } from './theme';
import type { GateKind } from '@/sim';

/** Which palette role dresses which kind, and which shape it wears. */
const ORNAMENTS: Readonly<Record<Exclude<GateKind, 'weapon'>, PaletteRole>> = {
  add: 'gate.add',
  sub: 'gate.sub',
  mul: 'gate.mul',
  fireRate: 'gate.fireRate',
};

export type OrnamentKind = keyof typeof ORNAMENTS;

/** The kinds that wear an ornament, in a fixed order the view indexes by. */
export const ORNAMENT_KINDS: readonly OrnamentKind[] = ['add', 'sub', 'mul', 'fireRate'];

/**
 * Which slot of `ORNAMENT_KINDS` a gate kind is dressed from, or -1 for
 * `weapon` — which wears the floating staff instead and has no mesh here.
 */
export function ornamentIndex(kind: GateKind): number {
  for (let i = 0; i < ORNAMENT_KINDS.length; i++) {
    if (ORNAMENT_KINDS[i] === kind) return i;
  }
  return -1;
}

/**
 * One ornament mesh per kind, each already at the size it is worn at.
 *
 * They are separate meshes rather than one with a swapped material because the
 * silhouette is the point: at the distance a player decides at, the number is
 * two grey pixels and the shape over the arch is what says "this row has a
 * curse in it".
 */
export function createOrnaments(scene: Scene): Map<OrnamentKind, Mesh> {
  const meshes = new Map<OrnamentKind, Mesh>();
  for (const kind of ORNAMENT_KINDS) {
    const role = ORNAMENTS[kind];
    const mesh = buildOrnament(scene, kind);
    if (mesh === null) continue;
    const material = new StandardMaterial(`gateOrnament-${kind}`, scene);
    const color = paletteColor(role);
    material.diffuseColor = color;
    // A quarter of its own colour back as emissive: an ornament is a small
    // shape on a bright road and needs to carry further than its size, but the
    // scene's ambient is already high — at half, every dressing clipped to
    // white and the four kinds stopped being four colours.
    material.emissiveColor = color.scale(0.25);
    material.specularColor = Color3.Black();
    mesh.material = material;
    mesh.isPickable = false;
    applyToonRamp(material);
    meshes.set(kind, mesh);
  }
  return meshes;
}

/**
 * The four dressings, each built about the arch's own origin: x across the
 * opening, y from the road, z along it. They are merged into one mesh per kind
 * so a kind costs one instance per gate.
 */
function buildOrnament(scene: Scene, kind: OrnamentKind): Mesh | null {
  const parts: Mesh[] = [];
  // Where the ring runs, so every dressing can sit on the arch rather than
  // float beside it: one point per voussoir, plus its outward direction.
  const onRing = (i: number, count: number): { x: number; y: number; angle: number } => {
    const angle = (Math.PI * (i + 0.5)) / count;
    return {
      x: Math.cos(angle) * (ARCH_RING_RADIUS + ARCH_RING_THICKNESS / 2),
      y: ARCH_SPRING_Y + Math.sin(angle) * (ARCH_RING_RADIUS + ARCH_RING_THICKNESS / 2),
      angle,
    };
  };
  const legX = ARCH_CLEAR_WIDTH / 2 + ARCH_LEG_THICKNESS / 2;

  switch (kind) {
    case 'add': {
      // Vines: leaves climbing both legs and then following the ring over.
      for (let i = 0; i < 4; i++) {
        const t = i / 3;
        const side = i % 2 === 0 ? -1 : 1;
        const leaf = CreateSphere(`vine-${String(i)}`, { diameter: ORNAMENT_SIZE, segments: 4 }, scene);
        leaf.scaling.set(1.5, 0.5, 1.1);
        leaf.position.set(side * (legX + ARCH_LEG_THICKNESS * 0.4), 0.3 + t * ARCH_SPRING_Y * 0.8, -0.1);
        leaf.rotation.z = side * 0.5;
        parts.push(leaf);
      }
      for (let i = 0; i < 6; i++) {
        const { x, y, angle } = onRing(i, 6);
        const leaf = CreateSphere(`vineRing-${String(i)}`, { diameter: ORNAMENT_SIZE, segments: 4 }, scene);
        leaf.scaling.set(1.4, 0.5, 1.1);
        leaf.rotation.z = angle;
        leaf.position.set(x, y, -0.06);
        parts.push(leaf);
      }
      break;
    }
    case 'sub': {
      // Thorns: spikes standing out of the ring, radially, like a crown of them.
      for (let i = 0; i < 7; i++) {
        const { x, y, angle } = onRing(i, 7);
        const spike = CreateCylinder(
          `thorn-${String(i)}`,
          {
            diameterTop: 0,
            diameterBottom: ORNAMENT_SIZE * 0.8,
            height: ORNAMENT_SIZE * 2.2,
            tessellation: 5,
          },
          scene,
        );
        // The cylinder points up its own y, so rolling it by the ring angle
        // less a quarter turn points it straight out of the curve.
        spike.rotation.z = angle - Math.PI / 2;
        spike.position.set(
          x + Math.cos(angle) * ORNAMENT_SIZE,
          y + Math.sin(angle) * ORNAMENT_SIZE,
          0,
        );
        parts.push(spike);
      }
      break;
    }
    case 'mul': {
      // A crown: points standing on the parapet, tallest in the middle.
      for (let i = 0; i < 5; i++) {
        const from = Math.abs(i - 2) / 2;
        const height = ORNAMENT_SIZE * (3 - from * 1.4);
        const point = CreateCylinder(
          `crown-${String(i)}`,
          { diameterTop: 0, diameterBottom: ORNAMENT_SIZE * 0.95, height, tessellation: 4 },
          scene,
        );
        point.position.set((i - 2) * ORNAMENT_SIZE * 2.1, ARCH_HEIGHT + height / 2, 0);
        parts.push(point);
      }
      break;
    }
    case 'fireRate': {
      // Crystals: shards growing out of both legs and the keystone.
      const places: [number, number, number][] = [
        [-legX, ARCH_SPRING_Y * 0.7, -0.18],
        [legX, ARCH_SPRING_Y * 0.45, -0.18],
        [0, ARCH_APEX + ARCH_RING_THICKNESS * 0.5 + ORNAMENT_SIZE, 0],
        [-legX, ARCH_SPRING_Y * 0.25, -0.18],
      ];
      places.forEach((place, i) => {
        const shard = CreatePolyhedron(
          `crystal-${String(i)}`,
          { type: 0, size: ORNAMENT_SIZE * (i === 2 ? 1.3 : 0.95) },
          scene,
        );
        shard.scaling.set(0.7, 1.9, 0.7);
        shard.rotation.z = (i - 1.5) * 0.24;
        shard.position.set(place[0], place[1], place[2]);
        parts.push(shard);
      });
      break;
    }
  }

  if (parts.length === 0) return null;
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (merged === null) return null;
  merged.name = `gateOrnament-${kind}`;
  return merged;
}
