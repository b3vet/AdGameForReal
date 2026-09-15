/**
 * The campaign simulation (D46): a bot walks the whole road with a purse, and
 * the Academy's prices are measured against how often it can buy something.
 *
 * A price is only right relative to what a run pays, and what a run pays is
 * only right relative to how many runs a purchase should take — so this file
 * plays the real sim, pays the real `runRewards`, shops the real prices, and
 * reports the number the owner asked for: runs per purchase (two early, four
 * by level 10).
 *
 * Pure and deterministic like the rest of `src/sim`, and imported by no screen:
 * it is a measuring instrument for `economy.test.ts`.
 *
 * It shops through the *shipped* purchase rules — `buyUpgrade`, `buyStaff`,
 * `buyFamiliar` in `./player.ts`, which `src/core/player.ts` also delegates to
 * — so the economy it measures is the one the player spends through. Until the
 * Milestone 6 review it kept its own copy of them, because `src/sim` may not
 * import from `src/core` and those rules lived there; two copies of "what a
 * purchase does" is two economies, and only one of them was ever tuned.
 *
 * What is still local is the *shopping*: which of the affordable things a
 * player would pick, and whether a room is open to sell it. That is a taste
 * rather than a rule, and the Academy has no opinion about it at all.
 */

import { createBot } from './bots';
import type { BotKind } from './bots';
import { generateLevel } from './level';
import { Run } from './Run';
import { bestOffer, buy } from './campaignShop';
import type { Purchase } from './campaignShop';
import { emptyPlayer, staffTierOf } from './player';
import { roadProgress, runRewards } from './rewards';
import type { RunPayable } from './rewards';
import { weaponIds } from './weapons';
import { balance, levelConfig, levelCount } from '@/data';
import type {
  Balance,
  FamiliarTier,
  KillKind,
  PlayerState,
  StaffTier,
  UpgradeId,
  WeaponId,
} from '@/data/types';

const DT = 1 / 60;

/** A run longer than this is a stalemate and counts as a loss, as in the harness. */
const MAX_SECONDS = 240;

/** How many attempts a level gets before the campaign gives up on it. */
const MAX_ATTEMPTS = 12;

/** Runs the rolling runs-per-purchase figure looks back over. */
const ROLLING_WINDOW = 5;

// Re-exported so `economy.test.ts` and the report read one module: the shopper
// is a separate file for the size rule (CLAUDE.md), not a separate idea.
export { bestOffer } from './campaignShop';
export type { Purchase, PurchaseKind } from './campaignShop';

/** One attempt at one level. `attempt` is 1 for the first try. */
export interface CampaignRun {
  level: number;
  attempt: number;
  won: boolean;
  /** Share of the road the squad reached, which is what a loss is paid on. */
  progress: number;
  survivors: number;
  coins: number;
  /** Bought with the coins from this run, in the order they were bought. */
  purchases: Purchase[];
  /** What the run did, for the meta layer's own income (D51, D53). */
  facts: RunFacts;
}

/** Everything the player is carrying, for the report. */
export interface Loadout {
  upgrades: Record<UpgradeId, number>;
  /** Staffs owned beyond the starting ember. */
  staffs: WeaponId[];
  /** Staffs evolved at all: staff tier 2 or better. */
  evolved: WeaponId[];
  /** Every staff's tier, 0 to 4, for the readout (D54). */
  tiers: Record<WeaponId, StaffTier>;
  wispTier: FamiliarTier;
  /** Purchases made so far, and what they cost in total. */
  purchases: number;
  spent: number;
}

export interface CampaignLevelReport {
  level: number;
  /** Attempts up to and including the first clear. */
  runs: number;
  cleared: boolean;
  coinsIn: number;
  coinsOut: number;
  purchases: number;
  /** Runs per purchase over the last `ROLLING_WINDOW` runs, or Infinity. */
  rolling: number;
  /** What the player held when they first reached this level. */
  held: Loadout;
}

export interface CampaignResult {
  bot: BotKind;
  seed: number;
  runs: CampaignRun[];
  levels: CampaignLevelReport[];
  player: PlayerState;
  /** Coins the road paid. The meta layer's own are `coinsMeta`. */
  coinsIn: number;
  coinsMeta: number;
  coinsOut: number;
}

export interface CampaignOptions {
  /** Which bot plays it. `human` is the one the bands are defined on (D45). */
  bot?: BotKind;
  seed?: number;
  /** Levels to play, 1..`levels`. */
  levels?: number;
  /**
   * Whether the shopper climbs the Workbench's evolution ladders (D54).
   *
   * False measures the other player the bands are defined on: the one who buys
   * only what the Yard, the Workbench's staffs and the Sanctum sell. "Never
   * mandatory below level 40" is a promise about *that* hand, so the Milestone
   * 6 and 7 bands are measured on it (`balance.test.ts`).
   */
  evolutions?: boolean;
  /**
   * Coins the meta layer pays for a finished run, on top of what the road pays
   * (D51, D53): the streak's day, whatever missions the run finished, whatever
   * bestiary rungs its kills crossed.
   *
   * Injected rather than computed here because every one of those rules lives
   * in `src/core` — they are counted off the events a run already emits, and
   * the sim knows nothing about them — and `src/sim` may not import from there.
   * The hook is what lets `metaIncome.test.ts` measure the campaign's cadence
   * with the *real* board and the *real* ladders in the purse, instead of with
   * a second copy of them written here.
   */
  meta?: (facts: RunFacts, level: number) => number;
  /**
   * The tuning the runs are built on, and that the bot steers by. Defaults to
   * the shipped `balance.json`; a caller measuring a change passes its own copy
   * rather than editing the shared object under everyone else.
   */
  tuning?: Balance;
}

/**
 * What one attempt did, in the vocabulary the meta layer counts in (D51, D53).
 *
 * Structurally the `RunTally` `src/core/missions.ts` builds from the same
 * events, so `metaIncome.test.ts` can put a campaign's runs through the real
 * mission board and the real bestiary ladders rather than through a second copy
 * of their rules — which is the mistake the Milestone 6 review found in the
 * purchase rules and fixed. `src/sim` may not import `src/core`, so the shape is
 * restated here and the test is what holds the two together.
 */
export interface RunFacts {
  cleared: boolean;
  /** Always false: the campaign walks numbered levels, never the endless road. */
  endless: boolean;
  survivors: number;
  peak: number;
  shieldsBroken: number;
  chargersKilled: number;
  mulGates: number;
  /** Seconds from the arena gate to the boss's death, or null if it lived. */
  bossSeconds: number | null;
  /** True when no unit was ever cut off behind a fence (D44). */
  cleanColumn: boolean;
  metres: number;
  kills: Record<KillKind, number>;
}

/** What one attempt left behind: exactly what `runRewards` prices, plus two. */
interface Attempt extends RunPayable {
  status: 'won' | 'lost';
  squad: { z: number };
  arenaZ: number;
  /** Share of the run spent fighting the boss; the shopper prices `bossDamage` on it. */
  bossShare: number;
  facts: RunFacts;
}

/** One attempt at one level, with this player's upgrades in it. */
function playAttempt(
  level: number,
  seed: number,
  player: PlayerState,
  kind: BotKind,
  tuning: Balance,
): Attempt {
  const def = generateLevel(level, levelConfig(level), seed, player);
  const run = new Run(def, tuning, player);
  const bot = createBot(kind, seed, tuning);

  let steps = 0;
  let bossStart = -1;
  const maxSteps = Math.round(MAX_SECONDS / DT);
  const facts: RunFacts = {
    cleared: false,
    endless: false,
    survivors: 0,
    peak: 0,
    shieldsBroken: 0,
    chargersKilled: 0,
    mulGates: 0,
    bossSeconds: null,
    cleanColumn: true,
    metres: 0,
    kills: { grunt: 0, brute: 0, charger: 0, shieldBrute: 0, demon: 0, rime: 0 },
  };
  const bossKind: KillKind = def.bossId === 'rime' ? 'rime' : 'demon';

  while (run.state.status === 'running' && steps < maxSteps) {
    run.setTargetX(bot(run.state));
    for (const event of run.tick(DT)) {
      if (event.type === 'enemyKilled') {
        if (event.kind !== 'boss') facts.kills[event.kind] += 1;
        continue;
      }
      if (event.type === 'shieldBreak') facts.shieldsBroken += 1;
      else if (event.type === 'gatePassed' && event.kind === 'mul') facts.mulGates += 1;
      else if (event.type === 'bossKilled') {
        facts.kills[bossKind] += 1;
        if (facts.bossSeconds === null && bossStart >= 0) {
          facts.bossSeconds = (steps - bossStart) * DT;
        }
      }
    }
    steps++;
    if (bossStart < 0 && run.state.boss?.active === true) bossStart = steps;
    if (facts.cleanColumn && hasStragglers(run.state)) facts.cleanColumn = false;
  }

  const state = run.state;
  facts.cleared = state.status === 'won';
  facts.survivors = Math.max(0, Math.floor(state.survivors));
  facts.peak = Math.max(0, Math.floor(state.peakCount));
  return {
    status: state.status === 'won' ? 'won' : 'lost',
    survivors: state.survivors,
    squad: { z: state.squad.z },
    arenaZ: state.arenaZ,
    bossShare: bossStart < 0 ? 0 : (steps - bossStart) / Math.max(1, steps),
    facts,
  };
}

/** True while any straggler group is alive; group 0 is the column itself (D44). */
function hasStragglers(state: { groups?: ReadonlyArray<{ count: number }> }): boolean {
  const groups = state.groups;
  if (groups === undefined) return false;
  for (let i = 1; i < groups.length; i++) {
    if ((groups[i]?.count ?? 0) > 0) return true;
  }
  return false;
}

function loadoutOf(player: PlayerState, purchases: number, spent: number): Loadout {
  return {
    upgrades: { ...player.upgrades },
    staffs: weaponIds.filter((id) => player.staffs[id].unlocked && id !== 'ember'),
    evolved: weaponIds.filter((id) => staffTierOf(player, id) >= 2),
    tiers: {
      ember: staffTierOf(player, 'ember'),
      storm: staffTierOf(player, 'storm'),
      frost: staffTierOf(player, 'frost'),
    },
    wispTier: player.familiar.unlocked ? player.familiar.tier : 0,
    purchases,
    spent,
  };
}

/**
 * Plays levels 1..N with one purse, retrying a level until it is cleared, and
 * spending after every run. A level that will not fall in `MAX_ATTEMPTS` ends
 * the campaign: the report says how far the bot got rather than looping.
 */
export function runCampaign(options: CampaignOptions = {}): CampaignResult {
  const kind = options.bot ?? 'greedy';
  const seed = options.seed ?? 1;
  const levels = Math.min(levelCount, options.levels ?? levelCount);
  const tuning = options.tuning ?? balance;
  const evolutions = options.evolutions ?? true;

  // Re-bound rather than mutated on the purchases, because the shipped rules
  // are pure and answer with a new state (`./player.ts`). The two fields that
  // are not purchases — the purse a run pays into and the highest level
  // reached — are still written in place: they are this simulation's own
  // bookkeeping, not something the Academy sells.
  let player = emptyPlayer();
  const runs: CampaignRun[] = [];
  const reports: CampaignLevelReport[] = [];
  let purchases = 0;
  let spent = 0;
  let earned = 0;
  let meta = 0;
  let bossShare = 0.25;

  for (let level = 1; level <= levels; level++) {
    const held = loadoutOf(player, purchases, spent);
    let attempt = 0;
    let won = false;
    let coinsIn = 0;
    let coinsOut = 0;
    let bought = 0;

    while (!won && attempt < MAX_ATTEMPTS) {
      attempt++;
      // A retry is a fresh roll of the same level's recipe, not the same road
      // walked twice. The app does play one fixed road per level, but a bot has
      // no memory of the last attempt and a player does: re-rolling is what
      // stands in for the hand that gets better, and without it one unlucky
      // roll would end the campaign the twelfth time it was replayed.
      const runSeed = seed * 7919 + level * 131 + attempt;
      const result = playAttempt(level, runSeed, player, kind, tuning);
      bossShare = result.bossShare > 0 ? result.bossShare : bossShare;

      // Every attempt at this level would be its first clear: the campaign
      // moves on the moment one wins, and never comes back to farm it.
      const { coins } = runRewards(result, level, true);
      // The meta layer's coins land in the same purse a run's do, and they are
      // counted apart so a report can say what share of the ladder they paid.
      const bonus = Math.max(0, Math.round(options.meta?.(result.facts, level) ?? 0));
      player.coins += coins + bonus;
      coinsIn += coins;
      earned += coins;
      meta += bonus;
      won = result.status === 'won';
      if (won) player.unlockedLevel = Math.max(player.unlockedLevel, Math.min(levelCount, level + 1));

      const startCount = generateLevel(level, levelConfig(level), runSeed, player).startCount;
      const made: Purchase[] = [];
      for (;;) {
        const offer = bestOffer(player, startCount, bossShare, evolutions);
        if (offer === null) break;
        const purchased = buy(player, offer);
        if (purchased === null) break;
        player = purchased;
        made.push(offer);
        purchases++;
        bought++;
        spent += offer.cost;
        coinsOut += offer.cost;
      }

      runs.push({
        level,
        attempt,
        won: result.status === 'won',
        progress: roadProgress(result),
        survivors: result.survivors,
        coins,
        purchases: made,
        facts: result.facts,
      });
    }

    const window = runs.slice(-ROLLING_WINDOW);
    const windowBought = window.reduce((total, run) => total + run.purchases.length, 0);
    reports.push({
      level,
      runs: attempt,
      cleared: won,
      coinsIn,
      coinsOut,
      purchases: bought,
      rolling: windowBought === 0 ? Infinity : window.length / windowBought,
      held,
    });
    if (!won) break;
  }

  return {
    bot: kind,
    seed,
    runs,
    levels: reports,
    player,
    coinsIn: earned,
    coinsMeta: meta,
    coinsOut: spent,
  };
}
