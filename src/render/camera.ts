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
  cameraBack,
  cameraLift,
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
import { formationDepth, openRoadWidth } from '@/sim';
import type { SquadState } from '@/sim';

export class CameraRig {
  readonly camera: UniversalCamera;

  /** Scratch: `update` runs 60 times a second and must not allocate. */
  private readonly target = new Vector3(0, CAMERA.lookHeight, CAMERA.lookAhead);

  /** The eased pose, before the shake is added on top of it. */
  private poseX = 0;
  /**
   * The lateral spring's velocity, in metres per second. Kept because a spring
   * is a second-order filter: without carrying velocity between frames it is
   * an exponential ease with extra arithmetic. It also drives the roll.
   */
  private lateralVelocity = 0;
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
  /**
   * The formation depth the pull-back is currently drawn from, in metres, eased
   * toward the crowd's own (`CAMERA.depthSmoothing`). `NaN` until the first
   * frame of a level, which snaps rather than easing in from the last one's.
   */
  private depth = Number.NaN;
  /** Where the squad stood last frame, for the depth ease's distance term. */
  private lastSquadZ = Number.NaN;
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
    camera.maxZ = CAMERA.maxZ;
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
    this.lateralVelocity = 0;
    this.depth = Number.NaN;
    this.lastSquadZ = Number.NaN;
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
    // How deep the crowd stands right now, eased: the shot pulls back and lifts
    // with the *formation*, not with the count (`CAMERA.backPerDepth`). The
    // width is the band the sim laid this frame's crowd out in, so a squad
    // pinched into a lane by a wall — which is deeper for the same count — gets
    // the same treatment.
    const wantDepth = formationDepth(squad.count, squad.formationWidth ?? openRoadWidth());
    const travelled = Number.isNaN(this.lastSquadZ) ? 0 : Math.abs(squad.z - this.lastSquadZ);
    this.lastSquadZ = squad.z;
    if (Number.isNaN(this.depth)) {
      this.depth = wantDepth;
    } else {
      // Time *and* distance (`CAMERA.depthPerMetre`): the crowd grows on the
      // sim's clock and this ease runs on the frame's, and a turbo frame is
      // fifteen metres of road in one of them.
      const rate = CAMERA.depthSmoothing * dt + CAMERA.depthPerMetre * travelled;
      this.depth += (wantDepth - this.depth) * (1 - Math.exp(-rate));
    }
    const back = cameraBack(this.depth);
    const lift = cameraLift(this.depth);
    // The *finger*, not the crowd (D43). The head is on `targetX` 1:1 and the
    // column chains behind it, so a shot that followed `squad.x` would be
    // following the same spring the player is trying to read against: the road
    // and the crowd would move together and neither would show a response.
    // Following the target puts the road under the thumb on the frame the drag
    // happens, and the head's 50 ms and the tail's half-second then read as
    // exactly what they are — the crowd catching up with the player.
    const lateral = squad.targetX * CAMERA.lateralFollow;

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
    const wantY = height + lift;
    const wantZ = squad.z - behind - back;

    // A fresh level snaps; every other frame eases at a rate independent of
    // frame time, so 30 fps and 120 fps feel the same.
    const blend = this.ready ? 1 - Math.exp(-CAMERA.smoothing * dt) : 1;
    const fresh = !this.ready;
    this.ready = true;

    const fromX = this.poseX;
    const fromY = this.poseY;
    const fromZ = this.poseZ;

    // The height and the follow distance are a filter on a slow number and stay
    // an exponential ease; the lateral is the one the thumb drives, so it gets
    // the spring (`CAMERA.lateralFrequency`).
    let x: number;
    if (fresh) {
      x = wantX;
      this.lateralVelocity = 0;
    } else {
      x = this.spring(fromX, wantX, dt);
    }
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

    // The spring's velocity counts: a pose that has arrived but is still
    // carrying speed is about to leave again, and a settled frame is one the
    // title screen may stop redrawing.
    this.settled =
      Math.abs(x - fromX) + Math.abs(y - fromY) + Math.abs(z - fromZ) < CAMERA.settleEpsilon &&
      Math.abs(this.lateralVelocity) * dt < CAMERA.settleEpsilon;
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
    // After `setTarget`, which zeroes the roll every time it is called: it
    // builds the rotation from a look-at and has no opinion about the third
    // axis. A hand's worth of tilt into the turn, clamped, and driven by the
    // spring's velocity rather than the squad's so it cannot flick.
    this.camera.rotation.z = clamp(
      -this.lateralVelocity * CAMERA.roll,
      -CAMERA.rollMax,
      CAMERA.rollMax,
    );
  }

  dispose(): void {
    this.camera.dispose();
  }

  /**
   * One step of a critically damped spring toward `target`, in the implicit
   * form: unconditionally stable at any frame time, which the explicit form is
   * not — a 200 ms hitch through an explicit spring is an overshoot the size of
   * the road.
   *
   * Derived from the damped-spring equation with the damping ratio pinned at 1
   * (`2 * omega`), solved backward for the next position and velocity together,
   * which is why both fall out of one determinant.
   */
  private spring(from: number, target: number, dt: number): number {
    const omega = CAMERA.lateralFrequency;
    const f = 1 + 2 * dt * omega;
    const oo = omega * omega;
    const hoo = dt * oo;
    const hhoo = dt * hoo;
    const detInv = 1 / (f + hhoo);
    const next = (f * from + dt * this.lateralVelocity + hhoo * target) * detInv;
    this.lateralVelocity = (this.lateralVelocity + hoo * (target - from)) * detInv;
    return next;
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

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
