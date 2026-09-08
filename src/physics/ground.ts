/**
 * The road, as far as debris is concerned: one static slab under it and two
 * invisible walls down its sides.
 *
 * The walls exist because a corpse thrown sideways off a 6 m road never comes
 * back, and a body falling forever is a body the pool cannot recycle on a
 * sensible schedule. They are as tall as a stomp can throw anything.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import type { Scene } from '@babylonjs/core/scene';

import { balance } from '@/data';
import {
  GROUND_FRICTION,
  GROUND_MARGIN,
  GROUND_RESTITUTION,
  GROUND_THICKNESS,
  WALL_HEIGHT,
} from './tuning';

export class GroundCollider {
  private readonly meshes: Mesh[] = [];
  private readonly aggregates: PhysicsAggregate[] = [];

  constructor(scene: Scene, startZ: number, endZ: number) {
    const halfWidth = balance.road.halfWidth + GROUND_MARGIN;
    const length = Math.max(1, endZ - startZ);
    const middle = (startZ + endZ) / 2;

    this.add(
      scene,
      'physics_ground',
      halfWidth * 2,
      GROUND_THICKNESS,
      length,
      0,
      -GROUND_THICKNESS / 2,
      middle,
    );
    for (const side of [-1, 1]) {
      this.add(
        scene,
        `physics_wall_${side < 0 ? 'left' : 'right'}`,
        0.4,
        WALL_HEIGHT,
        length,
        side * (halfWidth + 0.2),
        WALL_HEIGHT / 2,
        middle,
      );
    }
  }

  dispose(): void {
    for (const aggregate of this.aggregates) aggregate.dispose();
    for (const mesh of this.meshes) mesh.dispose(false, true);
    this.aggregates.length = 0;
    this.meshes.length = 0;
  }

  private add(
    scene: Scene,
    name: string,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
  ): void {
    const mesh = CreateBox(name, { width, height, depth }, scene);
    mesh.position.set(x, y, z);
    mesh.isVisible = false;
    mesh.isPickable = false;
    this.meshes.push(mesh);
    this.aggregates.push(
      new PhysicsAggregate(
        mesh,
        PhysicsShapeType.BOX,
        {
          mass: 0,
          friction: GROUND_FRICTION,
          restitution: GROUND_RESTITUTION,
          extents: new Vector3(width, height, depth),
        },
        scene,
      ),
    );
  }
}
