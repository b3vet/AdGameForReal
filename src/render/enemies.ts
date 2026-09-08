/**
 * Enemy blocks: one red box per live block, sized by the units it is worth, with
 * its remaining HP printed above it.
 *
 * Like gates, slots are bound by enemy id on first sight and released when the
 * death animation ends — the sim drops a killed block from `RunState`
 * immediately, so the corpse has to outlive the state that produced it.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';

import { hideLabel, linkLabel, scaleLabel, type LabelLayer } from './labels';
import {
  ENEMY_COLOR,
  ENEMY_DEATH_DURATION,
  ENEMY_GLOW,
  ENEMY_HIT_FLASH,
  ENEMY_LABEL_MIN,
  ENEMY_LABEL_SIZE,
  LABEL_BEHIND,
  LABEL_RANGE,
  POOL,
} from './theme';
import type { EnemyState, RunState } from '@/sim';

/** Block footprint: `0.9 + 0.12*sqrt(units)`, capped so it never spans the road. */
const WIDTH_BASE = 0.9;
const WIDTH_PER_UNIT = 0.12;
const WIDTH_MAX = 2.4;
const HEIGHT_BASE = 0.8;
const HEIGHT_PER_UNIT = 0.1;
const HEIGHT_MAX = 2.4;

/**
 * The HP number is printed on the block's face, the way the reference ad games
 * do it. Floating it above collides with the gate labels behind it.
 */
const LABEL_OFFSET_Y = 0;

interface EnemySlot {
  box: Mesh;
  material: StandardMaterial;
  label: TextBlock;
  enemyId: number;
  flash: number;
  /** Seconds into the death animation, or -1 while alive. */
  dying: number;
  width: number;
  height: number;
  seen: number;
}

export class EnemyView {
  private readonly slots: EnemySlot[] = [];
  private readonly byEnemyId = new Map<number, EnemySlot>();
  private frame = 0;

  constructor(scene: Scene, labels: LabelLayer) {
    for (let i = 0; i < POOL.enemies; i++) {
      const material = new StandardMaterial(`enemyMat-${String(i)}`, scene);
      material.diffuseColor = ENEMY_COLOR;
      material.emissiveColor = ENEMY_GLOW;
      material.specularColor = Color3.Black();

      const box = CreateBox(`enemy-${String(i)}`, { size: 1 }, scene);
      box.material = material;
      box.isPickable = false;
      box.setEnabled(false);

      const label = labels.create({ fontSize: ENEMY_LABEL_SIZE, color: '#ffe9e6', outline: 6 });
      linkLabel(label, box, LABEL_OFFSET_Y);

      this.slots.push({
        box,
        material,
        label,
        enemyId: -1,
        flash: 0,
        dying: -1,
        width: 1,
        height: 1,
        seen: 0,
      });
    }
  }

  reset(): void {
    this.byEnemyId.clear();
    for (const slot of this.slots) this.release(slot);
  }

  onHit(enemyId: number): void {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined || slot.dying >= 0) return;
    slot.flash = ENEMY_HIT_FLASH;
  }

  onKilled(enemyId: number): void {
    const slot = this.byEnemyId.get(enemyId);
    if (slot === undefined || slot.dying >= 0) return;
    slot.dying = 0;
    slot.flash = 0;
    hideLabel(slot.label);
  }

  update(state: RunState, dt: number): void {
    this.frame++;
    const squadZ = state.squad.z;

    for (const enemy of state.enemies) {
      if (enemy.kind === 'boss') continue;
      const slot = this.bind(enemy);
      if (slot === undefined || slot.dying >= 0) continue;
      slot.seen = this.frame;
      this.paintAlive(slot, enemy, squadZ, dt);
    }

    for (const slot of this.slots) {
      if (slot.enemyId < 0) continue;
      if (slot.dying >= 0) {
        this.advanceDeath(slot, dt);
      } else if (slot.seen !== this.frame) {
        // Walked off the back of the level rather than dying: no animation.
        this.release(slot);
      }
    }
  }

  dispose(): void {
    for (const slot of this.slots) slot.box.dispose();
    this.slots.length = 0;
    this.byEnemyId.clear();
  }

  private bind(enemy: EnemyState): EnemySlot | undefined {
    const existing = this.byEnemyId.get(enemy.id);
    if (existing !== undefined) return existing;
    if (!enemy.alive) return undefined;

    const slot = this.slots.find((candidate) => candidate.enemyId < 0);
    if (slot === undefined) return undefined;

    slot.enemyId = enemy.id;
    slot.flash = 0;
    slot.dying = -1;
    slot.box.rotation.y = 0;
    slot.box.setEnabled(true);
    slot.material.emissiveColor = ENEMY_GLOW;

    this.byEnemyId.set(enemy.id, slot);
    return slot;
  }

  private paintAlive(slot: EnemySlot, enemy: EnemyState, squadZ: number, dt: number): void {
    const units = Math.max(1, enemy.units);
    const root = Math.sqrt(units);
    slot.width = Math.min(WIDTH_MAX, WIDTH_BASE + WIDTH_PER_UNIT * root);
    slot.height = Math.min(HEIGHT_MAX, HEIGHT_BASE + HEIGHT_PER_UNIT * root);

    slot.box.scaling.set(slot.width, slot.height, slot.width);
    slot.box.position.set(enemy.x, slot.height / 2, enemy.z);

    if (slot.flash > 0) {
      slot.flash = Math.max(0, slot.flash - dt);
      const hot = slot.flash / ENEMY_HIT_FLASH;
      slot.material.emissiveColor = Color3.Lerp(ENEMY_GLOW, Color3.White(), hot);
    }

    const ahead = enemy.z - squadZ;
    const readable = ahead < LABEL_RANGE && ahead > -LABEL_BEHIND;
    slot.label.isVisible = readable;
    if (readable) {
      slot.label.text = String(Math.max(0, Math.round(enemy.hp)));
      scaleLabel(slot.label, ENEMY_LABEL_SIZE, ENEMY_LABEL_MIN, ahead);
    }
  }

  private advanceDeath(slot: EnemySlot, dt: number): void {
    slot.dying += dt;
    const p = Math.min(1, slot.dying / ENEMY_DEATH_DURATION);
    if (p >= 1) {
      this.release(slot);
      return;
    }

    const shrink = 1 - p;
    slot.box.scaling.set(slot.width * shrink, slot.height * shrink, slot.width * shrink);
    slot.box.position.y = (slot.height / 2) * shrink;
    slot.box.rotation.y += dt * 14;
    slot.material.emissiveColor = Color3.Lerp(Color3.White(), ENEMY_GLOW, p);
  }

  private release(slot: EnemySlot): void {
    if (slot.enemyId >= 0) this.byEnemyId.delete(slot.enemyId);
    slot.enemyId = -1;
    slot.flash = 0;
    slot.dying = -1;
    slot.box.setEnabled(false);
    slot.box.rotation.y = 0;
    hideLabel(slot.label);
  }
}
