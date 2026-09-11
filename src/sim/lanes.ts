/**
 * The three lanes, and the arithmetic that turns an `x` into one of them.
 *
 * Split out of `level.ts` in Milestone 3: streams and targeting both need lane
 * geometry, and neither has any business importing the level generator.
 */

import type { Lane } from './types';
import { balance } from '@/data';

/** Lane centre in meters. `laneWidth` is 2, so lanes sit at `x = -2, 0, +2`. */
export function laneCenter(lane: Lane, laneWidth = balance.road.laneWidth): number {
  return lane * laneWidth;
}

/**
 * Which lane a point stands in. Rounded on `|x|` so the two boundaries are
 * mirror images: plain `Math.round` breaks ties toward `+infinity`, which put
 * `x = +1` in the right lane but `x = -1` in the middle one — visible the
 * moment a wide squad is clamped to exactly `±road.clampMin`.
 */
export function laneOf(x: number, laneWidth = balance.road.laneWidth): Lane {
  const raw = Math.sign(x) * Math.round(Math.abs(x) / laneWidth);
  return Math.min(1, Math.max(-1, raw)) as Lane;
}
