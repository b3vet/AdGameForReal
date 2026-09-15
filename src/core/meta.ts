/**
 * One finished run, applied to the meta layer (D51 to D53).
 *
 * `AcademyController.payRun` pays the road (D46) and then calls in here for
 * everything the road does *not* pay: the day's streak, the missions the run
 * moved, the bestiary rungs it crossed, the tints those hand over, the level's
 * best walk and the endless record. Keeping it in one pure function means the
 * whole of "what a run is worth to the meta layer" can be tested without a
 * storage, a clock or a DOM — the day arrives as a string and the player
 * arrives as a value.
 *
 * One clone, then fields. Every rule below could be written as a pure step
 * returning a new player, and each would copy a save-sized object for the sake
 * of purity inside a function that is already pure at its edges.
 */

import type { LevelBest } from '@/data';

import { creditKills } from './bestiary';
import type { TierAward } from './bestiary';
import { applyMissions } from './missions';
import type { MissionView, RunTally } from './missions';
import { clonePlayer } from './player';
import type { PlayerState } from './player';
import { advanceStreak } from './streak';
import type { StreakStep } from './streak';

/** What the run was, as the meta layer needs to see it. */
export interface RunOutcome {
  /** The campaign level index walked, or 0 for an endless run (D52). */
  level: number;
  tally: RunTally;
}

/** Everything one finished run changed, for the result sheet to read out. */
export interface MetaPayout {
  player: PlayerState;
  /** Coins the meta layer paid on top of the road's own reward. */
  coins: number;
  /** Coins by source, so the sheet can name them. */
  streakCoins: number;
  missionCoins: number;
  tierCoins: number;
  streak: StreakStep;
  /** Missions that crossed their target on this run; already paid. */
  completed: MissionView[];
  awards: TierAward[];
  /** Cosmetic ids the rungs handed over, newly owned. */
  unlocked: string[];
  /** The level's best walk after this run, or null for an endless run. */
  levelBest: LevelBest | null;
  /** True when this run set that best. */
  bestImproved: boolean;
  /** True when this endless run went further than any before it. */
  endlessBest: boolean;
}

/**
 * Applies a finished run.
 *
 * `day` is a local calendar day from `./clock.ts` and is the only thing in here
 * the device clock touches: the sim never sees it, and a test pins it by
 * passing a string (D51).
 */
export function applyRunMeta(
  player: PlayerState,
  outcome: RunOutcome,
  day: string,
): MetaPayout {
  const next = clonePlayer(player);
  const tally = outcome.tally;

  // The streak first: it is the only part that does not care what the run did,
  // only that one finished today.
  const streak = advanceStreak(player.streak, day);
  next.streak = streak.streak;

  const missions = applyMissions(player.missions, tally);
  next.missions = missions.missions;

  const kills = creditKills(player.kills, tally.kills, player.cosmetics.owned);
  next.kills = kills.kills;

  // Already filtered to ids the manifest knows and the player does not own
  // (`creditKills`), so this is an append and not a merge.
  const unlocked = kills.unlocked;
  if (unlocked.length > 0) next.cosmetics.owned = [...next.cosmetics.owned, ...unlocked];

  const coins = streak.coins + missions.coins + kills.coins;
  next.coins = Math.max(0, Math.round(next.coins + coins));

  // The best walk of a level is a *cleared* one: a wipe at the last row brought
  // nobody to the end, so it is not a walk of that road at all (the picker's
  // star, Phase C).
  let levelBest: LevelBest | null = null;
  let bestImproved = false;
  if (!tally.endless && tally.cleared && outcome.level >= 1) {
    const key = String(Math.floor(outcome.level));
    const previous = player.levelBest[key] ?? null;
    const candidate: LevelBest = { survivors: tally.survivors, peak: tally.peak };
    bestImproved = previous === null || better(candidate, previous);
    levelBest = bestImproved ? candidate : previous;
    if (bestImproved) next.levelBest[key] = candidate;
  }

  let endlessBest = false;
  if (tally.endless) {
    const metres = Math.max(0, Math.floor(tally.metres));
    endlessBest = metres > player.endless.bestMetres;
    next.endless = {
      bestMetres: Math.max(player.endless.bestMetres, metres),
      runs: Math.max(0, Math.floor(player.endless.runs)) + 1,
    };
  }

  return {
    player: next,
    coins,
    streakCoins: streak.coins,
    missionCoins: missions.coins,
    tierCoins: kills.coins,
    streak,
    completed: missions.completed,
    awards: kills.awards,
    unlocked,
    levelBest,
    bestImproved,
    endlessBest,
  };
}

/**
 * Survivors first, peak as the tie-break. The number on the result sheet is
 * the crowd that arrived, so that is what a "best" means; the peak only
 * separates two runs that arrived with the same crowd.
 */
function better(candidate: LevelBest, previous: LevelBest): boolean {
  if (candidate.survivors !== previous.survivors) {
    return candidate.survivors > previous.survivors;
  }
  return candidate.peak > previous.peak;
}

/**
 * The share of the crowd a walk has to arrive with to earn the picker's star
 * (D45's own band: a good player ends with 35 to 65 percent of peak, so the
 * star is the top of it).
 *
 * Here rather than beside either of its two readers, because there are two —
 * the picker's marks (`./academy.ts`) and the result sheet's (`./resultView.ts`)
 * — and a star the sheet promised that the picker then did not draw is exactly
 * the kind of disagreement one copy of a number cannot have.
 */
const STAR_SHARE = 0.6;

/** True when this best walk earns the star. Null — a level never cleared — does not. */
export function earnsStar(best: LevelBest | null): boolean {
  return best !== null && best.peak > 0 && best.survivors >= best.peak * STAR_SHARE;
}
