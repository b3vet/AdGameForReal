/**
 * Reading a campaign: the one number the prices are tuned against, and the
 * table the `TUNE=1` readout prints.
 *
 * Split out of `./campaign.ts` for the file-size rule (CLAUDE.md), on the seam
 * that file already had: running the campaign is one thing — twelve attempts a
 * level, a purse, a shopper — and saying what came out of it is another. These
 * touch no sim and no tuning at all; they are arithmetic and `padStart` over a
 * `CampaignResult`.
 */

import type { CampaignResult, Loadout } from './campaign';
import { upgradeIds } from './player';
import { levelCount } from '@/data';

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
  // `ember+3` rather than `ember+`: there are three rungs now (D54), and which
  // one a player is standing on is the whole point of the readout.
  const extras = [...held.staffs, ...held.evolved.map((id) => `${id}+${String(held.tiers[id])}`)];
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
  // Bands of five, off the campaign's own length rather than a number written
  // here: Milestone 7 doubled it and would have to have been remembered twice.
  const bands: string[] = [];
  for (let from = 1; from <= levelCount; from += 5) {
    const to = Math.min(levelCount, from + 4);
    bands.push(`L${String(from)}-${String(to)} ${runsPerPurchase(result, from, to).toFixed(2)}`);
  }
  lines.push(`runs/purchase ${bands.join('  ')}`);
  lines.push(`coins in ${String(result.coinsIn)} out ${String(result.coinsOut)}`);
  for (const level of [5, 7, 10, 15, 20, 25, 30, 35, 40]) {
    const report = result.levels.find((entry) => entry.level === level);
    if (report !== undefined) lines.push(`held at L${String(level)}: ${loadoutLine(report.held)}`);
  }
  return lines;
}
