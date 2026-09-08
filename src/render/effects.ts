/**
 * Spell effects: muzzle flashes, per-weapon impacts, the ember splash ring and
 * the storm chain.
 *
 * Everything here is a pooled thin instance of a small emissive mesh rather
 * than a particle system. A `ParticleSystem` is a draw call each and the plan
 * gives the whole frame forty (docs/06-milestone-2-plan.md, "Performance"), so
 * particles are saved for the two moments that happen once — the boss's death
 * and the level clear — and the effects that fire hundreds of times a run are
 * built from geometry that batches.
 *
 * Nothing fades by alpha: a thin instance has no per-instance colour, so an
 * effect dies by shrinking to nothing instead. Additive blending on a dark
 * scene makes that read as burning out rather than falling away.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import {
  commitInstances,
  createMatrixBuffer,
  writeInstance,
  writeRotatedInstance,
} from './instanceBuffer';
import { RingPool } from './rings';
import {
  CHAIN_DURATION,
  EMBER_COLOR,
  FROST_COLOR,
  IMPACT_DURATION,
  MUZZLE_DURATION,
  POOL,
  SPLASH_DURATION,
  STORM_COLOR,
} from './theme';
import { startWeapon, weaponIds } from '@/sim';
import type { WeaponId } from '@/sim';

const IMPACT_Y = 0.7;
const MUZZLE_Y = 0.72;
const CHAIN_Y = 0.8;

interface Burst {
  x: number;
  z: number;
  yaw: number;
  age: number;
}

interface Splash {
  x: number;
  z: number;
  radius: number;
  age: number;
}

interface Chain {
  x: number;
  z: number;
  yaw: number;
  length: number;
  age: number;
}

interface ImpactSet {
  mesh: Mesh;
  matrices: Float32Array;
  /** How big the burst grows, in metres. */
  size: number;
}

export class EffectsView {
  private readonly impacts = new Map<WeaponId, ImpactSet>();
  private readonly bursts: Burst[] = [];
  private burstCount = 0;

  private readonly muzzleMesh: Mesh;
  private readonly muzzleMaterial: StandardMaterial;
  private readonly muzzleMatrices: Float32Array;
  private readonly muzzles: Burst[] = [];
  private muzzleCount = 0;

  private readonly chainMesh: Mesh;
  private readonly chainMatrices: Float32Array;
  private readonly chains: Chain[] = [];
  private chainCount = 0;

  private readonly splashRings: RingPool;
  private readonly splashes: Splash[] = [];
  private splashCount = 0;

  private active: WeaponId = startWeapon;

  constructor(scene: Scene) {
    for (const id of weaponIds) {
      const set = buildImpact(scene, id);
      set.mesh.setEnabled(false);
      this.impacts.set(id, set);
    }
    for (let i = 0; i < POOL.impacts; i++) this.bursts.push({ x: 0, z: 0, yaw: 0, age: 0 });

    this.muzzleMaterial = unlit(scene, 'muzzleMat', tintOf(this.active));
    this.muzzleMesh = CreateSphere('muzzle', { diameter: 0.2, segments: 4 }, scene);
    this.muzzleMesh.material = this.muzzleMaterial;
    this.muzzleMatrices = createMatrixBuffer(this.muzzleMesh, POOL.impacts);
    for (let i = 0; i < POOL.impacts; i++) this.muzzles.push({ x: 0, z: 0, yaw: 0, age: 0 });

    // A unit-length bar along +z, stretched between the two blocks it links.
    this.chainMesh = CreateBox('chain', { width: 0.09, height: 0.09, depth: 1 }, scene);
    this.chainMesh.material = unlit(scene, 'chainMat', STORM_COLOR);
    this.chainMatrices = createMatrixBuffer(this.chainMesh, POOL.chains);
    for (let i = 0; i < POOL.chains; i++) {
      this.chains.push({ x: 0, z: 0, yaw: 0, length: 1, age: 0 });
    }

    this.splashRings = new RingPool(scene, 'splash', EMBER_COLOR, POOL.splashes, {
      thickness: 0.12,
      alpha: 0.9,
      additive: true,
      y: 0.5,
    });
    for (let i = 0; i < POOL.splashes; i++) {
      this.splashes.push({ x: 0, z: 0, radius: 1, age: 0 });
    }
  }

  /** The staff decides which impact mesh is drawn and what colour a shot is. */
  setWeapon(weaponId: WeaponId): void {
    if (weaponId === this.active) return;
    this.impacts.get(this.active)?.mesh.setEnabled(false);
    this.active = weaponId;
    this.muzzleMaterial.emissiveColor.copyFrom(tintOf(weaponId));
  }

  /** Every spell effect blooms; nothing else in the scene does. */
  glowMeshes(): Mesh[] {
    const meshes: Mesh[] = [this.muzzleMesh, this.chainMesh, this.splashRings.mesh];
    for (const set of this.impacts.values()) meshes.push(set.mesh);
    return meshes;
  }

  onMuzzle(x: number, z: number): void {
    if (this.muzzleCount >= POOL.impacts) return;
    const flash = this.muzzles[this.muzzleCount];
    if (flash === undefined) return;
    flash.x = x;
    flash.z = z;
    flash.yaw = 0;
    flash.age = 0;
    this.muzzleCount++;
  }

  onImpact(weaponId: WeaponId, x: number, z: number): void {
    this.setWeapon(weaponId);
    if (this.burstCount >= POOL.impacts) return;
    const burst = this.bursts[this.burstCount];
    if (burst === undefined) return;
    burst.x = x;
    burst.z = z;
    burst.yaw = (this.burstCount % 8) * 0.79;
    burst.age = 0;
    this.burstCount++;
  }

  onSplash(x: number, z: number, radius: number): void {
    if (this.splashCount >= POOL.splashes) return;
    const splash = this.splashes[this.splashCount];
    if (splash === undefined) return;
    splash.x = x;
    splash.z = z;
    splash.radius = radius;
    splash.age = 0;
    this.splashCount++;
  }

  onChain(fromX: number, fromZ: number, toX: number, toZ: number): void {
    if (this.chainCount >= POOL.chains) return;
    const chain = this.chains[this.chainCount];
    if (chain === undefined) return;
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    chain.length = Math.max(0.2, Math.hypot(dx, dz));
    chain.x = (fromX + toX) / 2;
    chain.z = (fromZ + toZ) / 2;
    chain.yaw = Math.atan2(dx, dz);
    chain.age = 0;
    this.chainCount++;
  }

  reset(): void {
    this.burstCount = 0;
    this.muzzleCount = 0;
    this.chainCount = 0;
    this.splashCount = 0;
    for (const set of this.impacts.values()) commitInstances(set.mesh, 0);
    commitInstances(this.muzzleMesh, 0);
    commitInstances(this.chainMesh, 0);
    this.splashRings.reset();
  }

  update(dt: number): void {
    this.updateBursts(dt);
    this.updateMuzzles(dt);
    this.updateChains(dt);
    this.updateSplashes(dt);
  }

  dispose(): void {
    for (const set of this.impacts.values()) {
      set.mesh.material?.dispose();
      set.mesh.dispose();
    }
    this.impacts.clear();
    this.muzzleMesh.material?.dispose();
    this.muzzleMesh.dispose();
    this.chainMesh.material?.dispose();
    this.chainMesh.dispose();
    this.splashRings.dispose();
  }

  private updateBursts(dt: number): void {
    const set = this.impacts.get(this.active);
    if (set === undefined) return;

    let write = 0;
    for (let i = 0; i < this.burstCount; i++) {
      const burst = this.bursts[i];
      if (burst === undefined) continue;
      burst.age += dt;
      if (burst.age >= IMPACT_DURATION) continue;

      // Out fast, then out of existence: `p` is the eased life, and the size
      // curve peaks at a third of it before collapsing.
      const p = burst.age / IMPACT_DURATION;
      const size = set.size * Math.sin(Math.min(1, p) * Math.PI) ** 0.6;
      writeRotatedInstance(set.matrices, write, size, size, size, burst.yaw, burst.x, IMPACT_Y, burst.z);

      const kept = this.bursts[write];
      if (kept !== undefined && write !== i) copyBurst(burst, kept);
      write++;
    }
    this.burstCount = write;
    commitInstances(set.mesh, write);
  }

  private updateMuzzles(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.muzzleCount; i++) {
      const flash = this.muzzles[i];
      if (flash === undefined) continue;
      flash.age += dt;
      if (flash.age >= MUZZLE_DURATION) continue;
      const size = 1 - flash.age / MUZZLE_DURATION;
      writeInstance(this.muzzleMatrices, write, size, size, size, flash.x, MUZZLE_Y, flash.z);
      const kept = this.muzzles[write];
      if (kept !== undefined && write !== i) copyBurst(flash, kept);
      write++;
    }
    this.muzzleCount = write;
    commitInstances(this.muzzleMesh, write);
  }

  private updateChains(dt: number): void {
    let write = 0;
    for (let i = 0; i < this.chainCount; i++) {
      const chain = this.chains[i];
      if (chain === undefined) continue;
      chain.age += dt;
      if (chain.age >= CHAIN_DURATION) continue;
      const thickness = 1 - chain.age / CHAIN_DURATION;
      writeRotatedInstance(
        this.chainMatrices,
        write,
        thickness,
        thickness,
        chain.length,
        chain.yaw,
        chain.x,
        CHAIN_Y,
        chain.z,
      );
      const kept = this.chains[write];
      if (kept !== undefined && write !== i) {
        kept.x = chain.x;
        kept.z = chain.z;
        kept.yaw = chain.yaw;
        kept.length = chain.length;
        kept.age = chain.age;
      }
      write++;
    }
    this.chainCount = write;
    commitInstances(this.chainMesh, write);
  }

  private updateSplashes(dt: number): void {
    this.splashRings.begin();
    let write = 0;
    for (let i = 0; i < this.splashCount; i++) {
      const splash = this.splashes[i];
      if (splash === undefined) continue;
      splash.age += dt;
      if (splash.age >= SPLASH_DURATION) continue;
      const p = splash.age / SPLASH_DURATION;
      this.splashRings.add(splash.x, splash.z, splash.radius * (0.3 + p * 0.9), 1 - p);
      const kept = this.splashes[write];
      if (kept !== undefined && write !== i) {
        kept.x = splash.x;
        kept.z = splash.z;
        kept.radius = splash.radius;
        kept.age = splash.age;
      }
      write++;
    }
    this.splashCount = write;
    this.splashRings.end();
  }
}

function copyBurst(from: Burst, to: Burst): void {
  to.x = from.x;
  to.z = from.z;
  to.yaw = from.yaw;
  to.age = from.age;
}

/**
 * One mesh per staff, built once: a round ember burst, a storm crackle of
 * crossed spikes, and a cluster of frost crystals.
 */
function buildImpact(scene: Scene, id: WeaponId): ImpactSet {
  const color = tintOf(id);
  let mesh: Mesh;
  let size: number;

  if (id === 'ember') {
    mesh = CreateSphere(`impact-${id}`, { diameter: 1, segments: 6 }, scene);
    size = 0.55;
  } else if (id === 'storm') {
    mesh = spikes(scene, `impact-${id}`, 3, 0.07, 1);
    size = 0.75;
  } else {
    mesh = spikes(scene, `impact-${id}`, 4, 0.16, 0.7);
    size = 0.6;
  }

  mesh.material = unlit(scene, `impactMat-${id}`, color);
  return { mesh, matrices: createMatrixBuffer(mesh, POOL.impacts), size };
}

/** `count` thin bars crossed through the origin: a spark burst, or a crystal. */
function spikes(scene: Scene, name: string, count: number, width: number, length: number): Mesh {
  const parts: Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const bar = CreateBox(`${name}-${String(i)}`, { width, height: width, depth: length }, scene);
    const yaw = (i / count) * Math.PI;
    const pitch = ((i % 2) - 0.5) * 0.9;
    bar.bakeTransformIntoVertices(Matrix.RotationYawPitchRoll(yaw, pitch, 0));
    parts.push(bar);
  }
  const merged = Mesh.MergeMeshes(parts, true, true);
  if (merged === null) throw new Error(`${name}: merge failed`);
  merged.name = name;
  return merged;
}

function tintOf(id: WeaponId): Color3 {
  return id === 'ember' ? EMBER_COLOR : id === 'storm' ? STORM_COLOR : FROST_COLOR;
}

function unlit(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  // Cloned: the muzzle recolours its own copy when the staff changes.
  material.emissiveColor = color.clone();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.alpha = 0.95;
  material.alphaMode = Constants.ALPHA_ADD;
  return material;
}
