/**
 * The boss: the Quaternius demon, three metres of it, and its stomp rings.
 *
 * It is the one thing in the scene that is not a crowd, so it keeps a real
 * skeleton and real animation groups and gets blending between them. The state
 * machine is a priority list — death beats a stomp, a stomp beats a hit
 * reaction, a hit reaction beats walking — because the sim can hand us a stomp
 * and six hits in the same tick.
 *
 * Clip playback runs on the app's time scale rather than the frame's, so
 * hit-stop and the slow-mo on the kill hold the boss too.
 */

import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { labelPixels, type NumberLabels } from './labels';
import { liftEmissive, loadAnimatedModel, type AnimatedModel } from './models';
import { applyToonRampToAll } from './toonRamp';
import { RingPool } from './rings';
import {
  BOSS_COLOR,
  BOSS_DEPTH,
  BOSS_DRAW_RANGE,
  BOSS_ENRAGE_COLOR,
  BOSS_ENRAGE_PULSE,
  BOSS_ENRAGE_SPEED,
  BOSS_HEIGHT,
  BOSS_HIT_THROTTLE,
  BOSS_LABEL_COLOR,
  BOSS_LABEL_HEIGHT,
  BOSS_LABEL_MIN,
  BOSS_LABEL_SIZE,
  BOSS_MODEL_HEIGHT,
  BOSS_SINK_DELAY,
  BOSS_SINK_DURATION,
  BOSS_TAUNT_SPEED,
  BOSS_WIDTH,
  LABEL_RANGE,
  POOL,
  STOMP_ALPHA,
  STOMP_COLOR,
  STOMP_DURATION,
  STOMP_MAX_RADIUS,
  STOMP_THICKNESS,
} from './theme';
import type { EnemyState } from '@/sim';

/** Rings start as a tight shockwave under the boss and sweep outward. */
const RING_START_RADIUS = 0.8;
/** Which way the model faces before it is turned to look down the road. */
const FACING = Math.PI;
/** The demon is the darkest thing in the pack, so it keeps a little more lift
 *  than the crowds — but only a little: the enrage pulse has to read on top of
 *  it, and under daylight the ambient already carries the body. */
const BOSS_LIFT = 0.08;
/**
 * The stand-in box's calm emissive, built once. `paintEnrage` runs on every
 * frame of the boss fight, and `Color3.scale` allocates.
 */
const BOSS_FALLBACK_EMISSIVE = BOSS_COLOR.scale(0.25);

interface Ring {
  x: number;
  z: number;
  age: number;
}

export class BossView {
  private readonly scene: Scene;
  private readonly labels: NumberLabels;
  /** This view's label id in the shared atlas; see `src/render/labels.ts`. */
  private readonly label: number;
  private readonly rings: RingPool;
  private readonly ringState: Ring[] = [];
  private readonly fallback: Mesh;
  private readonly fallbackMaterial: StandardMaterial;

  private model: AnimatedModel | null = null;
  private current = '';
  private scale = 1;

  /** Seconds left of a one-shot clip that owns the boss until it ends. */
  private oneShot = 0;
  /**
   * Playback rate of the one-shot in flight, so the taunt can run at half
   * speed without every later clip inheriting it. 1 for everything else.
   */
  private oneShotSpeed = 1;
  private hitCooldown = 0;
  /** Seconds since `bossKilled`, or -1 while alive. */
  private dying = -1;
  private enragePhase = 0;
  private shownHp = Number.NaN;
  private shownText = '';
  /** Where the body was last drawn, for the sink and for the death burst. */
  private lastX = 0;
  private lastZ = 0;

  constructor(scene: Scene, labels: NumberLabels) {
    this.scene = scene;
    this.labels = labels;
    this.label = labels.claim();

    // Thin: the ring is a tell, not the event. A fat bright ring swallows the
    // boss it is meant to sell — which is exactly what the Phase B2 frames
    // showed, and the additive blend does the rest.
    this.rings = new RingPool(scene, 'stomp', STOMP_COLOR, POOL.stompRings, {
      thickness: STOMP_THICKNESS,
      alpha: STOMP_ALPHA,
      additive: true,
      y: 0.12,
    });
    for (let i = 0; i < POOL.stompRings; i++) this.ringState.push({ x: 0, z: 0, age: -1 });

    // Stands in for the demon when the model cannot be loaded, so a build
    // without assets still has a boss to shoot at.
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

  async load(): Promise<void> {
    const model = await loadAnimatedModel(this.scene, 'boss_demon');
    if (model === null) return;
    this.model = model;
    for (const material of model.materials) liftEmissive(material, BOSS_LIFT);
    applyToonRampToAll(model.materials);
    // The manifest's own scale is a starting point; the plan wants three metres.
    this.scale = BOSS_HEIGHT / (model.height > 0 ? model.height : BOSS_MODEL_HEIGHT);
    model.pivot.scaling.setAll(this.scale);
    model.pivot.rotation.y = FACING;
    model.setEnabled(false);
  }

  /** Where the boss stands, for the effects that `bossKilled` does not locate. */
  positionOf(out: { x: number; z: number }): void {
    out.x = this.lastX;
    out.z = this.lastZ;
  }

  reset(): void {
    this.dying = -1;
    this.oneShot = 0;
    this.oneShotSpeed = 1;
    this.hitCooldown = 0;
    this.current = '';
    this.shownHp = Number.NaN;
    this.shownText = '';
    this.enragePhase = 0;
    this.model?.setEnabled(false);
    this.fallback.setEnabled(false);
    for (const ring of this.ringState) ring.age = -1;
    this.rings.reset();
    this.stopAll();
  }

  /**
   * The squad reached the arena. The demon takes a beat before it walks: a
   * `Punch` at half speed, which reads as a slow raised arm rather than a
   * strike (`BOSS_TAUNT_SPEED`), because the model ships no taunt clip.
   */
  onActivated(): void {
    if (this.dying >= 0) return;
    this.playOneShot('attack', BOSS_TAUNT_SPEED);
  }

  onStomp(x: number, z: number): void {
    // A free ring, or the one that has swept out furthest: the pool is small on
    // purpose (see `POOL.stompRings`), and the newest wave is the one that
    // matters.
    let chosen = this.ringState[0];
    for (const ring of this.ringState) {
      if (ring.age < 0) {
        chosen = ring;
        break;
      }
      if (chosen !== undefined && chosen.age >= 0 && ring.age > chosen.age) chosen = ring;
    }
    if (chosen !== undefined) {
      chosen.x = x;
      chosen.z = z;
      chosen.age = 0;
    }
    this.playOneShot('attack');
  }

  /**
   * Hit reactions are throttled: the squad lands dozens of shots a second.
   * `BOSS_HIT_THROTTLE` is shorter in Milestone 3 than in Milestone 2 — the
   * product owner asked for more animation, and a boss that stands still
   * through a barrage is the most visible place there was none.
   */
  onHit(): void {
    if (this.dying >= 0 || this.hitCooldown > 0 || this.oneShot > 0) return;
    this.hitCooldown = BOSS_HIT_THROTTLE;
    this.playOneShot('hit');
  }

  onKilled(): void {
    if (this.dying >= 0) return;
    this.dying = 0;
    this.oneShot = 0;
    this.play('death', false);
  }

  /**
   * `timeScale` is the app's time scale — the ratio between the sim time this
   * frame covers and the wall clock it took — so hit-stop and slow-mo reach the
   * animation groups, which otherwise run on the scene's own clock.
   */
  update(boss: EnemyState | null, squadZ: number, dt: number, timeScale: number): void {
    this.updateRings(dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    if (this.dying >= 0) {
      this.oneShot = 0;
      this.advanceDeath(dt, timeScale);
      return;
    }

    if (boss === null || !boss.alive) {
      this.show(false);
      return;
    }

    const ahead = boss.z - squadZ;
    // Past the fog there is nothing to see, and the model does not frustum-cull
    // itself: drawing it through the whole road phase costs the frame's peak
    // two calls for a body nobody can make out.
    this.show(ahead < BOSS_DRAW_RANGE);
    this.place(boss.x, 0, boss.z);

    const enraged = boss.enraged === true;
    this.paintEnrage(enraged, dt);
    const wasOneShot = this.oneShot > 0;
    if (!wasOneShot) this.play(boss.active ? 'walk' : 'idle', true);
    // Counted down *after* the decision, so a one-shot started by this frame's
    // events is drawn at least once: on a slow frame `dt` is longer than a
    // punch, and a punch cut before the frame renders never happened at all.
    this.oneShot = Math.max(0, this.oneShot - dt);
    if (this.oneShot <= 0) this.oneShotSpeed = 1;
    this.setSpeed(timeScale * (enraged ? BOSS_ENRAGE_SPEED : 1) * (wasOneShot ? this.oneShotSpeed : 1));

    if (ahead >= LABEL_RANGE) return;
    // The boss loses hp every frame, but only whole numbers are printable:
    // rebuild the string when the rounded number moves, not on every hit.
    const hp = Math.max(0, Math.round(boss.hp));
    if (hp !== this.shownHp) {
      this.shownHp = hp;
      this.shownText = String(hp);
    }
    this.labels.set(
      this.label,
      this.shownText,
      boss.x,
      BOSS_LABEL_HEIGHT,
      boss.z,
      BOSS_LABEL_COLOR,
      labelPixels(BOSS_LABEL_SIZE, BOSS_LABEL_MIN, ahead),
    );
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
    this.fallback.dispose();
    this.fallbackMaterial.dispose();
    this.rings.dispose();
    this.ringState.length = 0;
  }

  /** The body plays its death, holds, then sinks through the road. */
  private advanceDeath(dt: number, timeScale: number): void {
    this.dying += dt;
    this.setSpeed(timeScale);
    const sinking = this.dying - BOSS_SINK_DELAY;
    if (sinking <= 0) return;
    if (sinking >= BOSS_SINK_DURATION) {
      this.show(false);
      return;
    }
    const drop = (sinking / BOSS_SINK_DURATION) * (BOSS_HEIGHT + 0.5);
    this.place(this.lastX, -drop, this.lastZ);
  }

  private place(x: number, y: number, z: number): void {
    this.lastX = x;
    this.lastZ = z;
    const model = this.model;
    if (model !== null) {
      model.pivot.position.set(x, y, z);
      return;
    }
    this.fallback.position.set(x, y + BOSS_HEIGHT / 2, z);
  }

  private show(enabled: boolean): void {
    if (this.model !== null) this.model.setEnabled(enabled);
    else this.fallback.setEnabled(enabled);
  }

  /** Enraged: a red pulse over the whole body, in time with the faster walk. */
  private paintEnrage(enraged: boolean, dt: number): void {
    const model = this.model;
    if (model === null) {
      this.fallbackMaterial.emissiveColor.copyFrom(
        enraged ? BOSS_ENRAGE_COLOR : BOSS_FALLBACK_EMISSIVE,
      );
      return;
    }
    if (!enraged) {
      if (this.enragePhase === 0) return;
      this.enragePhase = 0;
      for (const material of model.materials) material.emissiveColor.set(0, 0, 0);
      return;
    }
    this.enragePhase += dt * BOSS_ENRAGE_PULSE;
    const pulse = 0.4 + 0.35 * Math.sin(this.enragePhase);
    for (const material of model.materials) {
      BOSS_ENRAGE_COLOR.scaleToRef(pulse, material.emissiveColor);
    }
  }

  private play(id: string, loop: boolean): void {
    if (this.current === id) return;
    const group = this.model?.groups.get(id);
    if (group === undefined) return;
    this.stopAll();
    group.play(loop);
    this.current = id;
  }

  /**
   * A clip that owns the boss until it has played out, then hands back.
   *
   * `speed` is the *clip's* own rate, on top of whatever the app's time scale
   * is doing, and the hold is divided by it: a taunt at half speed takes twice
   * as long, and a one-shot handed back early is a clip cut off mid-swing.
   */
  private playOneShot(id: string, speed = 1): void {
    if (this.dying >= 0) return;
    const group = this.model?.groups.get(id);
    if (group === undefined) return;
    this.current = '';
    this.stopAll();
    group.play(false);
    this.current = id;
    this.oneShotSpeed = speed;
    this.oneShot = groupSeconds(group) / Math.max(0.05, speed);
  }

  private setSpeed(speed: number): void {
    const group = this.model?.groups.get(this.current);
    if (group === undefined) return;
    const clamped = Math.max(0, Math.min(8, speed));
    if (Math.abs(group.speedRatio - clamped) > 0.01) group.speedRatio = clamped;
  }

  private stopAll(): void {
    const model = this.model;
    if (model === null) return;
    for (const group of model.groups.values()) group.stop();
  }

  private updateRings(dt: number): void {
    this.rings.begin();
    for (const ring of this.ringState) {
      if (ring.age < 0) continue;
      ring.age += dt;
      if (ring.age >= STOMP_DURATION) {
        ring.age = -1;
        continue;
      }
      const p = ring.age / STOMP_DURATION;
      this.rings.add(ring.x, ring.z, RING_START_RADIUS + (STOMP_MAX_RADIUS - RING_START_RADIUS) * p);
    }
    this.rings.end();
  }
}

/** How long a clip lasts at speed 1, from the frames it was authored at. */
function groupSeconds(group: AnimationGroup): number {
  const first = group.targetedAnimations[0];
  const fps = first === undefined ? 30 : first.animation.framePerSecond;
  return (group.to - group.from) / Math.max(1, fps);
}
