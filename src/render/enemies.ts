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
  BLOCK_LABEL_CLEARANCE_BEHIND,
  BLOCK_LABEL_CLEARANCE_FRONT,
  BLOCK_LABEL_LANE_CLEARANCE,
  CAMERA,
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
import { enemyFootprint, laneCenter } from '@/sim';
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
    // Where the camera sits this frame, which is what turns metres of road into
    // pixels for `gateCrowdsLabel`. Hoisted out of the loop: one rig serves
    // every block on screen.
    const pullback = Math.min(CAMERA.pullbackMax, state.squad.count * CAMERA.pullbackPerUnit);
    const eye = squadZ - CAMERA.behind - pullback;

    for (const enemy of state.enemies) {
      if (enemy.kind === 'boss') continue;
      const slot = this.bind(enemy);
      if (slot === undefined || slot.dying >= 0) continue;
      slot.seen = this.frame;
      this.paintAlive(slot, enemy, state.gates, squadZ, eye, dt);
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
    gates: readonly GateState[],
    squadZ: number,
    eye: number,
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
      ahead < LABEL_RANGE && ahead > -LABEL_BEHIND && !gateCrowdsLabel(gates, enemy, eye);
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
 * True when an unpassed gate stands close enough to this block, in its own lane,
 * for the two to print on the same patch of screen. The gate's number wins,
 * because that is the choice the player is about to make.
 *
 * The window is measured from the camera (`eye`), not from the squad: at 11 m
 * row spacing a block guarding the next row stands about five metres beyond the
 * row in front of it, and those five metres are a readable gap at the nearest
 * row and a stack of digits two rows out. So a block loses its number while the
 * row in front of it is still a decision, and gets it back once that row is
 * behind the squad — which is also when its HP is what the player is reading.
 */
function gateCrowdsLabel(gates: readonly GateState[], enemy: EnemyState, eye: number): boolean {
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === undefined || gate.passed) continue;
    if (Math.abs(laneCenter(gate.lane) - enemy.x) > BLOCK_LABEL_LANE_CLEARANCE) continue;

    const gap = enemy.z - gate.z;
    const share = gap >= 0 ? BLOCK_LABEL_CLEARANCE_BEHIND : BLOCK_LABEL_CLEARANCE_FRONT;
    if (Math.abs(gap) < (gate.z - eye) * share) return true;
  }
  return false;
}
