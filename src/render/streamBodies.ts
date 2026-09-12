/**
 * The rivers of skeletons pouring down the lanes, and the number floating over
 * each one's head (D29, Milestone 3 plan "Enemy streams").
 *
 * A stream body is one `EnemyState` with `units: 1` and a `streamId`, and there
 * are up to `balance.enemies.maxLive` of them on the road. They are written
 * into the same `Crowd` the grunt blocks use, so three hundred walking bodies
 * and four blocks of skeletons together are still one draw call.
 *
 * **This view keeps no per-body state at all**, and that is the design rather
 * than an economy. The sim leaves a killed body in `state.enemies` for
 * `balance.enemies.corpseSeconds` with `diedAt` on it, so the age of a death is
 * `state.time - enemy.diedAt` — read, not remembered. There is no map from
 * enemy id to slot, no bookkeeping to leak when a level is abandoned mid-death,
 * and nothing to keep in step with a sim that pools and re-uses its bodies.
 *
 * The one thing it does have to remember is which bodies *leaked*, because a
 * body that walked into the squad and one that was shot are both simply dead in
 * the state: the first vanishes with a puff, the second falls over.
 */

import type { Crowd } from './characters';
import { usesRagdoll } from './deathStyle';
import { gateCoversLabel } from './labelClearance';
import type { LabelView } from './labelClearance';
import { labelPixels, type NumberLabels } from './labels';
import {
  GRUNT_SCALE,
  LABEL_BEHIND,
  LABEL_RANGE,
  POOL,
  STREAM_LABEL_COLOR,
  STREAM_LABEL_HEIGHT,
  STREAM_LABEL_MIN,
  STREAM_LABEL_SIZE,
} from './theme';
import { balance } from '@/data';
import { laneCenter } from '@/sim';
import type { EnemyState, GateState, RunState, StreamState } from '@/sim';

/** Bodies face the squad, which is behind them down the road. */
const FACING = Math.PI;

/**
 * How much a body's gait speed may vary, either side of 1. Enough that a river
 * has a spread of strides in it; not so much that the slow ones read as a
 * different, weaker enemy.
 */
const GAIT_SPREAD = 0.22;

/** One body in this many runs rather than walks (the `walk2` range). */
const RUNNER_EVERY = 3;

/**
 * Leaked ids, remembered only long enough for the corpse sweep to take the body
 * away. Cleared per level, and a level's whole leak count is in the low
 * hundreds, so this never grows into anything.
 */
const LEAKED_CAPACITY = 256;

export class StreamBodies {
  private readonly labels: NumberLabels;
  /** One label id per stream slot, claimed at init and owned for the app's life. */
  private readonly labelIds: number[] = [];
  /** Bodies that leaked rather than died: they are hidden, not animated. */
  private readonly leaked = new Set<number>();

  /** The `death` range's own length, so a one-shot plays exactly once. */
  private deathSeconds = 1;
  /** Drawn last frame, for the dev harness and the debug panel. */
  private drawn = 0;

  constructor(labels: NumberLabels) {
    this.labels = labels;
    for (let i = 0; i < POOL.streams; i++) this.labelIds.push(labels.claim());
  }

  /** Told once, after the crowd is loaded: how long the baked death runs for. */
  setDeathSeconds(seconds: number): void {
    this.deathSeconds = Math.max(0.05, seconds);
  }

  reset(): void {
    this.leaked.clear();
    this.drawn = 0;
  }

  /** A body walked into the squad. It is hidden; `EffectsView` draws the puff. */
  onLeaked(enemyId: number): void {
    // A set that grew without bound would be a leak of its own. The cap is well
    // past a level's worth of leaks, and dropping the oldest only costs a body
    // one death animation it should not have played.
    if (this.leaked.size >= LEAKED_CAPACITY) this.leaked.clear();
    this.leaked.add(enemyId);
  }

  /**
   * Writes every live and dying stream body into `crowd` starting at `base`,
   * and answers how many it wrote.
   *
   * `physicsQuality` is why this takes an argument it does not obviously need:
   * at quality 0 there is no Havok, so the bodies the ragdoll rule would have
   * thrown have to fall over here instead or a tenth of every stream simply
   * blinks out.
   */
  write(crowd: Crowd, base: number, state: RunState, physicsQuality: number): number {
    const time = state.time;
    const squadZ = state.squad.z;
    const ragdolls = physicsQuality > 0;
    let written = 0;

    for (const enemy of state.enemies) {
      if (enemy.streamId === undefined) continue;
      if (base + written >= crowd.capacity) break;
      // Behind the squad and on its way to being swept: nothing to draw, and
      // the camera cannot see it anyway.
      if (enemy.z < squadZ - LABEL_BEHIND * 2) continue;

      if (enemy.alive) {
        this.writeWalking(crowd, base + written, enemy);
        written++;
        continue;
      }

      if (ragdolls && usesRagdoll(enemy.id)) continue;
      if (this.leaked.has(enemy.id)) continue;

      // The sim's own corpse window is shorter than the baked clip, so the
      // playback is stretched to land its last frame exactly as the body is
      // swept away — otherwise a skeleton is taken off the road mid-fall.
      const age = time - (enemy.diedAt ?? time);
      if (age < 0 || age >= balance.enemies.corpseSeconds) continue;
      const into = (age / balance.enemies.corpseSeconds) * this.deathSeconds;
      // Speed 0 makes the offset *the frame*, which is how a looping baked
      // range plays a one-shot exactly once (`VatCrowd.setInstance`).
      crowd.setInstance(
        base + written,
        enemy.x,
        0,
        enemy.z,
        FACING + yawOf(enemy.id),
        GRUNT_SCALE,
        'death',
        into,
        0,
      );
      written++;
    }

    this.drawn = written;
    return written;
  }

  /**
   * The floating remaining-count over each live stream's head.
   *
   * `headZ` is the nearest live body, so the number rides the front of the
   * river and walks toward the player with it. A stream that has not started or
   * has been cleared prints nothing: the count is a threat readout, and a zero
   * hanging over an empty lane is noise.
   *
   * And a head standing on a gate panel prints nothing either. The count rides
   * `STREAM_LABEL_HEIGHT` over the body rather than on it, which is exactly the
   * band a panel occupies, so the river's number lands on the panel's own value
   * for the second or so the head takes to walk through the row (Milestone 4
   * Phase C caught it on `staff-l10.png`). The panel's box and nothing wider —
   * a block's extra margin would cost the river its readout either side of
   * every row; see `./labelClearance.ts`.
   */
  writeLabels(
    streams: readonly StreamState[],
    squadZ: number,
    gates: readonly GateState[],
    view: LabelView,
  ): void {
    for (let i = 0; i < streams.length && i < this.labelIds.length; i++) {
      const stream = streams[i];
      const label = this.labelIds[i];
      if (stream === undefined || label === undefined) continue;
      if (!stream.started || stream.done || stream.remaining <= 0) continue;

      const ahead = stream.headZ - squadZ;
      if (ahead >= LABEL_RANGE || ahead <= -LABEL_BEHIND) continue;

      const x = laneCenter(stream.lane);
      if (gateCoversLabel(gates, x, stream.headZ, STREAM_LABEL_HEIGHT, view)) continue;

      this.labels.set(
        label,
        countText(stream.remaining),
        x,
        STREAM_LABEL_HEIGHT,
        stream.headZ,
        STREAM_LABEL_COLOR,
        labelPixels(STREAM_LABEL_SIZE, STREAM_LABEL_MIN, ahead),
      );
    }
  }

  /** Bodies drawn last frame. */
  get count(): number {
    return this.drawn;
  }

  dispose(): void {
    this.labelIds.length = 0;
    this.leaked.clear();
  }

  /** A live body: its own gait, its own phase, its own speed. */
  private writeWalking(crowd: Crowd, index: number, enemy: EnemyState): void {
    const id = enemy.id;
    // Derived from the id rather than stored or randomised: a body keeps the
    // same stride for its whole life, and the sim re-using its `EnemyState`
    // objects cannot make one change gait halfway down the road.
    const phase = (id % 37) * 0.043;
    const speed = 1 + (((id % 11) / 10) * 2 - 1) * GAIT_SPREAD;
    crowd.setInstance(
      index,
      enemy.x,
      0,
      enemy.z,
      FACING + yawOf(id),
      GRUNT_SCALE,
      id % RUNNER_EVERY === 0 ? 'walk2' : 'walk',
      phase,
      speed,
    );
  }
}

/** A few degrees of turn per body, so a lane is not a marching column. */
function yawOf(id: number): number {
  return ((id % 7) - 3) * 0.09;
}

/**
 * The printed count. Cached strings for the numbers a stream actually spends
 * most of its life showing, because `String(n)` allocates and this runs for
 * every live stream on every frame.
 */
const COUNT_TEXTS: string[] = [];
function countText(remaining: number): string {
  const whole = Math.max(0, Math.round(remaining));
  if (whole > 400) return String(whole);
  let text = COUNT_TEXTS[whole];
  if (text === undefined) {
    text = String(whole);
    COUNT_TEXTS[whole] = text;
  }
  return text;
}
