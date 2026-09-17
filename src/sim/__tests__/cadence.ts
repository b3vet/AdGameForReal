/**
 * D46's cadence, read off a set of campaigns, with a failure message that says
 * what to tune. Not a test file: `economy.test.ts` and
 * `src/core/__tests__/metaIncome.test.ts` hold the same bands against it.
 *
 * Runs per purchase is attempts over purchases, so a band can miss for two
 * reasons with opposite fixes: the road (a campaign that clears first try
 * every time buys something every run or two, whatever the prices) or the
 * shelf (prices and pay). The message names which one the numbers point at,
 * and the difficulty comes first: prices tuned against a road that is about
 * to change are tuned twice.
 */

import type { CampaignResult } from '../campaign';
import { runsPerPurchase } from '../campaignReport';

export interface CadenceBand {
  from: number;
  to: number;
  target: number;
  tolerance: number;
}

/** docs/18: two runs per purchase on levels 1 to 5, four by level 10 (D46). */
export const EARLY: CadenceBand = { from: 1, to: 5, target: 2, tolerance: 0.7 };
export const LATER: CadenceBand = { from: 6, to: 10, target: 4, tolerance: 1.5 };

/**
 * The first-try band the advice below reads against: D45's, as the priced
 * human is held to it since the ruling of 2026-09-17 (D76, `CLEAR_BAND` in
 * `./balanceBands.ts`).
 */
const FIRST_TRY: readonly [number, number] = [0.88, 0.98];

export interface Cadence {
  ok: boolean;
  where: string;
}

/** The band's measured cadence over `results`, and whether it holds. */
export function cadenceOf(results: readonly CampaignResult[], band: CadenceBand, label: string): Cadence {
  let measured = 0;
  let runs = 0;
  let bought = 0;
  let firsts = 0;
  let firstWins = 0;
  for (const result of results) {
    measured += runsPerPurchase(result, band.from, band.to);
    for (const run of result.runs) {
      if (run.level < band.from || run.level > band.to) continue;
      runs++;
      bought += run.purchases.length;
      if (run.attempt === 1) {
        firsts++;
        if (run.won) firstWins++;
      }
    }
  }
  measured /= Math.max(1, results.length);
  const ok = Math.abs(measured - band.target) <= band.tolerance;
  const firstTry = firstWins / Math.max(1, firsts);
  const attempts = runs / Math.max(1, firsts);
  const fast = measured < band.target;
  let advice = '';
  if (!ok && !Number.isFinite(measured)) {
    advice = 'Nothing was bought: the shelf is out of reach of what these runs pay (progression.json).';
  } else if (!ok && fast && firstTry > FIRST_TRY[1]) {
    advice = 'Too fast because the road is too easy: bring first tries into D45 (balance*.test.ts), then re-read.';
  } else if (!ok && !fast && firstTry < FIRST_TRY[0]) {
    advice = 'Too slow because the road is too hard: bring first tries into D45 (balance*.test.ts), then re-read.';
  } else if (!ok && fast) {
    advice = 'Too fast on a fair road: dearer rungs at this stage, or less pay a run (progression.json).';
  } else if (!ok) {
    advice = 'Too slow on a fair road: cheaper rungs at this stage, or more pay a run (progression.json).';
  }
  const where =
    `${ok ? 'in band' : 'OUT OF BAND'}: ${label}L${String(band.from)}-${String(band.to)} ` +
    `runs per purchase ${measured.toFixed(2)} ` +
    `(target ${String(band.target)} ± ${String(band.tolerance)}): ${String(runs)} runs bought ${String(bought)} ` +
    `over ${String(results.length)} campaigns, ${attempts.toFixed(2)} attempts a level, first tries cleared ` +
    `${firstTry.toFixed(2)} (D76 holds ${String(FIRST_TRY[0])} to ${String(FIRST_TRY[1])}). ${advice}`;
  return { ok, where: where.trimEnd() };
}
