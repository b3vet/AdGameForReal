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
import {
  buyFamiliar,
  buyStaff,
  buyUpgrade,
  emptyPlayer,
  familiarCost,
  nextUpgradeCost,
  progression,
  roadProgress,
  roomOpen,
  runRewards,
  staffCost,
  staffPrices,
  upgradeIds,
} from './player';
import type { RunPayable } from './player';
import { weaponIds } from './weapons';
import { balance, levelConfig, levelCount } from '@/data';
import type { Balance, FamiliarTier, PlayerState, UpgradeId, WeaponId } from '@/data/types';

const DT = 1 / 60;

/** A run longer than this is a stalemate and counts as a loss, as in the harness. */
const MAX_SECONDS = 240;

/** How many attempts a level gets before the campaign gives up on it. */
const MAX_ATTEMPTS = 12;

/** Runs the rolling runs-per-purchase figure looks back over. */
const ROLLING_WINDOW = 5;

export type PurchaseKind = 'upgrade' | 'staff' | 'evolution' | 'wisp';

export interface Purchase {
  kind: PurchaseKind;
  /** What the row would read: `damage`, `storm`, `storm+`, `wisp2`. */
  label: string;
  cost: number;
}

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
}

/** Everything the player is carrying, for the report. */
export interface Loadout {
  upgrades: Record<UpgradeId, number>;
  /** Staffs owned beyond the starting ember. */
  staffs: WeaponId[];
  evolved: WeaponId[];
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
  coinsIn: number;
  coinsOut: number;
}

export interface CampaignOptions {
  /** Which bot plays it. `human` is the one the bands are defined on (D45). */
  bot?: BotKind;
  seed?: number;
  /** Levels to play, 1..`levels`. */
  levels?: number;
  /**
   * The tuning the runs are built on, and that the bot steers by. Defaults to
   * the shipped `balance.json`; a caller measuring a change passes its own copy
   * rather than editing the shared object under everyone else.
   */
  tuning?: Balance;
}

/** What one attempt left behind: exactly what `runRewards` prices, plus one number. */
interface Attempt extends RunPayable {
  status: 'won' | 'lost';
  squad: { z: number };
  arenaZ: number;
  /** Share of the run spent fighting the boss; the shopper prices `bossDamage` on it. */
  bossShare: number;
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
  while (run.state.status === 'running' && steps < maxSteps) {
    run.setTargetX(bot(run.state));
    run.tick(DT);
    steps++;
    if (bossStart < 0 && run.state.boss?.active === true) bossStart = steps;
  }

  const state = run.state;
  return {
    status: state.status === 'won' ? 'won' : 'lost',
    survivors: state.survivors,
    squad: { z: state.squad.z },
    arenaZ: state.arenaZ,
    bossShare: bossStart < 0 ? 0 : (steps - bossStart) / Math.max(1, steps),
  };
}

/**
 * What one more level of an upgrade is worth, as a share of the squad's output,
 * so the shopper can compare five rows that are priced the same. Read off
 * `progression.json` and the run just played rather than a table of tastes:
 * `startCount` is one unit against the units the level starts with, and
 * `bossDamage` only counts for the share of the run that was the boss fight.
 */
function upgradeWorth(id: UpgradeId, startCount: number, bossShare: number): number {
  const effects = progression.upgrades.effects;
  if (id === 'startCount') return effects.startCount / Math.max(1, startCount);
  if (id === 'bossDamage') return effects.bossDamage * bossShare;
  return effects[id];
}

/**
 * The most useful thing the Academy will sell this player right now, in the
 * order a player climbs the ladder: best value per coin in the yard, then a
 * second staff, then the big-ticket evolutions and wisp tiers. Null when
 * nothing on the shelf is affordable — which is what makes a runs-per-purchase
 * figure bigger than one possible.
 */
function bestOffer(player: PlayerState, startCount: number, bossShare: number): Purchase | null {
  let best: Purchase | null = null;
  let bestValue = 0;
  for (const id of upgradeIds) {
    const cost = nextUpgradeCost(player, id);
    if (cost === null || cost > player.coins) continue;
    const value = upgradeWorth(id, startCount, bossShare) / cost;
    if (value > bestValue) {
      bestValue = value;
      best = { kind: 'upgrade', label: id, cost };
    }
  }
  if (best !== null) return best;

  if (roomOpen('workbench', player)) {
    for (const id of weaponIds) {
      if (player.staffs[id].unlocked) continue;
      const cost = staffPrices(id).unlock;
      if (cost <= player.coins && (best === null || cost < best.cost)) {
        best = { kind: 'staff', label: id, cost };
      }
    }
    if (best !== null) return best;

    for (const id of weaponIds) {
      const staff = player.staffs[id];
      if (!staff.unlocked || staff.tier >= 2) continue;
      // The same price the Workbench would show for this staff's next step,
      // which at tier 1 is its evolution.
      const cost = staffCost(player, id);
      if (cost !== null && cost <= player.coins && (best === null || cost < best.cost)) {
        best = { kind: 'evolution', label: `${id}+`, cost };
      }
    }
  }

  if (roomOpen('sanctum', player)) {
    const cost = familiarCost(player);
    if (cost !== null && cost <= player.coins && (best === null || cost < best.cost)) {
      const next = ((player.familiar.unlocked ? player.familiar.tier : 0) + 1) as FamiliarTier;
      best = { kind: 'wisp', label: `wisp${String(next)}`, cost };
    }
  }
  return best;
}

/**
 * Takes the offer through the shipped purchase rules, or null if they refuse.
 *
 * A refusal is not expected — `bestOffer` only ever names something the same
 * rules priced and the purse can cover — and that is exactly why it is passed
 * on rather than swallowed: if the shopping above and the rules below ever
 * disagree, the campaign stalls on the spot and `economy.test.ts` sees it,
 * instead of quietly measuring an economy nobody can buy.
 */
function buy(player: PlayerState, offer: Purchase): PlayerState | null {
  if (offer.kind === 'upgrade') {
    const id = upgradeIds.find((known) => known === offer.label);
    return id === undefined ? null : buyUpgrade(player, id);
  }
  if (offer.kind === 'wisp') return buyFamiliar(player);
  const id = weaponIds.find((known) => offer.label.startsWith(known));
  return id === undefined ? null : buyStaff(player, id);
}

function loadoutOf(player: PlayerState, purchases: number, spent: number): Loadout {
  return {
    upgrades: { ...player.upgrades },
    staffs: weaponIds.filter((id) => player.staffs[id].unlocked && id !== 'ember'),
    evolved: weaponIds.filter((id) => player.staffs[id].unlocked && player.staffs[id].tier >= 2),
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
      player.coins += coins;
      coinsIn += coins;
      earned += coins;
      won = result.status === 'won';
      if (won) player.unlockedLevel = Math.max(player.unlockedLevel, Math.min(levelCount, level + 1));

      const startCount = generateLevel(level, levelConfig(level), runSeed, player).startCount;
      const made: Purchase[] = [];
      for (;;) {
        const offer = bestOffer(player, startCount, bossShare);
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

  return { bot: kind, seed, runs, levels: reports, player, coinsIn: earned, coinsOut: spent };
}
