/**
 * Beat marks (document 31, 3.8): where each beat of a composed level stands.
 *
 * For the tests, the design readout and render's hints. The sim's rules and
 * the bots never read them: a bot reads the board, as a player does.
 */

import type { Lane } from '../types';

export interface BeatMark {
  /** The beat's gate row. */
  z: number;
  beat: string;
  tier: number;
  /** The lane the seed put the prize in. */
  prize: Lane;
  /**
   * E: the squad the beat was sized for, the reference player's expected count
   * as the column arrives at it (3.4). Beside the pinned four, for the readout
   * and the curve's own tests.
   */
  expected: number;
}

/**
 * The beat whose rows lie at or in front of `z`: the first mark whose gate row
 * is not yet behind it. Null past the last beat. Marks are in road order.
 */
export function markAhead(marks: readonly BeatMark[], z: number): BeatMark | null {
  for (const mark of marks) if (mark.z >= z) return mark;
  return null;
}
