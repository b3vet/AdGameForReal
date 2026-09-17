/**
 * The balance contract on the scripted campaign (document 31, section 5):
 * Meadow's ordinary levels, on a hand that bought nothing (D35, D45).
 *
 * D45 moved the bands from greedy to a human-like bot in Milestone 6, because
 * a campaign tuned against greedy is tuned against nobody. Document 31 (4.4)
 * amended both bots: greedy prices a lane by what standing in it costs and
 * reads the row from 45 m, and the human reads each row once through noise
 * and sees a block behind a panel only up close. The bands are re-measured on
 * them, on authored roads: the shipped road the app plays and nine lane
 * shuffles of the same script (3.8).
 *
 * The contract is split over five files by the runs each needs, so they run
 * in parallel (`./balanceRuns.ts` says why):
 *
 *   balance.test.ts            Meadow's ordinary levels, bare
 *   balanceFrost.test.ts       Frostfell's ordinary levels on the campaign's
 *                              kit (D49), and the Rime Fiend's charge
 *   balanceMilestones.test.ts  levels 10, 15, 20, 25, 30, 35 and 40: genuinely
 *                              hard (the owner's answer 1), and what the kit buys
 *   balanceTiers.test.ts       the evolution ladders never walk a level (D54)
 *   balanceBots.test.ts        the random and worst-gate floors
 *
 * The bands themselves are written once, in `./balanceBands.ts`, with the
 * plan line each comes from. Retired with the dealt roads, and why:
 *
 *   - The per-stream leak ceilings (docs/09, D29's "barely clear": 3.5 to 10
 *     percent of a stream reaching greedy, and a stream that never leaks being
 *     too soft from level 6). Section 1.2 names "waves sized just under what
 *     the squad can kill" as the reason the median wave cost nothing, and 3.3
 *     sizes tolls to leak 3 to 18 percent of E on purpose; section 5's
 *     per-beat bands ("threats that cost greedy nothing", the beat lab's loss
 *     bands in `./beats.test.ts`) replace them.
 *   - Greedy's peak within 0.6 to 1.4 of `peakTarget` (D14, D24). 3.4: the
 *     beat curve with losses "replaces `squadCurve` on scripted levels", and
 *     `curveTrim` is fitted so E matches the human's median count within 15
 *     percent; that, and greedy entering the last two beats under the cap
 *     (3.4, "the 500 cap"), is what is asserted instead.
 *   - Meadow's widened 19 to 35 s boss band and Frostfell's 33 s ceiling.
 *     Section 5 holds D20's 20 to 30 s (see `BOSS_SECONDS`).
 *   - Section 5's "greedy's blocks die a median 15 m out", by the hold line
 *     (wave two): every scripted block holds the gateway and ends at contact
 *     (`./balanceBands.ts` says more).
 *   - The milestone ceilings of 0.55 bare (Meadow) and 0.45 (Frostfell), and
 *     the fifteen-point kit separation from level 15 only. The owner's answer
 *     1 asks for genuinely hard milestones; `./balanceMilestones.test.ts`
 *     says exactly what that is measured as.
 *
 * Every number is deterministic: a failure is a design change or a tuning gap,
 * never a flake. Runtime: this file plays 255 runs (17 levels, ten human
 * roads and five greedy ones) and takes about two minutes on a quiet box;
 * the five files together play about 1,300 runs and three campaigns.
 */

import { describe } from 'vitest';

import { biomeBands } from './balanceBands';
import { MEADOW } from './balanceRuns';

/** The first test that reads a run pays for all of them. */
const TIMEOUT_MS = 900_000;

describe('balance: Meadow, bare', () => {
  biomeBands(MEADOW, TIMEOUT_MS);
});
