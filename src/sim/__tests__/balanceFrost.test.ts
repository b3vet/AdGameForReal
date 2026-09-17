/**
 * The balance contract on the scripted campaign (document 31, section 5):
 * Frostfell's ordinary levels, on the kit the human campaign holds when it
 * first walks onto each one (D46, D49).
 *
 * By level 21 the Academy has sold several rungs and a staff or two, so a bare
 * hand there is a player nobody will be; the bands are the same list as
 * Meadow's (`./balanceBands.ts`), measured armed, with the armed per-level
 * ceiling that only a bought kit makes necessary. See `./balance.test.ts` for
 * the whole contract and what it retired.
 *
 * Runtime: 240 runs (16 levels) plus 40 for the charge and one campaign, about
 * two and a half minutes on a quiet box.
 */

import { describe, it } from 'vitest';

import { biomeBands } from './balanceBands';
import { FROST, Findings, HUMAN_ROADS, play } from './balanceRuns';

const TIMEOUT_MS = 900_000;

/**
 * What the Rime Fiend's lane charge may take against its own stomps (D49: it
 * visibly costs units on every frost level and never carries the fight
 * alone). A third on the dealt roads; re-derived for the smaller boss share of
 * 3.7, which takes a quarter off `bite` and so a quarter off the stomps, while
 * the charge's dead are the people under its body (D69) and do not scale with
 * `bite`: the same charge is four thirds of what it was against the stomp,
 * 1/3 x 4/3, about 0.45.
 */
const CHARGE_SHARE_CEILING = 0.45;

describe('balance: Frostfell, armed', () => {
  biomeBands(FROST, TIMEOUT_MS);

  it('never lets the Rime Fiend decide a frost level with its charge alone', () => {
    const findings = new Findings();
    for (let level = FROST.from; level <= FROST.to; level++) {
      let charge = 0;
      let stomp = 0;
      for (const road of HUMAN_ROADS) {
        const run = play(level, road, 'human', 'kit');
        charge += run.result.chargeKills;
        stomp += run.result.stompKills;
      }
      const where =
        `L${String(level)} charge ${(charge / HUMAN_ROADS.length).toFixed(1)} ` +
        `of stomp ${(stomp / HUMAN_ROADS.length).toFixed(1)} a run`;
      findings.check(`${where}: none`, charge > 0);
      findings.check(`${where}: over ${String(CHARGE_SHARE_CEILING)} of it`, charge <= stomp * CHARGE_SHARE_CEILING);
    }
    findings.assert();
  }, TIMEOUT_MS);
});
