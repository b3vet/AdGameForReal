/**
 * The camera rig: where the shot sits, how it eases, and how it shakes.
 *
 * The constants in `CAMERA` are one set, not five knobs — they were measured
 * against screenshots at 390x844 (docs/07-milestone-2-log.md, "Cam") — so the
 * arithmetic that reads them lives here, in one place, rather than inline in
 * the renderer's frame loop.
 */

import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Scene } from '@babylonjs/core/scene';

import {
  CAMERA,
  PREVIEW_BLEND_RATE,
  PREVIEW_DRIFT_PERIOD,
  PREVIEW_DRIFT_PERIOD_Y,
  PREVIEW_DRIFT_X,
  PREVIEW_DRIFT_Y,
  PREVIEW_BEHIND,
  PREVIEW_HEIGHT,
  PREVIEW_LOOK_AHEAD,
  PREVIEW_LOOK_HEIGHT,
} from './theme';
import type { SquadState } from '@/sim';

export class CameraRig {
  readonly camera: UniversalCamera;

  /** Scratch: `update` runs 60 times a second and must not allocate. */
  private readonly target = new Vector3(0, CAMERA.lookHeight, CAMERA.lookAhead);

  /** The eased pose, before the shake is added on top of it. */
  private poseX = 0;
  private poseY: number = CAMERA.height;
  private poseZ: number = -CAMERA.behind;
  private ready = false;
  private settled = false;

  /** Camera shake: peak offset in metres, seconds left, and its decay span. */
  private shakeStrength = 0;
  private shakeLeft = 0;
  private shakeSpan = 1;
  /** Its own RNG state so a kick never touches the sim's deterministic stream. */
  private seed = 0x9e37_79b9;

  /**
   * The Academy backdrop's slow breath (docs/12-milestone-4-plan.md).
   *
   * A preview run never ticks, so without this the home screen is one frame
   * repeated: the crowd's idle sway is there, but the shot behind it is dead
   * still and the whole thing reads as a paused game. On, the pose drifts a
   * little over half a metre sideways and a fifth of a metre up on two periods
   * that do not divide into each other, so the loop never lands on itself.
   *
   * It is added on top of the eased pose exactly like the shake, and for the
   * same reason: feeding it back into the ease would turn a drift into a
   * wander.
   */
  private drifting = false;
  private driftPhase = 0;
  /** 0 while playing, 1 on the Academy; everything preview eases on it. */
  private previewBlend = 0;

  constructor(scene: Scene) {
    const camera = new UniversalCamera(
      'camera',
      new Vector3(0, CAMERA.height, -CAMERA.behind),
      scene,
    );
    camera.fov = CAMERA.fov;
    camera.minZ = 0.2;
    camera.maxZ = 220;
    // No input: the squad is driven by the sim, and a stray gesture must never
    // move the camera.
    camera.inputs.clear();
    camera.setTarget(this.target);
    this.camera = camera;
  }

  /** True when the last `update` moved the pose by less than a pixel's worth. */
  isSettled(): boolean {
    return this.settled;
  }

  /** The Academy is up (or is not): see `drifting`. */
  setDrift(on: boolean): void {
    if (this.drifting === on) return;
    this.drifting = on;
    if (!on) this.driftPhase = 0;
  }

  /** A fresh level snaps the framing too: no swing behind the loading frame. */
  private snapPreview(): void {
    this.previewBlend = this.drifting ? 1 : 0;
  }

  /** A fresh level snaps rather than easing in from wherever the last one ended. */
  reset(): void {
    this.ready = false;
    this.settled = false;
    this.shakeLeft = 0;
    this.snapPreview();
  }

  /**
   * Kicks the camera. `strength` is the peak offset in metres and decays to
   * nothing over `seconds`; a second call while one is running wins only if it
   * is the bigger kick, so a stomp during a death rattle cannot calm it down.
   */
  shake(strength: number, seconds: number): void {
    if (strength <= 0 || seconds <= 0) return;
    if (strength * seconds < this.shakeStrength * this.shakeLeft) return;
    this.shakeStrength = strength;
    this.shakeLeft = seconds;
    this.shakeSpan = seconds;
  }

  /**
   * Behind and above the squad, easing toward the ideal pose so a fast lateral
   * drag does not snap the whole world sideways, and pulling back as the squad
   * grows so a 500-unit crowd still fits in frame.
   */
  update(squad: SquadState, dt: number): void {
    const pullback = Math.min(CAMERA.pullbackMax, squad.count * CAMERA.pullbackPerUnit);
    const lateral = squad.x * CAMERA.lateralFollow;

    // The backdrop stands further back and lower than the game does, so the
    // crowd sits above the Academy's cards rather than behind them (see
    // `PREVIEW_BEHIND` for the one angle that decides it).
    const target = this.drifting ? 1 : 0;
    this.previewBlend += (target - this.previewBlend) * (1 - Math.exp(-PREVIEW_BLEND_RATE * dt));
    const behind = mix(CAMERA.behind, PREVIEW_BEHIND, this.previewBlend);
    const height = mix(CAMERA.height, PREVIEW_HEIGHT, this.previewBlend);
    const lookAhead = mix(CAMERA.lookAhead, PREVIEW_LOOK_AHEAD, this.previewBlend);
    const lookHeight = mix(CAMERA.lookHeight, PREVIEW_LOOK_HEIGHT, this.previewBlend);

    const wantX = lateral;
    const wantY = height + pullback;
    const wantZ = squad.z - behind - pullback;

    // A fresh level snaps; every other frame eases at a rate independent of
    // frame time, so 30 fps and 120 fps feel the same.
    const blend = this.ready ? 1 - Math.exp(-CAMERA.smoothing * dt) : 1;
    this.ready = true;

    const fromX = this.poseX;
    const fromY = this.poseY;
    const fromZ = this.poseZ;

    let x = fromX + (wantX - fromX) * blend;
    let y = fromY + (wantY - fromY) * blend;
    let z = fromZ + (wantZ - fromZ) * blend;

    // The ease runs on frame time while the squad moves on sim time. A long
    // frame — or `?turbo`, which advances the sim several steps per frame —
    // leaves the pose metres behind the squad, which is a different shot
    // entirely: flatter, more sky, the near row halfway up the screen. Clamping
    // the trailing distance keeps the framing the tuning was done against.
    const lag = Math.hypot(wantX - x, wantY - y, wantZ - z);
    if (lag > CAMERA.maxLag) {
      const keep = CAMERA.maxLag / lag;
      x = wantX + (x - wantX) * keep;
      y = wantY + (y - wantY) * keep;
      z = wantZ + (z - wantZ) * keep;
    }

    this.settled =
      Math.abs(x - fromX) + Math.abs(y - fromY) + Math.abs(z - fromZ) < CAMERA.settleEpsilon;
    this.poseX = x;
    this.poseY = y;
    this.poseZ = z;

    // The shake is an offset on top of the eased pose, never fed back into it:
    // easing from a shaken position would smear the kick into a drift.
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeLeft > 0) {
      this.shakeLeft = Math.max(0, this.shakeLeft - dt);
      const left = this.shakeLeft / this.shakeSpan;
      const amplitude = this.shakeStrength * left * left;
      shakeX = (this.random() * 2 - 1) * amplitude;
      shakeY = (this.random() * 2 - 1) * amplitude;
      this.settled = false;
    }

    let driftX = 0;
    let driftY = 0;
    if (this.drifting) {
      this.driftPhase += dt;
      driftX = Math.sin((this.driftPhase / PREVIEW_DRIFT_PERIOD) * Math.PI * 2) * PREVIEW_DRIFT_X;
      driftY = Math.sin((this.driftPhase / PREVIEW_DRIFT_PERIOD_Y) * Math.PI * 2) * PREVIEW_DRIFT_Y;
      this.settled = false;
    }

    this.camera.position.set(x + shakeX + driftX, y + shakeY + driftY, z);
    // The look point takes half the lateral drift, so the shot pans rather than
    // strafes: a pure position offset slides the road sideways under a fixed
    // aim, which at this distance reads as a camera bump.
    this.target.set(lateral + driftX * 0.5, lookHeight, squad.z + lookAhead);
    this.camera.setTarget(this.target);
  }

  dispose(): void {
    this.camera.dispose();
  }

  /** xorshift32: the shake's own noise, deliberately not the sim's RNG. */
  private random(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x;
    return (x >>> 0) / 4294967296;
  }
}

/** Linear blend; the preview framing is the only thing that needs one. */
function mix(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
