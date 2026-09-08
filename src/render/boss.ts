/**
 * The boss and its stomp rings.
 *
 * One box, one big label and a small ring pool, all built at init. The boss is
 * the only thing in the scene the player is supposed to stare at, so it is
 * bigger, purple, and its number is twice the size of a block's.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';

import { hideLabel, linkLabel, scaleLabel, type LabelLayer } from './labels';
import {
  BOSS_COLOR,
  BOSS_DEATH_DURATION,
  BOSS_DEPTH,
  BOSS_GLOW,
  BOSS_HEIGHT,
  BOSS_LABEL_MIN,
  BOSS_LABEL_SIZE,
  BOSS_WIDTH,
  LABEL_RANGE,
  POOL,
  STOMP_COLOR,
  STOMP_DURATION,
  STOMP_MAX_RADIUS,
} from './theme';
import type { EnemyState } from '@/sim';

/** On the boss's face, like the block HP numbers. */
const LABEL_OFFSET_Y = 0;
/** Rings start as a tight shockwave under the boss and sweep outward. */
const RING_START_RADIUS = 0.8;

interface Ring {
  mesh: Mesh;
  material: StandardMaterial;
  age: number;
  active: boolean;
}

export class BossView {
  private readonly box: Mesh;
  private readonly material: StandardMaterial;
  private readonly label: TextBlock;
  private readonly rings: Ring[] = [];

  /** Seconds into the death animation, or -1 while alive. */
  private dying = -1;

  constructor(scene: Scene, labels: LabelLayer) {
    this.material = new StandardMaterial('bossMat', scene);
    this.material.diffuseColor = BOSS_COLOR;
    this.material.emissiveColor = BOSS_GLOW;
    this.material.specularColor = new Color3(0.3, 0.2, 0.4);

    this.box = CreateBox(
      'boss',
      { width: BOSS_WIDTH, height: BOSS_HEIGHT, depth: BOSS_DEPTH },
      scene,
    );
    this.box.material = this.material;
    this.box.isPickable = false;
    this.box.setEnabled(false);

    this.label = labels.create({ fontSize: BOSS_LABEL_SIZE, color: '#f2e2ff', outline: 8 });
    linkLabel(this.label, this.box, LABEL_OFFSET_Y);

    for (let i = 0; i < POOL.stompRings; i++) {
      const material = new StandardMaterial(`stompMat-${String(i)}`, scene);
      material.emissiveColor = STOMP_COLOR;
      material.diffuseColor = Color3.Black();
      material.specularColor = Color3.Black();
      material.disableLighting = true;
      material.alpha = 0;
      material.backFaceCulling = false;

      // A torus already lies flat in the xz plane, so a shockwave needs no
      // rotation — only a scale on x and z.
      const mesh = CreateTorus(
        `stomp-${String(i)}`,
        { diameter: 2, thickness: 0.28, tessellation: 32 },
        scene,
      );
      mesh.material = material;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      mesh.position.y = 0.12;

      this.rings.push({ mesh, material, age: 0, active: false });
    }
  }

  reset(): void {
    this.dying = -1;
    this.box.setEnabled(false);
    this.box.rotation.y = 0;
    this.box.scaling.setAll(1);
    hideLabel(this.label);
    for (const ring of this.rings) this.retire(ring);
  }

  onStomp(x: number, z: number): void {
    const ring = this.rings.find((candidate) => !candidate.active);
    if (ring === undefined) return;
    ring.active = true;
    ring.age = 0;
    ring.mesh.position.set(x, 0.12, z);
    ring.mesh.scaling.set(RING_START_RADIUS, 1, RING_START_RADIUS);
    ring.mesh.setEnabled(true);
  }

  onKilled(): void {
    if (this.dying >= 0 || !this.box.isEnabled()) return;
    this.dying = 0;
    hideLabel(this.label);
  }

  update(boss: EnemyState | null, squadZ: number, dt: number): void {
    this.updateRings(dt);

    if (this.dying >= 0) {
      this.advanceDeath(dt);
      return;
    }

    if (boss === null || !boss.alive) {
      if (this.box.isEnabled()) {
        this.box.setEnabled(false);
        hideLabel(this.label);
      }
      return;
    }

    this.box.setEnabled(true);
    this.box.scaling.setAll(1);
    this.box.position.set(boss.x, BOSS_HEIGHT / 2, boss.z);
    // An idle boss sways; an activated one squares up to the squad.
    this.box.rotation.y = boss.active ? 0 : Math.sin(boss.z * 0.05) * 0.15;

    const ahead = boss.z - squadZ;
    const readable = ahead < LABEL_RANGE;
    this.label.isVisible = readable;
    if (readable) {
      this.label.text = String(Math.max(0, Math.round(boss.hp)));
      scaleLabel(this.label, BOSS_LABEL_SIZE, BOSS_LABEL_MIN, ahead);
    }
  }

  dispose(): void {
    this.box.dispose();
    for (const ring of this.rings) ring.mesh.dispose();
    this.rings.length = 0;
  }

  private advanceDeath(dt: number): void {
    this.dying += dt;
    const p = Math.min(1, this.dying / BOSS_DEATH_DURATION);
    if (p >= 1) {
      this.box.setEnabled(false);
      this.box.scaling.setAll(1);
      this.dying = -1;
      return;
    }
    const shrink = 1 - p;
    this.box.scaling.setAll(shrink);
    this.box.position.y = (BOSS_HEIGHT / 2) * shrink;
    this.box.rotation.y += dt * 10;
  }

  private updateRings(dt: number): void {
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += dt;
      const p = ring.age / STOMP_DURATION;
      if (p >= 1) {
        this.retire(ring);
        continue;
      }
      const radius = RING_START_RADIUS + (STOMP_MAX_RADIUS - RING_START_RADIUS) * p;
      ring.mesh.scaling.set(radius, 1, radius);
      ring.material.alpha = 0.9 * (1 - p);
    }
  }

  private retire(ring: Ring): void {
    ring.active = false;
    ring.age = 0;
    ring.material.alpha = 0;
    ring.mesh.setEnabled(false);
  }
}
