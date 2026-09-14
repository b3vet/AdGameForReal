/**
 * The economy contract (D46): what a run pays, and how often the road pays for
 * something in the Academy.
 *
 * A price is only right relative to what a run pays, and what a run pays is
 * only right relative to how many runs a purchase should take — so the bands
 * here are measured by driving a bot through the whole campaign with a purse
 * (`../campaign.ts`) rather than by arithmetic over `progression.json`. The
 * owner's target: an upgrade every two runs on levels 1 to 5, every four by
 * level 10 (docs/18-milestone-6-plan.md, "Economy").
 *
 * The bands are asserted on the human bot, because that is the player the
 * difficulty is defined on (D45) and because it is the one that loses: a loss
 * is a run that pays 30 percent, and the slow-down from two runs to four is
 * mostly those runs. The greedy bot clears everything first try, so its cadence
 * is measured here as a floor rather than a band — it is the fastest anyone
 * can possibly climb the ladder.
 */

import { describe, expect, it } from 'vitest';

import type { BotKind } from '../bots';
import { bestOffer, runCampaign } from '../campaign';
import { formatCampaign, runsPerPurchase } from '../campaignReport';
import type { CampaignResult } from '../campaign';
import {
  buyStaff,
  emptyPlayer,
  maxFamiliarTier,
  maxStaffTier,
  maxUpgradeLevel,
  progression,
  staffCost,
  staffPrices,
  upgradeIds,
} from '../player';
import { runRewards } from '../rewards';
import { weaponIds } from '../weapons';
import { levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

const SEEDS = [1, 2, 3, 4, 5];

/**
 * A campaign is twenty-odd runs of sixty-odd seconds of road, and this file
 * plays ten of them. Well past vitest's five-second default, and not a hang.
 */
const CAMPAIGN_TIMEOUT_MS = 300_000;

/** docs/18: two runs per purchase on levels 1 to 5, four by level 10. */
const EARLY = { from: 1, to: 5, target: 2, tolerance: 0.7 };
const LATER = { from: 6, to: 10, target: 4, tolerance: 1.5 };

const REWARDS = progression.rewards;

/** Campaigns are expensive; every test in this file reads the same ten. */
const played = new Map<string, CampaignResult>();

function campaign(bot: BotKind, seed: number): CampaignResult {
  const key = `${bot}:${String(seed)}`;
  const cached = played.get(key);
  if (cached !== undefined) return cached;
  const result = runCampaign({ bot, seed });
  played.set(key, result);
  return result;
}

/** Mean runs per purchase over a band of levels, across the seed set. */
function meanRunsPerPurchase(bot: BotKind, from: number, to: number): number {
  let total = 0;
  for (const seed of SEEDS) total += runsPerPurchase(campaign(bot, seed), from, to);
  return total / SEEDS.length;
}

/** `expect` on a labelled string, so a failure names the number that broke. */
function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

/** A finished run at `level`, `progress` of the way up a 300 m road. */
function ended(status: 'won' | 'lost' | 'running', survivors: number, progress: number) {
  return { status, survivors, squad: { z: 300 * progress }, arenaZ: 300 };
}

describe('rewards', () => {
  it('pays for clearing the road, and only a token for the crowd that walked it', () => {
    // D46: the survivors are a bonus, not the wage. Before it, a fat gate paid
    // better than a finished level.
    const clear = runRewards(ended('won', 200, 1), 5, false).coins;
    const thin = runRewards(ended('won', 20, 1), 5, false).coins;
    expectTrue(`survivor share ${String(clear - thin)} of ${String(clear)}`, clear - thin < clear * 0.2);
    expect(clear).toBeGreaterThan(thin);

    // The first clear of a level is worth more than every clear after it.
    expect(runRewards(ended('won', 200, 1), 5, true).coins).toBeGreaterThan(clear);
  });

  it('scales a clear by the level, sub-linearly', () => {
    const first = (level: number): number => runRewards(ended('won', 0, 1), level, true).coins;
    expect(first(20)).toBeGreaterThan(first(1));
    // Sub-linear on purpose: prices climb with every purchase, so pay that
    // climbed with the level would make each upgrade quicker than the last.
    expect(first(20)).toBeLessThan(first(1) * 20);
    expect(REWARDS.levelExponent).toBeGreaterThan(0);
    expect(REWARDS.levelExponent).toBeLessThan(1);
  });

  it('pays a loss a share of the clear, by how far up the road it got', () => {
    const level = 10;
    const clear = runRewards(ended('won', 0, 1), level, false).coins;
    const far = runRewards(ended('lost', 0, 0.8), level, false).coins;
    const near = runRewards(ended('lost', 0, 0.1), level, false).coins;
    const boss = runRewards(ended('lost', 0, 1), level, false).coins;

    // Past halfway it is worth something, and always less than clearing.
    expectTrue(`loss at 0.8 paid ${String(far)}`, far > 0 && far < clear);
    expect(near).toBeLessThan(far);
    expect(boss).toBeGreaterThan(far);
    // A loss at the boss is the whole share; the share itself is about 30 percent.
    expect(boss).toBe(Math.round(clear * REWARDS.lossShare));
    expect(REWARDS.lossShare).toBeGreaterThan(0.2);
    expect(REWARDS.lossShare).toBeLessThan(0.4);
  });

  it('pays nothing for a run that is still going, however big the crowd', () => {
    // `survivors` is the live squad while a run is under way, so paying on it
    // would make "walk into a fat gate, then leave" the best rate in the game.
    expect(runRewards(ended('running', 500, 0.9), 12, true).coins).toBe(0);
    // ...and nothing for a loss that cannot say how far it got.
    expect(runRewards({ status: 'lost', survivors: 0 }, 12, true).coins).toBe(0);
  });
});

describe('the campaign', () => {
  it('sells the human player an upgrade every two runs early, every four by level 10', () => {
    for (const band of [EARLY, LATER]) {
      const measured = meanRunsPerPurchase('human', band.from, band.to);
      const where =
        `L${String(band.from)}-${String(band.to)} runs per purchase ${measured.toFixed(2)}` +
        ` (target ${String(band.target)} ± ${String(band.tolerance)})`;
      expectTrue(where, Math.abs(measured - band.target) <= band.tolerance);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('never leaves the greedy player with nothing to buy, or buying every run', () => {
    // The greedy bot clears every level first try (D45), so this is the fastest
    // the ladder can be climbed: still slower than one purchase a run, and the
    // shelf never runs dry.
    for (const band of [EARLY, LATER, { from: 11, to: 20 }]) {
      const measured = meanRunsPerPurchase('greedy', band.from, band.to);
      const where = `greedy L${String(band.from)}-${String(band.to)} ${measured.toFixed(2)}`;
      expectTrue(where, measured >= 1 && Number.isFinite(measured));
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('walks the whole road on what it earns on the way', () => {
    // The affordance promise from the other side (D45): the upgrades the road
    // pays for are enough to keep walking it.
    for (const seed of SEEDS) {
      const result = campaign('human', seed);
      const reached = result.levels.length;
      expectTrue(`s${String(seed)} reached L${String(reached)}`, reached === levelCount);
      expectTrue(`s${String(seed)} spent ${String(result.coinsOut)}`, result.coinsOut > 0);
    }
  }, CAMPAIGN_TIMEOUT_MS);

  it('prices the staff evolutions and the wisp as goals, not as pocket change', () => {
    // "Multi-run goals" (docs/18): six to ten runs of a level-10 clear each.
    const clear = runRewards(ended('won', 150, 1), 10, true).coins;
    // The first rung of each staff, and every wisp tier. The two rungs above
    // it are dearer still by construction (D54, provisionally 1.6x and 2.2x),
    // and what *they* have to be worth is the tier bands in `balance.test.ts`
    // rather than a runs-per-purchase figure: nothing above the first rung is
    // meant to be bought before level 15.
    const goals = [
      ...Object.values(progression.staffs).map((staff) => staff.evolve[0] ?? 0),
      ...progression.wisp.tierPrices.slice(1),
    ];
    for (const price of goals) {
      const runs = price / clear;
      expectTrue(`${String(price)} coins is ${runs.toFixed(1)} runs`, runs >= 5 && runs <= 12);
    }
  });
});

describe('the evolution ladder (D54)', () => {
  /**
   * A player with nothing left to buy but ember's ladder: the yard bought out,
   * the wisp at its last tier, the other two staffs maxed. What the Academy
   * offers such a player is the next rung and nothing else, which is the rule
   * under test rather than the shelf's price order.
   */
  function maxed(coins: number): PlayerState {
    const player = emptyPlayer();
    for (const id of upgradeIds) player.upgrades[id] = maxUpgradeLevel;
    for (const id of weaponIds) {
      player.staffs[id] = { unlocked: true, tier: id === 'ember' ? 1 : maxStaffTier };
    }
    player.familiar = { unlocked: true, tier: maxFamiliarTier };
    player.unlockedLevel = levelCount;
    player.coins = coins;
    return player;
  }

  it('is climbed a rung at a time, in price order, after the yard', () => {
    // With the yard maxed there is nothing cheaper on the shelf, so the next
    // thing the Academy sells is the first evolution of the cheapest staff —
    // and taking it offers the second, then the third, and then nothing.
    let player = maxed(100_000);
    const bought: string[] = [];
    for (let i = 0; i < 4; i++) {
      const offer = bestOffer(player, 20, 0.25);
      if (offer === null || offer.kind !== 'evolution') break;
      bought.push(`${offer.label}@${String(offer.cost)}`);
      const next = buyStaff(player, 'ember');
      if (next === null) break;
      player = next;
    }
    const prices = staffPrices('ember').evolve;
    expect(bought).toEqual([
      `ember+2@${String(prices[0])}`,
      `ember+3@${String(prices[1])}`,
      `ember+4@${String(prices[2])}`,
    ]);
    // The top of the ladder: the Workbench has nothing left to sell for ember.
    expect(staffCost(player, 'ember')).toBeNull();
    expect(player.staffs.ember.tier).toBe(maxStaffTier);
  });

  it('never sells a rung the purse cannot cover', () => {
    // A purse one coin short of the first rung buys nothing at all, which is
    // what makes a tier a goal rather than a tick (D54).
    const short = maxed((staffPrices('ember').evolve[0] ?? 0) - 1);
    expect(bestOffer(short, 20, 0.25)).toBeNull();
    expect(buyStaff(short, 'ember')).toBeNull();
  });

  it('prices the rungs above the first as the multi-run goals they are', () => {
    // Provisional, for the balance pass (D54): 1.6x and 2.2x the first rung.
    // What has to be true here is only the shape — each dearer than the last,
    // and the whole ladder worth more than the staff that carries it.
    const clear = runRewards(ended('won', 150, 1), 10, true).coins;
    for (const id of weaponIds) {
      const ladder = staffPrices(id).evolve;
      const runs = ladder.reduce((total, price) => total + price, 0) / clear;
      expectTrue(`${id} ladder is ${runs.toFixed(1)} clears of L10`, runs >= 15 && runs <= 40);
      expect(ladder[1]).toBeGreaterThan(ladder[0]);
      expect(ladder[2]).toBeGreaterThan(ladder[1]);
    }
  });
});

/** Not a test: the campaign table the prices were tuned against. */
describe.skipIf(process.env['TUNE'] !== '1')('economy readout', () => {
  it('prints the campaign', () => {
    const lines: string[] = [];
    for (const bot of ['greedy', 'human'] as const) {
      lines.push(...formatCampaign(campaign(bot, SEEDS[0] ?? 1)));
      for (const band of [
        EARLY,
        LATER,
        { from: 11, to: 15 },
        { from: 16, to: 20 },
        { from: 21, to: 25 },
        { from: 26, to: 30 },
        { from: 31, to: 35 },
        { from: 36, to: 40 },
      ]) {
        lines.push(
          `mean over ${String(SEEDS.length)} seeds, L${String(band.from)}-${String(band.to)}: ` +
            meanRunsPerPurchase(bot, band.from, band.to).toFixed(2),
        );
      }
    }
    process.stdout.write(`${lines.join('\n')}\n`);
    expect(lines.length).toBeGreaterThan(0);
  }, CAMPAIGN_TIMEOUT_MS);
});
