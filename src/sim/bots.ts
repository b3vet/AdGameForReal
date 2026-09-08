/**
 * Scripted players. Used by the balance tests and by `?bot=` in the app.
 *
 * STUB for Phase A: every bot holds the centre lane. Phase B1 implements the
 * real policies from docs/03-milestone-1-plan.md:
 *   greedy — best expected count on the next unpassed row, else block the nearest enemy
 *   random — a random lane per row
 *   worst  — the worst gate on the next row
 */

import { mulberry32 } from './rng';
import type { RunState } from './types';

export type BotKind = 'greedy' | 'random' | 'worst';

/** Returns a policy: given the current state, the `targetX` the bot wants. */
export function createBot(kind: BotKind, seed: number): (state: RunState) => number {
  // Constructed here (not per call) so each bot's random stream is deterministic
  // across a whole run, which is what the balance tests rely on.
  const rng = mulberry32(seed);

  switch (kind) {
    case 'greedy':
    case 'worst':
    case 'random':
      return function decide(_state: RunState): number {
        void rng;
        return 0;
      };
  }
}
