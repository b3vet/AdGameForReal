/**
 * The boss fight, as the renderer sees it: which clip the body is playing, the
 * stomp's shockwave rings, the frost wake the Rime Fiend leaves behind a charge
 * (D49), and the number over its head.
 *
 * The body itself — two models, their clips, the enrage pulse and the greybox
 * stand-in — is `./bossModels.ts`; this file is the state machine over it. That
 * machine is a priority list — death beats a charge, a charge beats a stomp, a
 * stomp beats a hit reaction, a hit reaction beats walking — because the sim can
 * hand us a stomp and six hits in the same tick.
 *
 * Clip playback runs on the app's time scale rather than the frame's, so
 * hit-stop and the slow-mo on the kill hold the boss too.
 */

import type { Scene } from '@babylonjs/core/scene';

import { BossRig, FACING, FACING_HOME } from './bossModels';
import { FrostSpray } from './frostSpray';
import type { GroundDecals } from './groundDecals';
import { labelPixels, type NumberLabels } from './labels';
import { RingPool } from './rings';
import {
  BOSS_CHARGE_OVERRUN,
  BOSS_DRAW_RANGE,
  BOSS_ENRAGE_SPEED,
  BOSS_HEIGHT,
  BOSS_HIT_THROTTLE,
  BOSS_LABEL_COLOR,
  BOSS_LABEL_HEIGHT,
  BOSS_LABEL_MIN,
  BOSS_LABEL_SIZE,
  BOSS_SINK_DELAY,
  BOSS_SINK_DURATION,
  BOSS_TAUNT_SPEED,
  BOSS_WAKE_BEHIND,
  BOSS_WAKE_COLOR,
  BOSS_WAKE_EVERY,
  BOSS_WAKE_SECONDS,
  BOSS_WAKE_SIZE,
  BOSS_WAKE_SPREAD,
  LABEL_RANGE,
  POOL,
  STOMP_ALPHA,
  STOMP_COLOR,
  STOMP_DURATION,
  STOMP_MAX_RADIUS,
  STOMP_THICKNESS,
} from './theme';
import type { BossKind, EnemyState } from '@/sim';

/** Rings start as a tight shockwave under the boss and sweep outward. */
const RING_START_RADIUS = 0.8;

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
  private readonly rig: BossRig;
  private readonly rings: RingPool;
  private readonly ringState: Ring[] = [];
  /** The frost the Fiend tears off the road while it charges (D49). */
  private readonly wake = new FrostSpray(
    BOSS_WAKE_SIZE,
    BOSS_WAKE_COLOR,
    BOSS_WAKE_SPREAD,
    BOSS_WAKE_EVERY,
    BOSS_WAKE_SECONDS,
  );
  private readonly decals: GroundDecals;

  private current = '';
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
  private shownHp = Number.NaN;
  private shownText = '';
  /** Where the body was last drawn, for the sink and for the death burst. */
  private lastX = 0;
  private lastZ = 0;

  /**
   * `decals` is the frame's shared ground-mark batch, opened around this view's
   * `update`: the charge wake goes into it, so it costs no draw call.
   */
  constructor(scene: Scene, labels: NumberLabels, decals: GroundDecals) {
    this.scene = scene;
    this.labels = labels;
    this.decals = decals;
    this.label = labels.claim();
    this.rig = new BossRig(scene);

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
  }

  async load(): Promise<void> {
    await this.rig.load(this.scene);
  }

  /**
   * Which boss this level's arena holds (D49). Called from `loadLevel` so the
   * right body is in place before the squad ever sees it; `update` confirms it
   * from the state every frame, which is what covers a hand-made `EnemyState`.
   */
  setVariant(kind: BossKind): void {
    if (kind === this.rig.kind) return;
    this.rig.setVariant(kind);
    this.current = '';
    this.oneShot = 0;
    this.oneShotSpeed = 1;
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
    this.wake.clear();
    for (const ring of this.ringState) ring.age = -1;
    this.rings.reset();
    this.rig.stopEverything();
  }

  /**
   * The squad reached the arena. The boss takes a beat before it walks: a
   * `Punch` at half speed, which reads as a slow raised arm rather than a
   * strike (`BOSS_TAUNT_SPEED`), because neither model ships a taunt clip.
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
   *
   * `time` is the sim's clock, which is what `EnemyState.charge.until` is
   * measured against (`src/sim/bossCharge.ts`): it is how this view tells the
   * run *in* from the walk home, since both are one charge to the sim.
   */
  update(
    boss: EnemyState | null,
    squadZ: number,
    dt: number,
    timeScale: number,
    time: number,
  ): void {
    this.updateBody(boss, squadZ, dt, timeScale, time);
    // Last, and never first. The marks a charge sheds are laid down inside the
    // call above, and a batch uploaded before them is a batch that draws this
    // frame's wake on the *next* frame — which the review caught the only way
    // it could be caught: the frame a capture stops on is the first frame of
    // the charge, and it photographed an empty road (`./frostSpray.ts`).
    //
    // On the sim's clock, not the frame's: a wake is metres of road behind a
    // body moving at sim speed.
    this.wake.draw(this.decals, time);
  }

  /** Everything but the wake; `update` owns the order those two go in. */
  private updateBody(
    boss: EnemyState | null,
    squadZ: number,
    dt: number,
    timeScale: number,
    time: number,
  ): void {
    this.updateRings(dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);

    if (this.dying >= 0) {
      this.oneShot = 0;
      this.advanceDeath(dt, timeScale);
      return;
    }

    if (boss === null || !boss.alive) {
      this.rig.show(false);
      return;
    }

    // The state is the authority on which boss this is: a level load sets it
    // through `setVariant`, and a hand-made `EnemyState` carries no variant at
    // all, which is boss 1 (`src/sim/types.ts`).
    this.setVariant(boss.variant ?? 'demon');

    const ahead = boss.z - squadZ;
    // Past the fog there is nothing to see, and the model does not frustum-cull
    // itself: drawing it through the whole road phase costs the frame's peak
    // two calls for a body nobody can make out.
    this.rig.show(ahead < BOSS_DRAW_RANGE);
    this.place(boss.x, 0, boss.z);

    const enraged = boss.enraged === true;
    this.rig.paintEnrage(enraged, dt);
    const charge = this.trackCharge(boss, time, dt);
    const wasOneShot = this.oneShot > 0;
    if (charge !== '') this.play(charge, true);
    else if (!wasOneShot) this.play(boss.active ? 'walk' : 'idle', true);
    // Counted down *after* the decision, so a one-shot started by this frame's
    // events is drawn at least once: on a slow frame `dt` is longer than a
    // punch, and a punch cut before the frame renders never happened at all.
    this.oneShot = Math.max(0, this.oneShot - dt);
    if (this.oneShot <= 0) this.oneShotSpeed = 1;
    this.rig.setSpeed(
      this.current,
      timeScale * (enraged ? BOSS_ENRAGE_SPEED : 1) * (wasOneShot ? this.oneShotSpeed : 1),
    );

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
    this.rig.dispose();
    this.rings.dispose();
    this.ringState.length = 0;
  }

  /**
   * The charge (D49): which way the body faces, the frost it tears up, and the
   * clip it owes — the run on the way in, the walk on the way home, and `''`
   * when there is no charge to draw at all.
   *
   * It does not touch the demon: `EnemyState.charge` is only ever written by
   * the Rime Fiend's own move and by a charger, neither of which is boss 1, so
   * boss 1's path through `update` is the one it had. A model with no `charge`
   * clip falls back to its walk, so nothing here can leave a body sliding.
   */
  private trackCharge(boss: EnemyState, time: number, dt: number): string {
    const charge = boss.charge;
    if (charge === undefined) {
      this.rig.face(FACING, dt);
      return '';
    }
    const runningIn = time <= charge.until + BOSS_CHARGE_OVERRUN;
    // Facing the way it is going: at the squad on the way in, up the road on
    // the walk back to its stand.
    this.rig.face(runningIn ? FACING : FACING_HOME, dt);
    // Behind it on the way in, in front of it on the way home — either way,
    // the metre of road it has just crossed.
    this.wake.emit(boss.x, boss.z + (runningIn ? BOSS_WAKE_BEHIND : -BOSS_WAKE_BEHIND), 0, time);
    if (!runningIn) return 'walk';
    return this.rig.has('charge') ? 'charge' : 'walk';
  }

  /** The body plays its death, holds, then sinks through the road. */
  private advanceDeath(dt: number, timeScale: number): void {
    this.dying += dt;
    this.rig.setSpeed(this.current, timeScale);
    const sinking = this.dying - BOSS_SINK_DELAY;
    if (sinking <= 0) return;
    if (sinking >= BOSS_SINK_DURATION) {
      this.rig.show(false);
      return;
    }
    const drop = (sinking / BOSS_SINK_DURATION) * (BOSS_HEIGHT + 0.5);
    this.place(this.lastX, -drop, this.lastZ);
  }

  /** Moves the body and remembers where, for the sink and the death burst. */
  private place(x: number, y: number, z: number): void {
    this.lastX = x;
    this.lastZ = z;
    this.rig.place(x, y, z);
  }

  private play(id: string, loop: boolean): void {
    if (this.current === id) return;
    if (!this.rig.play(id, loop)) return;
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
    const seconds = this.rig.secondsOf(id);
    if (seconds <= 0) return;
    this.current = '';
    if (!this.rig.play(id, false)) return;
    this.current = id;
    this.oneShotSpeed = speed;
    this.oneShot = seconds / Math.max(0.05, speed);
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
