/**
 * The two boss models, and everything about playing clips on one of them.
 *
 * Split out of `./boss.ts` when D49 made the arena hold two bosses: that file
 * is the fight — the priority list over stomps, hits and deaths, the shockwave
 * rings and the number over the head — and this is the rig underneath it.
 *
 * **Both models are loaded at boot**, and that is the point rather than an
 * oversight. A material compiled on the frame it is first drawn is a stall
 * exactly where the player is watching (`./warmup.ts`), and the Rime Fiend
 * first draws on the frame the squad walks into the arena. One of the two is
 * enabled at a time, so the second costs a parse and its textures and no draw
 * call at all.
 *
 * The demon's path through here is the one it had: same lift, same ramp, same
 * scale rule, same blending. The Fiend is the same code with one more clip in
 * the manifest (`charge`, which is the Yeti's run).
 */

import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { liftEmissive, loadAnimatedModel, type AnimatedModel } from './models';
import {
  BOSS_COLOR,
  BOSS_DEPTH,
  BOSS_ENRAGE_COLOR,
  BOSS_ENRAGE_PULSE,
  BOSS_HEIGHT,
  BOSS_MODEL_HEIGHT,
  BOSS_TURN_RATE,
  BOSS_WIDTH,
} from './theme';
import { applyToonRampToAll } from './toonRamp';
import type { BossKind } from '@/sim';

/** Which way a model faces before it is turned to look down the road. */
export const FACING = Math.PI;
/** And the other way: the walk home after a charge (D49). */
export const FACING_HOME = 0;

/** The manifest id each boss is loaded from. */
const MODEL_IDS: Readonly<Record<BossKind, string>> = {
  demon: 'boss_demon',
  rime: 'boss_rime',
};

/** The demon is the darkest thing in the pack, so it keeps a little more lift
 *  than the crowds — but only a little: the enrage pulse has to read on top of
 *  it, and under daylight the ambient already carries the body. */
const BOSS_LIFT = 0.08;
/**
 * The stand-in box's calm emissive, built once. `paintEnrage` runs on every
 * frame of the boss fight, and `Color3.scale` allocates.
 */
const BOSS_FALLBACK_EMISSIVE = BOSS_COLOR.scale(0.25);

/** One loaded boss: the model and the scale that brings it to `BOSS_HEIGHT`. */
interface Rig {
  model: AnimatedModel;
  scale: number;
}

export class BossRig {
  private readonly fallback: Mesh;
  private readonly fallbackMaterial: StandardMaterial;
  private readonly rigs = new Map<BossKind, Rig>();

  private variant: BossKind = 'demon';
  private enragePhase = 0;
  /** Where the body is turned to, and where it is turning to. */
  private yaw = FACING;
  private wantedYaw = FACING;

  constructor(scene: Scene) {
    // Stands in for the boss when the model cannot be loaded, so a build
    // without assets still has something to shoot at.
    this.fallbackMaterial = new StandardMaterial('bossFallbackMat', scene);
    this.fallbackMaterial.diffuseColor = BOSS_COLOR;
    this.fallbackMaterial.emissiveColor = BOSS_FALLBACK_EMISSIVE.clone();
    this.fallbackMaterial.specularColor = Color3.Black();
    this.fallback = CreateBox(
      'boss-fallback',
      { width: BOSS_WIDTH, height: BOSS_HEIGHT, depth: BOSS_DEPTH },
      scene,
    );
    this.fallback.material = this.fallbackMaterial;
    this.fallback.isPickable = false;
    this.fallback.setEnabled(false);
  }

  /** Both bosses, in parallel. A model that fails to load simply has no rig. */
  async load(scene: Scene): Promise<void> {
    const kinds: readonly BossKind[] = ['demon', 'rime'];
    const loaded = await Promise.all(
      kinds.map(async (kind) => loadAnimatedModel(scene, MODEL_IDS[kind])),
    );
    for (const [i, model] of loaded.entries()) {
      const kind = kinds[i];
      if (kind === undefined || model === null) continue;
      for (const material of model.materials) liftEmissive(material, BOSS_LIFT);
      applyToonRampToAll(model.materials);
      // The manifest's own scale is a starting point; the plan wants three metres.
      const scale = BOSS_HEIGHT / (model.height > 0 ? model.height : BOSS_MODEL_HEIGHT);
      model.pivot.scaling.setAll(scale);
      model.pivot.rotation.y = FACING;
      model.setEnabled(false);
      this.rigs.set(kind, { model, scale });
    }
  }

  /** Which boss the arena holds. Switching hides the other one's body. */
  setVariant(kind: BossKind): void {
    if (kind === this.variant) return;
    this.rigs.get(this.variant)?.model.setEnabled(false);
    this.variant = kind;
    this.enragePhase = 0;
    this.yaw = FACING;
    this.wantedYaw = FACING;
    const rig = this.rigs.get(kind);
    if (rig !== undefined) rig.model.pivot.rotation.y = FACING;
  }

  get kind(): BossKind {
    return this.variant;
  }

  /** True when a real model answered; false while the box is standing in. */
  get loaded(): boolean {
    return this.rigs.has(this.variant);
  }

  /** Whether the model in the arena carries this clip at all. */
  has(id: string): boolean {
    return this.rigs.get(this.variant)?.model.groups.has(id) ?? false;
  }

  place(x: number, y: number, z: number): void {
    const rig = this.rigs.get(this.variant);
    if (rig !== undefined) {
      rig.model.pivot.position.set(x, y, z);
      return;
    }
    this.fallback.position.set(x, y + BOSS_HEIGHT / 2, z);
  }

  show(enabled: boolean): void {
    const rig = this.rigs.get(this.variant);
    if (rig !== undefined) rig.model.setEnabled(enabled);
    else this.fallback.setEnabled(enabled);
  }

  /**
   * Turns the body toward `yaw` at `BOSS_TURN_RATE`.
   *
   * The Rime Fiend walks home after a charge (D49), and a three-metre body
   * walking backwards up the road is the one thing that reads worse than the
   * snap this avoids.
   */
  face(yaw: number, dt: number): void {
    this.wantedYaw = yaw;
    const gap = this.wantedYaw - this.yaw;
    if (gap === 0) return;
    const step = BOSS_TURN_RATE * dt;
    this.yaw = Math.abs(gap) <= step ? this.wantedYaw : this.yaw + Math.sign(gap) * step;
    const rig = this.rigs.get(this.variant);
    if (rig !== undefined) rig.model.pivot.rotation.y = this.yaw;
  }

  /** Enraged: a red pulse over the whole body, in time with the faster walk. */
  paintEnrage(enraged: boolean, dt: number): void {
    const rig = this.rigs.get(this.variant);
    if (rig === undefined) {
      this.fallbackMaterial.emissiveColor.copyFrom(
        enraged ? BOSS_ENRAGE_COLOR : BOSS_FALLBACK_EMISSIVE,
      );
      return;
    }
    if (!enraged) {
      if (this.enragePhase === 0) return;
      this.enragePhase = 0;
      for (const material of rig.model.materials) material.emissiveColor.set(0, 0, 0);
      return;
    }
    this.enragePhase += dt * BOSS_ENRAGE_PULSE;
    const pulse = 0.4 + 0.35 * Math.sin(this.enragePhase);
    for (const material of rig.model.materials) {
      BOSS_ENRAGE_COLOR.scaleToRef(pulse, material.emissiveColor);
    }
  }

  /** Starts a clip, or answers false when this model does not carry it. */
  play(id: string, loop: boolean): boolean {
    const group = this.rigs.get(this.variant)?.model.groups.get(id);
    if (group === undefined) return false;
    this.stopAll();
    group.play(loop);
    return true;
  }

  /** How long `id` lasts at speed 1, or 0 when the model does not carry it. */
  secondsOf(id: string): number {
    const group = this.rigs.get(this.variant)?.model.groups.get(id);
    return group === undefined ? 0 : groupSeconds(group);
  }

  setSpeed(id: string, speed: number): void {
    const group = this.rigs.get(this.variant)?.model.groups.get(id);
    if (group === undefined) return;
    const clamped = Math.max(0, Math.min(8, speed));
    if (Math.abs(group.speedRatio - clamped) > 0.01) group.speedRatio = clamped;
  }

  stopAll(): void {
    const rig = this.rigs.get(this.variant);
    if (rig === undefined) return;
    for (const group of rig.model.groups.values()) group.stop();
  }

  /** Every clip of every boss stopped: a new level, or a reset. */
  stopEverything(): void {
    for (const rig of this.rigs.values()) {
      for (const group of rig.model.groups.values()) group.stop();
      rig.model.setEnabled(false);
    }
    this.fallback.setEnabled(false);
    this.enragePhase = 0;
    this.yaw = FACING;
    this.wantedYaw = FACING;
  }

  dispose(): void {
    for (const rig of this.rigs.values()) rig.model.dispose();
    this.rigs.clear();
    this.fallback.dispose();
    this.fallbackMaterial.dispose();
  }
}

/** How long a clip lasts at speed 1, from the frames it was authored at. */
function groupSeconds(group: AnimationGroup): number {
  const first = group.targetedAnimations[0];
  const fps = first === undefined ? 30 : first.animation.framePerSecond;
  return (group.to - group.from) / Math.max(1, fps);
}
