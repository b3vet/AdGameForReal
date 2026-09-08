/**
 * The road. One pooled set of static meshes, re-stretched per level and then
 * frozen: the road never moves, so paying for a world-matrix recompute every
 * frame on the largest meshes in the scene would be pure waste.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import {
  ARENA_COLOR,
  FIELD_COLOR,
  LANE_LINE_COLOR,
  ROAD_COLOR,
  ROAD_HALF_WIDTH,
} from './theme';

/** Lane boundaries for a three-lane road: the two edges and the two splits. */
const LINE_X = [-ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH];
const LINE_WIDTH = 0.14;
/**
 * The field is only there to give the road an edge to read against. It is far
 * wider than the road so its own edges never come into frame, even in landscape.
 */
const FIELD_WIDTH = 240;

export class RoadView {
  private readonly surface: Mesh;
  private readonly field: Mesh;
  private readonly lines: Mesh[] = [];
  private readonly arenaBand: Mesh;
  private readonly arenaPosts: Mesh[] = [];

  constructor(scene: Scene) {
    const roadMaterial = matte(scene, 'roadMat', ROAD_COLOR);
    const fieldMaterial = matte(scene, 'fieldMat', FIELD_COLOR);
    const lineMaterial = glow(scene, 'laneLineMat', LANE_LINE_COLOR, 0.7);
    const arenaMaterial = glow(scene, 'arenaMat', ARENA_COLOR, 0.5);

    // Unit-length strips: `setExtent` scales them along z, so one build serves
    // every level length.
    this.field = CreateGround('field', { width: FIELD_WIDTH, height: 1 }, scene);
    this.field.material = fieldMaterial;
    this.field.position.y = -0.06;

    this.surface = CreateGround('road', { width: ROAD_HALF_WIDTH * 2, height: 1 }, scene);
    this.surface.material = roadMaterial;

    for (const x of LINE_X) {
      const line = CreateGround(`laneLine-${String(x)}`, { width: LINE_WIDTH, height: 1 }, scene);
      line.material = lineMaterial;
      line.position.x = x;
      line.position.y = 0.02;
      this.lines.push(line);
    }

    this.arenaBand = CreateGround('arenaBand', { width: ROAD_HALF_WIDTH * 2, height: 1 }, scene);
    this.arenaBand.material = arenaMaterial;
    this.arenaBand.position.y = 0.04;
    this.arenaBand.scaling.z = 0.9;

    for (const side of [-1, 1]) {
      const post = CreateBox(`arenaPost-${String(side)}`, { width: 0.3, height: 2.6, depth: 0.3 }, scene);
      post.material = arenaMaterial;
      post.position.x = side * (ROAD_HALF_WIDTH + 0.15);
      post.position.y = 1.3;
      this.arenaPosts.push(post);
    }

    for (const mesh of this.allMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
    }
  }

  /** Re-stretches the road for a level. Everything is frozen again afterwards. */
  setExtent(startZ: number, endZ: number, arenaZ: number): void {
    const length = Math.max(1, endZ - startZ);
    const centerZ = (startZ + endZ) / 2;

    for (const mesh of this.allMeshes()) mesh.unfreezeWorldMatrix();

    this.field.scaling.z = length;
    this.field.position.z = centerZ;

    this.surface.scaling.z = length;
    this.surface.position.z = centerZ;

    for (const line of this.lines) {
      line.scaling.z = length;
      line.position.z = centerZ;
    }

    this.arenaBand.position.z = arenaZ;
    for (const post of this.arenaPosts) post.position.z = arenaZ;

    for (const mesh of this.allMeshes()) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
      mesh.setEnabled(true);
    }
  }

  dispose(): void {
    for (const mesh of this.allMeshes()) mesh.dispose();
  }

  private allMeshes(): Mesh[] {
    return [this.field, this.surface, ...this.lines, this.arenaBand, ...this.arenaPosts];
  }
}

function matte(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  return material;
}

function glow(scene: Scene, name: string, color: Color3, strength: number): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.scale(0.3);
  material.emissiveColor = color.scale(strength);
  material.specularColor = Color3.Black();
  return material;
}
