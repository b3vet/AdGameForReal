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
