/**
 * The other half of "never mandatory below level 40" (D54), on the scripted
 * campaign.
 *
 * The biome files are the promise to a player who never buys an evolution:
 * the Yard alone still clears the ordinary levels in their band. This is
 * the promise to the player who does: the same purse spent partly on the
 * Workbench's ladders must not turn a road into a formality. Measured on
 * Frostfell, where a level is tuned for a hand that has shopped (D49), with
 * the kit the tier-buying campaign holds when it first arrives: no milestone
 * over 0.75, so an evolution never trivialises a milestone.
 *
 * Ruling of 2026-09-17 (the D76 follow-up): the ordinary-level ceiling of 0.85
 * is dropped. The plain kit's band on ordinary levels became 0.88 to 0.98
 * (D76), and a hand that bought more cannot be asked to clear less than the
 * one that bought less, so only the milestone ceiling is a promise left to
 * hold here.
 *
 * Runtime: 40 runs and one campaign, under a minute on a quiet box.
 */

import { describe, it } from 'vitest';

import { FROST_FROM, Findings, HUMAN_ROADS, MILESTONES, clearRate, f2, play } from './balanceRuns';

const TIMEOUT_MS = 900_000;

/** What a milestone may fall to for the hand that also bought tiers (D54). */
const TIER_MILESTONE_CEILING = 0.75;

describe('balance: evolution tiers', () => {
  it('never lets the evolution tiers the campaign buys walk a Frostfell milestone', () => {
    const findings = new Findings();
    for (const level of MILESTONES.filter((index) => index >= FROST_FROM)) {
      const rate = clearRate(HUMAN_ROADS.map((road) => play(level, road, 'human', 'tiers')));
      findings.check(
        `L${String(level)} tier kit clears ${f2(rate)}, ceiling ${String(TIER_MILESTONE_CEILING)}`,
        rate <= TIER_MILESTONE_CEILING,
      );
    }
    findings.assert();
  }, TIMEOUT_MS);
});
