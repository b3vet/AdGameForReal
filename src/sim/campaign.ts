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
 * it is a measuring instrument for `economy.test.ts`, which is why it may know
 * about the Academy's rooms (`academy.json`) as well as the sim.
 *
 * Its shopping rules mirror `src/core/player.ts`, the app's own copy of them,
 * because `src/sim` must not import from `src/core`. If the two ever disagree,
 * `src/core/player.ts` is the one the player actually spends through.
 */

import { createBot } from './bots';
import type { BotKind } from './bots';
import { generateLevel } from './level';
import { Run } from './Run';
import {
  emptyPlayer,
  familiarPrice,
  maxFamiliarTier,
  maxUpgradeLevel,
  nextUpgradeCost,
  progression,
  roadProgress,
  runRewards,
  staffPrices,
  upgradeIds,
} from './player';
import type { RunPayable } from './player';
import { weaponIds } from './weapons';
import { balance, levelConfig, levelCount } from '@/data';
import { academy } from '@/data/academy-types';
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

function roomOpen(room: string, player: PlayerState): boolean {
  const card = academy.rooms.find((entry) => entry.id === room);
  return player.unlockedLevel >= (card?.unlockLevel ?? 1);
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
      const cost = staffPrices(id).evolve;
      if (cost <= player.coins && (best === null || cost < best.cost)) {
        best = { kind: 'evolution', label: `${id}+`, cost };
      }
    }
  }

  if (roomOpen('sanctum', player)) {
    const tier = player.familiar.unlocked ? player.familiar.tier : 0;
    if (tier < maxFamiliarTier) {
      const next = (tier + 1) as FamiliarTier;
      const cost = familiarPrice(next);
      if (cost <= player.coins && (best === null || cost < best.cost)) {
        best = { kind: 'wisp', label: `wisp${String(next)}`, cost };
      }
    }
  }
  return best;
}

/** Mirrors `src/core/player.ts`: a purchase is a price off the purse and a field up. */
function apply(player: PlayerState, offer: Purchase): void {
  player.coins -= offer.cost;
  if (offer.kind === 'upgrade') {
    const id = upgradeIds.find((known) => known === offer.label);
    if (id !== undefined) player.upgrades[id] = Math.min(maxUpgradeLevel, player.upgrades[id] + 1);
    return;
  }
  if (offer.kind === 'wisp') {
    const tier = player.familiar.unlocked ? player.familiar.tier : 0;
    player.familiar = { unlocked: true, tier: Math.min(maxFamiliarTier, tier + 1) as FamiliarTier };
    return;
  }
  const id = weaponIds.find((known) => offer.label.startsWith(known));
  if (id === undefined) return;
  if (offer.kind === 'staff') {
    player.staffs[id] = { unlocked: true, tier: 1 };
    player.selectedStaff = id;
  } else {
    player.staffs[id] = { unlocked: true, tier: 2 };
  }
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

  const player = emptyPlayer();
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
        apply(player, offer);
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

/**
 * Runs per purchase over a band of levels: the number the prices are tuned
 * against. Infinity when the band bought nothing at all.
 */
export function runsPerPurchase(result: CampaignResult, from: number, to: number): number {
  const runs = result.runs.filter((run) => run.level >= from && run.level <= to);
  const bought = runs.reduce((total, run) => total + run.purchases.length, 0);
  return bought === 0 ? Infinity : runs.length / bought;
}

function loadoutLine(held: Loadout): string {
  const levels = upgradeIds.map((id) => String(held.upgrades[id])).join('');
  const extras = [...held.staffs, ...held.evolved.map((id) => `${id}+`)];
  if (held.wispTier > 0) extras.push(`wisp${String(held.wispTier)}`);
  return `${levels}${extras.length > 0 ? ` ${extras.join(' ')}` : ''}`;
}

/** The campaign table, for the `TUNE=1` readout and the milestone report. */
export function formatCampaign(result: CampaignResult): string[] {
  const lines: string[] = [];
  lines.push(`campaign bot=${result.bot} seed=${String(result.seed)}`);
  lines.push('L   runs  coins in  coins out  buys  runs/buy  held (dmg/rate/start/gate/boss)');
  for (const level of result.levels) {
    lines.push(
      `${String(level.level).padStart(2)}  ${String(level.runs).padStart(4)}` +
        `  ${String(level.coinsIn).padStart(8)}  ${String(level.coinsOut).padStart(9)}` +
        `  ${String(level.purchases).padStart(4)}` +
        `  ${(level.rolling === Infinity ? '-' : level.rolling.toFixed(2)).padStart(8)}` +
        `  ${loadoutLine(level.held)}`,
    );
  }
  lines.push(
    `runs/purchase L1-5 ${runsPerPurchase(result, 1, 5).toFixed(2)}` +
      `  L6-10 ${runsPerPurchase(result, 6, 10).toFixed(2)}` +
      `  L11-15 ${runsPerPurchase(result, 11, 15).toFixed(2)}` +
      `  L16-20 ${runsPerPurchase(result, 16, 20).toFixed(2)}`,
  );
  lines.push(`coins in ${String(result.coinsIn)} out ${String(result.coinsOut)}`);
  for (const level of [5, 10, 15, 20]) {
    const report = result.levels.find((entry) => entry.level === level);
    if (report !== undefined) lines.push(`held at L${String(level)}: ${loadoutLine(report.held)}`);
  }
  return lines;
}
