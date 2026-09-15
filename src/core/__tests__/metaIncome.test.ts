/**
 * What the meta layer pays, against what the road pays (D46, D51, D53).
 *
 * The streak, the missions board and the bestiary's kill ladders are three
 * income streams the campaign's prices were never tuned against, and each of
 * them pays in coins — the only currency there is (D33). So the question this
 * file answers is the one the Milestone 8 plan asks: with missions completing
 * at the human bot's own rate and the streak running, does the runs-per-purchase
 * curve D46 fixed still hold, and how much of a campaign's income is meta?
 *
 * It lives in `src/core` rather than beside the other economy tests because of
 * which way the imports have to run. Every rule it measures lives here — a
 * mission is counted in `./missions.ts` off events the sim knows nothing about,
 * a rung is credited in `./bestiary.ts`, a day is claimed in `./streak.ts` —
 * and `src/sim` may not import from `src/core`. Restating any of them next to
 * the campaign would be a second copy of the rules, which is exactly the fault
 * the Milestone 6 review found in the purchase rules and fixed.
 *
 * The model, stated once: **a level is a session and a session is a day**. That
 * is the most generous reading of a forty-level campaign for both the board
 * (three missions may complete a session, and done missions are only replaced
 * at the next session start) and the streak (a day claimed forty times), so a
 * share measured under it is a ceiling rather than an estimate.
 */

import { describe, expect, it } from 'vitest';

import { runCampaign } from '@/sim/campaign';
import type { RunFacts } from '@/sim/campaign';
import { runsPerPurchase } from '@/sim/campaignReport';
import type { MissionsState } from '@/data';

import { creditKills, emptyKills } from '../bestiary';
import { applyMissions, rollMissions } from '../missions';
import { streakBonus } from '../streak';

const SEEDS = [1, 2, 3];

/** Three campaigns of sixty-odd runs each. Well past vitest's default, not a hang. */
const CAMPAIGN_TIMEOUT_MS = 600_000;

/** docs/18's curve, the band the prices are tuned against (D46). */
const EARLY = { from: 1, to: 5, target: 2, tolerance: 0.7 };
const LATER = { from: 6, to: 10, target: 4, tolerance: 1.5 };

/** The plan's ceiling: the meta layer stays a garnish on what the road pays. */
const META_SHARE_CEILING = 0.25;

/** `expect` on a labelled string, so a failure names the number that broke. */
function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

interface MetaTotals {
  missions: number;
  tiers: number;
  streak: number;
}

/**
 * One player's whole meta layer, stepped a run at a time, through the shipped
 * rules. The returned function is what `runCampaign` calls after every run.
 */
function metaPurse(into: MetaTotals): (facts: RunFacts, level: number) => number {
  let missions: MissionsState = { active: [], rolled: 0 };
  let kills = emptyKills();
  let owned: string[] = [];
  let level = 0;
  let day = 0;
  return (facts, at) => {
    let coins = 0;
    if (at !== level) {
      level = at;
      day += 1;
      missions = rollMissions(missions) ?? missions;
      const bonus = streakBonus(day);
      into.streak += bonus;
      coins += bonus;
    }
    const outcome = applyMissions(missions, facts);
    missions = outcome.missions;
    into.missions += outcome.coins;
    coins += outcome.coins;

    const credited = creditKills(kills, facts.kills, owned);
    kills = credited.kills;
    owned = [...owned, ...credited.unlocked];
    into.tiers += credited.coins;
    return coins + credited.coins;
  };
}

/** Campaigns are expensive; both tests below read the same three. */
const played = SEEDS.map((seed) => {
  const totals: MetaTotals = { missions: 0, tiers: 0, streak: 0 };
  const result = runCampaign({ bot: 'human', seed, meta: metaPurse(totals) });
  return { seed, result, totals };
});

describe('the meta layer against the road (D51, D53)', () => {
  it('pays under a quarter of what forty levels of road pay', () => {
    for (const { seed, result, totals } of played) {
      const road = result.coinsIn;
      const share = result.coinsMeta / road;
      const where =
        `s${String(seed)} road ${String(road)} meta ${String(result.coinsMeta)}` +
        ` (missions ${String(totals.missions)}, tiers ${String(totals.tiers)},` +
        ` streak ${String(totals.streak)}) = ${(share * 100).toFixed(0)}%`;
      // Printed as well as asserted: what share of a campaign the meta layer
      // pays is a number the milestone log wants written down, and it moves
      // whenever a mission reward or a bestiary rung does.
      console.log(where);
      expectTrue(where, share <= META_SHARE_CEILING);
      // Every one of the three pays something: a stream that never fires is a
      // screen the player is shown for nothing.
      expectTrue(`${where} missions`, totals.missions > 0);
      expectTrue(`${where} tiers`, totals.tiers > 0);
      expectTrue(`${where} streak`, totals.streak > 0);
      // ...and none of the three is the income on its own.
      for (const part of [totals.missions, totals.tiers, totals.streak]) {
        expectTrue(`${where} part ${String(part)}`, part <= road * 0.12);
      }
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('leaves the runs-per-purchase curve where D46 put it', () => {
    for (const band of [EARLY, LATER]) {
      let total = 0;
      for (const { result } of played) total += runsPerPurchase(result, band.from, band.to);
      const measured = total / played.length;
      const where =
        `L${String(band.from)}-${String(band.to)} with the meta layer on ${measured.toFixed(2)}` +
        ` (target ${String(band.target)} ± ${String(band.tolerance)})`;
      expectTrue(where, Math.abs(measured - band.target) <= band.tolerance);
    }
  }, CAMPAIGN_TIMEOUT_MS);
});
