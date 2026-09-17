/**
 * The level curve with losses in it (document 31, 3.4).
 *
 * A dealt level sizes everything against a geometric curve that only ever
 * rises (`curve.ts`). A scripted level expects the squad to *fall* on the
 * road, so its curve is walked beat by beat instead:
 *
 *     E(k + 1) = E(k) * g(k) * (1 - l(k))
 *
 * where `g` is what the prize lane multiplies the squad by and `l` is the
 * beat's expected loss for the reference player (`expectLoss`). The prize is
 * the lane the curve assumes: it is the beat's designed answer, and whatever
 * the reference player pays to take it is already in `l`.
 *
 * The plus panels are then scaled by one factor, solved so that E at the last
 * beat of the script (the prep beat) is `peakTarget * curveTrim`. One factor
 * rather than one per beat keeps the sizes the beats name in proportion: a big
 * plus stays about twice a mid plus however far the curve had to be pulled.
 *
 * A plus is not taken at its printed value (Phase 1, wave two): the column
 * shoots it up on the way in, at the road's rate for its size, up to the
 * panel's cap. The curve reads the prize as it is expected to stand when the
 * column crosses it (`shotUp`), after the seconds of fire the beat leaves for
 * it (`shotSeconds`): the approach's `gates.curve.panelSeconds`, less what the
 * prize lane's own threats take. Read at face value, a road of eight pumped
 * pluses ran its measured squads to the pool's ceiling by level 7.
 *
 * And a plus is printed for the hand the level expects (`bonus`): Frostfell is
 * sized for the kit the campaign holds there (D49), whose gate-bonus rungs
 * print every plus a fifth to a quarter bigger. A curve that read the bare
 * print had the armed column arriving 9 to 23 percent over E at every beat
 * before the prep.
 */

import { gateCap } from '../gates';
import { portalOpen, portalWindow } from '../pressure';
import type { BeatLibrary, GateSlot } from '@/data/types';
import { balance as shipped } from '@/data';
import type { Balance } from '@/data/types';
import { beatValues, within } from './library';
import type { ResolvedTier } from './library';

/** What the curve needs of one beat. */
export interface CurveBeat {
  prize: GateSlot;
  /** The prize panel's own draw inside its size's range, in `[0, 1)`. */
  prizeU: number;
  expectLoss: number;
  /**
   * Seconds of the whole column's fire the prize panel is expected to take
   * before the column crosses it (`shotSeconds`). Absent or zero reads the
   * panel at its printed value.
   */
  shotSeconds?: number;
  /**
   * What the gate-bonus rung the level expects multiplies a printed plus by
   * (`applyGateBonus`, `LevelGenConfig.kit`). Absent is one: a bare hand.
   */
  bonus?: number;
  /**
   * Document 32: the beat prints a flip curse that pays this multiple of its
   * print once shot green (`gates.flip.payout`). The reference player takes
   * the red lane when it pays more than the prize, and the curve reads it so.
   * Absent on a beat with no flip.
   */
  flipPayout?: number;
}

/**
 * What a plus printed at `value` is expected to stand at when a squad of `e`
 * crosses it, after `seconds` of the squad's whole fire: the road's growth
 * rate for that squad (`growthPerSecond`, with its share term, which every
 * scripted road carries), held to the panel's own cap.
 */
export function shotUp(value: number, e: number, seconds: number, balance: Balance = shipped): number {
  if (!(seconds > 0) || !(value > 0)) return value;
  const rates = balance.gates.growthPerSecond;
  const rate = rates.add + rates.shares.add * Math.max(0, e);
  return Math.max(value, Math.min(gateCap('add', value, balance), value + rate * seconds));
}

/**
 * The seconds of fire a beat's prize panel is expected to take on the way in:
 * `gates.curve.panelSeconds` less what the prize lane's threats take first —
 * a block its kill seconds, a river its pressure (at most one) times the fire
 * window its portal leaves, less half of that for the share of its bodies
 * that reach the column inside `portal.tollSeconds` (they walk through the
 * panel and into the column with hardly a shot on them, so the lane's fire
 * stays on the panel; fitted to the beat lab, Phase 1 wave two). Zero when the
 * prize cannot be shot up.
 */
export function shotSeconds(tier: ResolvedTier, balance: Balance = shipped): number {
  if (tier.gates.prize.kind !== 'add') return 0;
  let busy = 0;
  for (const enemy of tier.enemies) {
    const roles = enemy.lanes !== undefined && enemy.lanes.length > 0 ? enemy.lanes : [enemy.lane];
    if (roles.includes('prize')) busy += Math.max(0, enemy.killSeconds);
  }
  const speed = balance.streams.speed;
  for (const river of tier.rivers) {
    if (!river.lanes.includes('prize')) continue;
    const open = portalOpen(river, speed, balance);
    // Behind a plus, which is the only prize this is asked about, the panel screens it.
    const shape = portalWindow({ at: river.at, open, seconds: river.seconds, screened: river.at > 0, speed }, balance);
    busy += Math.min(1, Math.max(0, river.pressure)) * shape.window * (1 - shape.tollShare / 2);
  }
  return Math.max(0, balance.gates.curve.panelSeconds - busy);
}

export interface BeatCurve {
  /**
   * The factor the plus panels of the curve's later beats are multiplied by
   * (every beat's, on a one-factor curve); `scales` has each beat's own.
   */
  scale: number;
  /** Each beat's factor on its plus panels, in script order. */
  scales: number[];
  /** E as the column arrives at each beat, in script order. */
  expected: number[];
  /** What the curve was solved for: E at the last beat, or the peak (`solveGrowthCurve`). */
  target: number;
  /** E once the last beat's prize is taken, before that beat's loss: the level's peak. */
  peak: number;
}

/** A scale for every beat: one factor for all, or each beat its own. */
export type CurveScales = number | readonly number[];

export function scaleAt(scales: CurveScales, k: number): number {
  return typeof scales === 'number' ? scales : (scales[k] ?? scales[scales.length - 1] ?? 1);
}

/**
 * What the prize lane multiplies a squad of `e` by, at scale `scale`: a plus
 * as the expected kit prints it (`bonus`) and as it is expected to stand once
 * shot up (`shotUp`, whose cap is the bonused panel's, as `applyGateBonus`
 * sets it).
 */
export function prizeFactor(
  beat: CurveBeat,
  scale: number,
  library: BeatLibrary,
  e = 0,
  balance: Balance = shipped,
): number {
  const prize = beat.prize;
  // A flip that pays is the red lane's answer (document 32), read at the
  // middle of the flip range: the curve does not see which print it drew.
  const red = beat.flipPayout === undefined ? 1 : 1 + beat.flipPayout * within(beatValues(library, 'flip'), 0.5);
  if (prize.kind === 'mul') return Math.max(red, prize.value);
  if (prize.kind !== 'add') return red;
  const share = within(beatValues(library, prize.size), beat.prizeU) * scale * (beat.bonus ?? 1);
  if (!(e > 0)) return Math.max(red, 1 + share);
  return Math.max(red, 1 + shotUp(share * e, e, beat.shotSeconds ?? 0, balance) / e);
}

/**
 * E at every beat for a given scale. The squad never passes the pool's own
 * ceiling (`squad.maxCount`), so neither does the expectation: a curve that
 * ran past it would size late beats for a squad nobody can hold.
 */
export function walkCurve(
  start: number,
  beats: readonly CurveBeat[],
  scale: CurveScales,
  library: BeatLibrary,
  balance: Balance = shipped,
): number[] {
  const cap = balance.squad.maxCount;
  const expected: number[] = [];
  let e = Math.min(cap, Math.max(1, start));
  beats.forEach((beat, k) => {
    expected.push(e);
    const loss = Math.min(1, Math.max(0, beat.expectLoss));
    e = Math.min(cap, Math.max(1, e * prizeFactor(beat, scaleAt(scale, k), library, e, balance) * (1 - loss)));
  });
  return expected;
}

/**
 * The level's peak on a walked curve: E at the last beat with that beat's
 * prize taken and before its own loss, which on a script is the prep beat's
 * plus and then its gauntlet (document 32).
 */
export function curvePeak(
  expected: readonly number[],
  beats: readonly CurveBeat[],
  scale: CurveScales,
  library: BeatLibrary,
  balance: Balance = shipped,
): number {
  const k = beats.length - 1;
  const last = beats[k];
  const e = expected[k];
  if (last === undefined || e === undefined) return expected[expected.length - 1] ?? 0;
  return Math.min(balance.squad.maxCount, e * prizeFactor(last, scaleAt(scale, k), library, e, balance));
}

/** Bisection steps: the answer is good to a millionth of the scale range. */
const SOLVE_STEPS = 48;

/**
 * The smallest scale inside `gates.scale` at which `reach(scale)` is at least
 * `goal`; `reach` never falls as the scale rises, so a bisection is exact
 * enough and draws no randomness. Held to a bound when the goal is out of
 * reach either way.
 */
function smallestScale(reach: (scale: number) => number, goal: number, balance: Balance): number {
  const bounds = balance.gates.scale;
  let low = bounds.min;
  let high = bounds.max;
  // Out of reach even at the top of the bounds: the top it is.
  if (reach(low) >= goal) high = low;
  else if (reach(high) >= goal) {
    for (let i = 0; i < SOLVE_STEPS; i++) {
      const mid = (low + high) / 2;
      if (reach(mid) < goal) low = mid;
      else high = mid;
    }
  }
  // `high` is the side that reaches the goal (or the bound it was held to).
  return high;
}

/**
 * The smallest scale that puts E at the last beat on `target`, inside
 * `gates.scale`. E at the last beat never falls as the scale rises, so a
 * bisection is exact enough and draws no randomness.
 *
 * The smallest, because the curve is capped (`walkCurve`): a target at the
 * pool's ceiling is reached by every scale above some point, and the one that
 * reaches it only at the last beat is the one that keeps the late multipliers
 * worth something (3.4, "the 500 cap").
 */
export function solveCurve(
  start: number,
  beats: readonly CurveBeat[],
  target: number,
  library: BeatLibrary,
  balance: Balance = shipped,
): BeatCurve {
  const last = (scale: number): number => {
    const walked = walkCurve(start, beats, scale, library, balance);
    return walked[walked.length - 1] ?? start;
  };
  const scale = smallestScale(last, target, balance);
  const expected = walkCurve(start, beats, scale, library, balance);
  return {
    scale,
    scales: beats.map(() => scale),
    expected,
    target,
    peak: curvePeak(expected, beats, scale, library, balance),
  };
}

/** The beat the level is expected to be half grown by (document 32): the middle one. */
export function middleBeat(count: number): number {
  return Math.floor(count / 2);
}

/**
 * The curve a script is sized on since document 32: growth comes early. Two
 * factors instead of one: the beats before the middle one (`middleBeat`) are
 * scaled so the column arrives there with `gates.curve.midShare` of the peak,
 * and the rest so the level peaks on `target` once the last beat's prize is
 * taken (`curvePeak`). A road that only grew in its last two beats bit a small
 * squad everywhere before them, and its late plus panels pushed the arrival
 * into the pool's ceiling, where every mistake was erased; this one bites a
 * squad that is already half grown, and its later panels print smaller, so a
 * late multiplier or a red lane is still a choice.
 *
 * Each factor is the smallest that reaches its goal inside `gates.scale`, as
 * in `solveCurve`. A script whose later beats already more than double the
 * middle's squad (a x3 after the middle, say) cannot be held to the target and
 * overshoots it: that is a script to rewrite, and the static rules say so.
 */
export function solveGrowthCurve(
  start: number,
  beats: readonly CurveBeat[],
  target: number,
  library: BeatLibrary,
  balance: Balance = shipped,
): BeatCurve {
  const mid = middleBeat(beats.length);
  const both = (early: number, late: number): number[] => beats.map((_, k) => (k < mid ? early : late));
  const atMiddle = (early: number): number =>
    walkCurve(start, beats.slice(0, mid + 1), early, library, balance)[mid] ?? start;
  const early = mid > 0 ? smallestScale(atMiddle, balance.gates.curve.midShare * target, balance) : 1;
  const peakAt = (late: number): number => {
    const scales = both(early, late);
    return curvePeak(walkCurve(start, beats, scales, library, balance), beats, scales, library, balance);
  };
  const late = smallestScale(peakAt, target, balance);
  const scales = both(early, late);
  const expected = walkCurve(start, beats, scales, library, balance);
  return { scale: late, scales, expected, target, peak: curvePeak(expected, beats, scales, library, balance) };
}
