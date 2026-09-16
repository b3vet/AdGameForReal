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
 */

import type { BeatLibrary, GateSlot } from '@/data/types';
import { balance as shipped } from '@/data';
import type { Balance } from '@/data/types';
import { beatValues, within } from './library';

/** What the curve needs of one beat. */
export interface CurveBeat {
  prize: GateSlot;
  /** The prize panel's own draw inside its size's range, in `[0, 1)`. */
  prizeU: number;
  expectLoss: number;
}

export interface BeatCurve {
  /** The factor every plus panel's share of E is multiplied by. */
  scale: number;
  /** E as the column arrives at each beat, in script order. */
  expected: number[];
  /** What E at the last beat was solved for. */
  target: number;
}

/** What the prize lane multiplies the squad by, at scale `scale`. */
export function prizeFactor(
  beat: CurveBeat,
  scale: number,
  library: BeatLibrary,
): number {
  const prize = beat.prize;
  if (prize.kind === 'mul') return prize.value;
  if (prize.kind === 'add') return 1 + within(beatValues(library, prize.size), beat.prizeU) * scale;
  return 1;
}

/**
 * E at every beat for a given scale. The squad never passes the pool's own
 * ceiling (`squad.maxCount`), so neither does the expectation: a curve that
 * ran past it would size late beats for a squad nobody can hold.
 */
export function walkCurve(
  start: number,
  beats: readonly CurveBeat[],
  scale: number,
  library: BeatLibrary,
  balance: Balance = shipped,
): number[] {
  const cap = balance.squad.maxCount;
  const expected: number[] = [];
  let e = Math.min(cap, Math.max(1, start));
  for (const beat of beats) {
    expected.push(e);
    const loss = Math.min(1, Math.max(0, beat.expectLoss));
    e = Math.min(cap, Math.max(1, e * prizeFactor(beat, scale, library) * (1 - loss)));
  }
  return expected;
}

/** Bisection steps: the answer is good to a millionth of the scale range. */
const SOLVE_STEPS = 48;

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
  const bounds = balance.gates.scale;
  const last = (scale: number): number => {
    const walked = walkCurve(start, beats, scale, library, balance);
    return walked[walked.length - 1] ?? start;
  };
  let low = bounds.min;
  let high = bounds.max;
  // Out of reach even at the top of the bounds: the top it is.
  if (last(low) >= target) high = low;
  else if (last(high) >= target) {
    for (let i = 0; i < SOLVE_STEPS; i++) {
      const mid = (low + high) / 2;
      if (last(mid) < target) low = mid;
      else high = mid;
    }
  }
  // `high` is the side that reaches the target (or the bound it was held to).
  const scale = high;
  return { scale, expected: walkCurve(start, beats, scale, library, balance), target };
}
