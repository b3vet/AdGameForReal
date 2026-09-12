/**
 * The affordance contract (docs/12-milestone-4-plan.md, definition of done 2):
 * the upgrades a player can afford after clearing levels 1 to N once each must
 * make level N+3 clearable.
 *
 * Modelled with the greedy bot as the player and a greedy wallet: after every
 * clear the coins go on the cheapest thing the Academy will sell, over and over
 * while the money lasts. It is the *worst* sensible shopper — no saving up for
 * the wisp, no picking the upgrade that suits the next level — so a campaign
 * that passes here passes for anyone who thinks about it.
 *
 * Staff unlocks are deliberately not bought: a second staff is a sidegrade the
 * player chooses for a level's shape (D26), not a step up the ladder, and the
 * ladder is what this test is about.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { generateLevel } from '../level';
import {
  emptyPlayer,
  familiarPrice,
  maxFamiliarTier,
  maxUpgradeLevel,
  nextUpgradeCost,
  runRewards,
  staffPrices,
  upgradeIds,
} from '../player';
import { Run } from '../Run';
import { weaponIds } from '../weapons';
import { balance, levelConfig } from '@/data';
import type { FamiliarTier, PlayerState } from '@/data/types';

const DT = 1 / 60;
const MAX_STEPS = Math.round(240 / DT);

/** The seed the modelled player's campaign is played on. */
const CAMPAIGN_SEED = 1;

/** Seeds level N+3 is then checked on. */
const CHECK_SEEDS = [1, 2, 3];

interface Outcome {
  won: boolean;
  survivors: number;
  peakCount: number;
}

function playLevel(index: number, seed: number, player?: PlayerState): Outcome {
  const level = generateLevel(index, levelConfig(index), seed, player);
  const run = new Run(level, balance, player);
  const bot = createBot('greedy', seed * 7919 + index);
  let steps = 0;
  while (run.state.status === 'running' && steps < MAX_STEPS) {
    run.setTargetX(bot(run.state));
    run.tick(DT);
    steps++;
  }
  return {
    won: run.state.status === 'won',
    survivors: run.state.survivors,
    peakCount: run.state.peakCount,
  };
}

interface Purchase {
  cost: number;
  buy: () => void;
}

/** Everything the Academy would sell this player right now, cheapest first. */
function offers(player: PlayerState): Purchase[] {
  const list: Purchase[] = [];

  for (const id of upgradeIds) {
    const cost = nextUpgradeCost(player, id);
    if (cost === null) continue;
    list.push({
      cost,
      buy: () => {
        player.upgrades[id] = Math.min(maxUpgradeLevel, player.upgrades[id] + 1);
      },
    });
  }

  for (const id of weaponIds) {
    const staff = player.staffs[id];
    if (!staff.unlocked || staff.tier === 2) continue;
    list.push({
      cost: staffPrices(id).evolve,
      buy: () => {
        player.staffs[id] = { unlocked: true, tier: 2 };
      },
    });
  }

  if (player.familiar.tier < maxFamiliarTier) {
    const next = (player.familiar.tier + 1) as FamiliarTier;
    list.push({
      cost: familiarPrice(next),
      buy: () => {
        player.familiar = { unlocked: true, tier: next };
      },
    });
  }

  list.sort((a, b) => a.cost - b.cost);
  return list;
}

/** Spends until nothing on the shelf is affordable. */
function spend(player: PlayerState): void {
  for (;;) {
    const affordable = offers(player).find((offer) => offer.cost <= player.coins);
    if (affordable === undefined) return;
    player.coins -= affordable.cost;
    affordable.buy();
  }
}

/** A player who has cleared 1..n once each and spent everything they earned. */
function afterClearing(n: number): PlayerState {
  const player = emptyPlayer();
  for (let level = 1; level <= n; level++) {
    const result = playLevel(level, CAMPAIGN_SEED, player);
    expect(`L${String(level)} cleared: ${String(result.won)}`).toBe(`L${String(level)} cleared: true`);
    player.coins += runRewards(
      { status: result.won ? 'won' : 'lost', survivors: result.survivors },
      level,
      true,
    ).coins;
    player.unlockedLevel = Math.max(player.unlockedLevel, level + 1);
    spend(player);
  }
  return player;
}

describe('upgrade affordance', () => {
  it('makes level N+3 clearable with what clearing 1..N pays for', () => {
    for (const n of [3, 6, 9, 12, 15]) {
      const player = afterClearing(n);
      const target = n + 3;
      // Something was actually bought, or the test would prove nothing.
      const bought = upgradeIds.reduce((total, id) => total + player.upgrades[id], 0);
      expect(`N=${String(n)} upgrades bought: ${String(bought > 0)}`).toBe(
        `N=${String(n)} upgrades bought: true`,
      );

      for (const seed of CHECK_SEEDS) {
        const where = `N=${String(n)} L${String(target)} s${String(seed)}`;
        expect(`${where}: ${String(playLevel(target, seed, player).won)}`).toBe(`${where}: true`);
      }
    }
  }, 300_000);

  it('leaves the upgraded player better off than the one who bought nothing', () => {
    // The bands are defined for a player with nothing (D35); this is the other
    // half of that promise — the money has to buy something you can feel.
    const player = afterClearing(9);
    let upgraded = 0;
    let plain = 0;
    for (const seed of CHECK_SEEDS) {
      upgraded += playLevel(12, seed, player).survivors;
      plain += playLevel(12, seed).survivors;
    }
    expect(upgraded).toBeGreaterThan(plain);
  }, 300_000);
});
