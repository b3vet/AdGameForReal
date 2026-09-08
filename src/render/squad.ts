/**
 * The squad: one capsule mesh drawn as thin instances, one per unit, placed at
 * `formationOffsets(count)` around `(squad.x, squad.z)`.
 *
 * Count changes are read, not told: the view diffs `count` against the previous
 * frame. Because the phyllotaxis offset for index `i` does not depend on the
 * total, a unit keeps its place in the spiral as the squad grows, so growth
 * looks like recruits joining the edge rather than the whole blob reshuffling.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCapsule } from '@babylonjs/core/Meshes/Builders/capsuleBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import {
  DEATH_DURATION,
  POOL,
  POP_DURATION,
  SQUAD_BODY,
  SQUAD_DEATH,
  SQUAD_GLOW,
  SQUAD_HEIGHT,
  SQUAD_RADIUS,
} from './theme';
import { formationOffsets } from '@/sim';
import type { SquadState } from '@/sim';

/** Sentinel in `spawnAge`: this unit finished its pop and needs no animation. */
const SETTLED = 1e9;

interface Corpse {
  x: number;
  y: number;
  z: number;
  age: number;
}

export class SquadView {
  private readonly mesh: Mesh;
  private readonly corpseMesh: Mesh;
  private readonly matrices: Float32Array;
  private readonly corpseMatrices: Float32Array;

  /** Seconds since unit `i` appeared, or `SETTLED`. Indexed by formation slot. */
  private readonly spawnAge: Float32Array;

  /** Fixed-size ring of shrinking corpses; oldest is overwritten if it overflows. */
  private readonly corpses: Corpse[] = [];
  private corpseCount = 0;

  private previousCount = -1;

  constructor(scene: Scene) {
    const body = new StandardMaterial('squadMat', scene);
    body.diffuseColor = SQUAD_BODY;
    body.emissiveColor = SQUAD_GLOW;
    body.specularColor = new Color3(0.4, 0.45, 0.6);

    // A second mesh rather than a per-instance colour buffer: two draw calls is
    // cheaper than the shader permutation, and the dying units need a different
    // material anyway (unlit red so they read against the blue cluster).
    const dying = new StandardMaterial('squadDeathMat', scene);
    dying.diffuseColor = SQUAD_DEATH;
    dying.emissiveColor = SQUAD_DEATH.scale(0.8);
    dying.specularColor = Color3.Black();

    // Two separate builds rather than `clone`: a clone shares its geometry, and
    // `thinInstanceSetBuffer` writes the instance matrices into the geometry's
    // vertex buffers, so the second mesh would silently steal the first's.
    this.mesh = createUnitMesh(scene, 'squadUnit');
    this.mesh.material = body;

    this.corpseMesh = createUnitMesh(scene, 'squadCorpse');
    this.corpseMesh.material = dying;

    this.matrices = createMatrixBuffer(this.mesh, POOL.squad);
    this.corpseMatrices = createMatrixBuffer(this.corpseMesh, POOL.dyingUnits);

    this.spawnAge = new Float32Array(POOL.squad);
    for (let i = 0; i < POOL.dyingUnits; i++) this.corpses.push({ x: 0, y: 0, z: 0, age: 0 });
  }

  /** New level: the starting squad is simply there, with no pop animation. */
  reset(): void {
    this.previousCount = -1;
    this.corpseCount = 0;
    commitInstances(this.corpseMesh, 0);
  }

  update(squad: SquadState, dt: number): void {
    const count = Math.min(POOL.squad, Math.max(0, Math.floor(squad.count)));
    this.diffCount(count, squad.x, squad.z);

    const offsets = formationOffsets(count);
    const halfHeight = SQUAD_HEIGHT / 2;

    for (let i = 0; i < count; i++) {
      const offset = offsets[i];
      if (offset === undefined) continue;

      let scale = 1;
      const age = this.spawnAge[i] ?? SETTLED;
      if (age < POP_DURATION) {
        scale = popScale(age);
        this.spawnAge[i] = age + dt;
      } else if (age !== SETTLED) {
        this.spawnAge[i] = SETTLED;
      }

      writeInstance(
        this.matrices,
        i,
        scale,
        scale,
        scale,
        squad.x + offset.x,
        halfHeight * scale,
        squad.z + offset.z,
      );
    }
    commitInstances(this.mesh, count);

    this.updateCorpses(dt);
  }

  dispose(): void {
    this.mesh.dispose();
    this.corpseMesh.dispose();
  }

  private diffCount(count: number, x: number, z: number): void {
    const previous = this.previousCount;
    this.previousCount = count;

    if (previous < 0) {
      // First frame of a level: everyone is already standing.
      this.spawnAge.fill(SETTLED);
      return;
    }

    if (count > previous) {
      for (let i = previous; i < count; i++) this.spawnAge[i] = 0;
      return;
    }

    if (count < previous) {
      // Offsets for index `i` are the same at any total, so the outgoing units
      // die exactly where they were standing.
      const offsets = formationOffsets(previous);
      for (let i = count; i < previous; i++) {
        const offset = offsets[i];
        if (offset === undefined) continue;
        this.pushCorpse(x + offset.x, SQUAD_HEIGHT / 2, z + offset.z);
      }
    }
  }

  private pushCorpse(x: number, y: number, z: number): void {
    if (this.corpseCount >= POOL.dyingUnits) return;
    const corpse = this.corpses[this.corpseCount];
    if (corpse === undefined) return;
    corpse.x = x;
    corpse.y = y;
    corpse.z = z;
    corpse.age = 0;
    this.corpseCount++;
  }

  /** Compacts the live corpses to the front of the buffer as they expire. */
  private updateCorpses(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.corpseCount; i++) {
      const corpse = this.corpses[i];
      if (corpse === undefined) continue;
      corpse.age += dt;
      if (corpse.age >= DEATH_DURATION) continue;

      const scale = 1 - corpse.age / DEATH_DURATION;
      writeInstance(
        this.corpseMatrices,
        write,
        scale * 1.3,
        scale,
        scale * 1.3,
        corpse.x,
        corpse.y * scale,
        corpse.z,
      );

      const kept = this.corpses[write];
      if (kept !== undefined && write !== i) {
        kept.x = corpse.x;
        kept.y = corpse.y;
        kept.z = corpse.z;
        kept.age = corpse.age;
      }
      write++;
    }
    this.corpseCount = write;
    commitInstances(this.corpseMesh, write);
  }
}

function createUnitMesh(scene: Scene, name: string): Mesh {
  return CreateCapsule(
    name,
    { radius: SQUAD_RADIUS, height: SQUAD_HEIGHT, tessellation: 10, capSubdivisions: 3 },
    scene,
  );
}

/** Ease-out-back: overshoots past 1 then settles, which reads as a pop. */
function popScale(age: number): number {
  const p = Math.min(1, age / POP_DURATION) - 1;
  const overshoot = 1.7;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}
