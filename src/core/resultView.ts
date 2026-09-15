/**
 * What the result sheet is handed when a run ends.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md), on the
 * seam the sheet grew: the state machine's job is *that* a run finished, and
 * turning a finished run and its payout into the numbers on the sheet — the
 * bonus lines, the mission ticks, the best walk, the endless record — is a
 * translation with rules of its own.
 *
 * Every word comes from `academy.json` (`meta.result`) and every number comes
 * from the payout; nothing here decides what anything is worth.
 */

import { academy, fill } from '@/data/academy-types';

import type { RunPayout } from './academy';
import type { PlayerState } from './player';
import type { RunSession } from './session';
import type { ResultBonus, ResultView } from '@/ui';

/** The share of peak a walk has to arrive with to earn the picker's star. */
const STAR_SHARE = 0.6;

/**
 * The sheet for a finished run.
 *
 * `player` is the purse *after* the run, which is what the next-unlock row is
 * measured against: the sheet's question is "what can I buy now", and the
 * answer moved when this run paid out.
 */
export function resultView(
  session: RunSession,
  level: number,
  payout: RunPayout,
  levelCount: number,
  player: PlayerState,
): ResultView {
  const best = payout.best;
  return {
    levelIndex: level,
    won: session.won,
    survivors: session.state.survivors,
    peakCount: session.state.peakCount,
    coins: payout.coins,
    // What this run paid *altogether*: the road plus everything the meta layer
    // added. The purse below climbs by exactly this, so the two agree (the
    // Milestone 8 wave-one finding, carried to Phase C).
    earnedCoins: payout.coins + payout.bonusCoins,
    totalCoins: payout.totalCoins,
    firstClear: payout.firstClear,
    // The endless road has no next level to ascend to (D52).
    canAdvance: !payout.endless && level < levelCount,
    endless: payout.endless,
    metres: payout.metres,
    bestMetres: payout.bestMetres,
    endlessBest: payout.endlessBest,
    bonuses: bonusLines(payout),
    missions: payout.completed.map((mission) => ({ text: mission.text, reward: mission.reward })),
    best,
    bestImproved: payout.bestImproved,
    star: best !== null && best.peak > 0 && best.survivors >= best.peak * STAR_SHARE,
    player,
  };
}

/**
 * The coin lines under the count-up, in the order they are read: the day, then
 * what the run finished, then what it killed enough of.
 *
 * A source that paid nothing is left off rather than printed as zero — a run
 * on a day already claimed owes no streak line, and a sheet that lists three
 * zeroes teaches the player that the lines mean nothing.
 */
function bonusLines(payout: RunPayout): ResultBonus[] {
  const copy = academy.meta.result;
  const lines: ResultBonus[] = [];

  if (payout.streakCoins > 0) {
    lines.push({
      text: fill(copy.streakBonus, { days: String(payout.streak.days) }),
      coins: payout.streakCoins,
    });
  }
  for (const mission of payout.completed) {
    lines.push({ text: mission.text, coins: mission.reward });
  }
  for (const award of payout.awards) {
    const kind = academy.bestiary.entries.find((entry) => entry.id === award.kind);
    lines.push({
      text: fill(copy.tierBonus, {
        kind: kind?.name ?? award.kind,
        tier: String(award.tier),
      }),
      coins: award.coins,
      // The tint the rung handed over, which is the part the player is owed a
      // word about: the coins are in the number beside it.
      note: award.cosmeticName === '' ? '' : fill(copy.tintBonus, { name: award.cosmeticName }),
    });
  }
  return lines;
}
