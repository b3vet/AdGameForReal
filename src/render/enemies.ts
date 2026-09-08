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
import { balance } from '@/data';
import { enemyFootprint } from '@/sim';
import type { EnemyState, GateState, RunState } from '@/sim';

/** A block gets taller with the units it is worth, on top of getting wider. */
const HEIGHT_BASE = 0.8;
const HEIGHT_PER_UNIT = 0.1;
const HEIGHT_MAX = 2.4;

/**
 * The HP number is printed on the block's face, the way the reference ad games
 * do it. Floating it above collides with the gate labels behind it.
 */
const LABEL_OFFSET_Y = 0;

/**
 * A block this close in front of an unpassed gate loses its label: the two
 * numbers would print on top of each other and the gate's is the one the player
 * is deciding about. The generator keeps mixed rows further apart than this
 * (`gen.mixedEnemyOffset`); this is the guard for every other arrangement.
 */
const GATE_LABEL_CLEARANCE = 3;

/** Flash target. A module constant so the hit flash allocates nothing. */
const WHITE = Color3.White();

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
  /** Last hp printed, so the label is only re-set when the number changes. */
  shownHp: number;
  /** Last font size applied; see `scaleLabel`. */
  shownSize: number;
}

export class EnemyView {
  private readonly slots: EnemySlot[] = [];
  private readonly byEnemyId = new Map<number, EnemySlot>();
  private frame = 0;

  constructor(scene: Scene, labels: LabelLayer) {
    for (let i = 0; i < POOL.enemies; i++) {
      const material = new StandardMaterial(`enemyMat-${String(i)}`, scene);
      // Clones, not the shared theme colours: the hit flash writes into these
      // in place every frame rather than allocating a new Color3.
      material.diffuseColor = ENEMY_COLOR.clone();
      material.emissiveColor = ENEMY_GLOW.clone();
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
        shownHp: Number.NaN,
        shownSize: Number.NaN,
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
      this.paintAlive(slot, enemy, state, squadZ, dt);
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

    const slot = this.freeSlot();
    if (slot === undefined) return undefined;

    slot.enemyId = enemy.id;
    slot.flash = 0;
    slot.dying = -1;
    slot.shownHp = Number.NaN;
    slot.shownSize = Number.NaN;
    slot.box.rotation.y = 0;
    slot.box.setEnabled(true);
    slot.material.emissiveColor.copyFrom(ENEMY_GLOW);

    this.byEnemyId.set(enemy.id, slot);
    return slot;
  }

  /** First unbound slot. An index loop, not `find`: this runs per block per
   *  frame and a closure per call is an allocation in the steady-state path. */
  private freeSlot(): EnemySlot | undefined {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot !== undefined && slot.enemyId < 0) return slot;
    }
    return undefined;
  }

  private paintAlive(
    slot: EnemySlot,
    enemy: EnemyState,
    state: RunState,
    squadZ: number,
    dt: number,
  ): void {
    const units = Math.max(1, enemy.units);
    const root = Math.sqrt(units);
    // The box is drawn exactly as wide as the sim's own footprint for the block
    // (`enemyFootprint` is a half-width), because the player judges "will that
    // thing hit me?" off the box. Render used to carry its own width curve,
    // which had drifted to about half the collision width: blocks that visibly
    // missed the squad ate it anyway.
    slot.width = enemyFootprint(enemy.kind, units, balance) * 2;
    slot.height = Math.min(HEIGHT_MAX, HEIGHT_BASE + HEIGHT_PER_UNIT * root);

    slot.box.scaling.set(slot.width, slot.height, slot.width);
    slot.box.position.set(enemy.x, slot.height / 2, enemy.z);

    if (slot.flash > 0) {
      slot.flash = Math.max(0, slot.flash - dt);
      const hot = slot.flash / ENEMY_HIT_FLASH;
      Color3.LerpToRef(ENEMY_GLOW, WHITE, hot, slot.material.emissiveColor);
    }

    const ahead = enemy.z - squadZ;
    const readable =
      ahead < LABEL_RANGE && ahead > -LABEL_BEHIND && !gateInFront(state.gates, enemy.z);
    slot.label.isVisible = readable;
    if (readable) {
      const hp = Math.max(0, Math.round(enemy.hp));
      if (hp !== slot.shownHp) {
        slot.shownHp = hp;
        slot.label.text = String(hp);
      }
      slot.shownSize = scaleLabel(
        slot.label,
        ENEMY_LABEL_SIZE,
        ENEMY_LABEL_MIN,
        ahead,
        slot.shownSize,
      );
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
    Color3.LerpToRef(WHITE, ENEMY_GLOW, p, slot.material.emissiveColor);
  }

  private release(slot: EnemySlot): void {
    if (slot.enemyId >= 0) this.byEnemyId.delete(slot.enemyId);
    slot.enemyId = -1;
    slot.flash = 0;
    slot.dying = -1;
    slot.shownHp = Number.NaN;
    slot.shownSize = Number.NaN;
    slot.box.setEnabled(false);
    slot.box.rotation.y = 0;
    hideLabel(slot.label);
  }
}

/**
 * True when an unpassed gate stands just in front of `z`. Both labels would land
 * on the same patch of screen; the gate's number wins, because that is the
 * choice the player is about to make.
 */
function gateInFront(gates: readonly GateState[], z: number): boolean {
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === undefined || gate.passed) continue;
    const ahead = gate.z - z;
    if (ahead >= 0 && ahead <= GATE_LABEL_CLEARANCE) return true;
  }
  return false;
}
