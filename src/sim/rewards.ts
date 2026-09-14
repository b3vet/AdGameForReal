/**
 * What a finished run pays (D46, extended by D52).
 *
 * Split out of `./player.ts` in Milestone 8 on the seam that file already had:
 * everything left there is what the Academy *sells* — prices, tiers, purchases,
 * and the multipliers a purchase resolves to — and this is what the road
 * *pays*. Endless put the two on different sides of a rule (a road with no
 * level index, paid by distance under a cap read off the campaign), and
 * `player.ts` was at the file-size budget (CLAUDE.md).
 *
 * Pure arithmetic over `progression.json` and `endless.json`: no run, no state,
 * nothing that can be played.
 */

import { progression } from './progression';
import { endless as endlessConfig } from '@/data';

/** What a run's own state has to carry for `runRewards` to price it. */
export interface RunPayable {
  status: string;
  survivors: number;
  /** Where the squad got to; a `RunState` always has it, a fixture may not. */
  squad?: { z: number };
  arenaZ?: number;
  /**
   * Set on an endless run and on nothing else (D52). Its presence is what
   * switches the pay from "what did you clear" to "how far did you get", so a
   * campaign run can never accidentally be paid by distance.
   */
  endless?: { metres: number };
}

/** Anything a payment needs that is not on the run itself. */
export interface RewardContext {
  /**
   * The highest campaign level this player has *cleared*. Endless is paid
   * under a repeat clear of it (D52), so a player who has only walked level 3
   * cannot farm the endless road for level-40 money. Defaults to 1.
   */
  bestLevel?: number;
}

/**
 * How far up the road a run got, 0 to 1. The squad stops at `arenaZ` to fight
 * the boss, so a run that died to the boss reads 1 and one that died at the
 * second gate row reads a tenth.
 *
 * A state without a position — the hand-made ones in tests and fixtures —
 * reads 0, which is what keeps `runRewards` paying nothing for a loss that
 * cannot say how far it got.
 */
export function roadProgress(state: RunPayable): number {
  const z = state.squad?.z;
  const arenaZ = state.arenaZ;
  if (z === undefined || arenaZ === undefined || arenaZ <= 0) return 0;
  return Math.min(1, Math.max(0, z / arenaZ));
}

/** What another clear of `level` pays, before survivors and the first-clear bonus. */
export function repeatClearValue(level: number): number {
  const rewards = progression.rewards;
  return rewards.perClear * Math.pow(Math.max(1, Math.floor(level)), rewards.levelExponent);
}

/**
 * Ceiling on what one endless run may pay (D52): a share of a *repeat* clear of
 * the player's best campaign level.
 *
 * Measured against the repeat clear rather than the first one for the same
 * reason a loss is (`runRewards` below): the first clear of a level happens
 * once and the endless road can be walked all evening, so anything measured
 * against the bonus would eventually out-earn the campaign it is meant to sit
 * under.
 */
export function endlessCap(bestLevel: number): number {
  return endlessConfig.capShare * repeatClearValue(bestLevel);
}

/**
 * Coins a *finished* run pays (D46).
 *
 * The road pays for clearing it, not for the size of the crowd that walked it:
 * `perClear` on any clear and `firstClear` again the first time, both scaled by
 * the level index through `levelExponent`, plus a token `perSurvivor` so the
 * count on the result screen still means something. Before D46 the survivors
 * *were* the payment, which paid a fat gate rather than a finished level.
 *
 * A loss pays `lossShare` of what another clear of this level would pay, scaled
 * by how far up the road it got: dying to the boss is nearly the whole share
 * and dying in the first ten metres is nearly nothing. That is what makes a
 * milestone level (D45) a few runs of grinding rather than a wall — and it is
 * deliberately measured against a *repeat* clear, so that losing over and over
 * can never out-earn clearing the level and moving on.
 *
 * An endless run is paid by distance instead (D52), whether it ended on the
 * wipe or on the road's end: `coinsPerMetre` a metre, capped at `capShare` of a
 * repeat clear of `context.bestLevel`. Under the campaign's own rate by
 * construction, so level progress stays the earner however long a run lasts.
 *
 * A run that is still going pays nothing, and that is a rule rather than a
 * guard. `survivors` tracks the live squad while a run is under way, so paying
 * on it would make "walk into a fat gate, then leave" worth more than finishing
 * the level. Nothing in the app can leave a run today — the HUD has no way out
 * — but the rule belongs here, with the arithmetic, rather than in whichever
 * screen grows one first.
 */
export function runRewards(
  state: RunPayable,
  level: number,
  firstClear: boolean,
  context: RewardContext = {},
): { coins: number } {
  if (state.status === 'running') return { coins: 0 };

  const distance = state.endless;
  if (distance !== undefined) {
    const metres = Math.max(0, distance.metres);
    const cap = endlessCap(Math.max(1, Math.floor(context.bestLevel ?? 1)));
    return { coins: Math.round(Math.min(cap, metres * endlessConfig.coinsPerMetre)) };
  }

  const rewards = progression.rewards;
  const clearValue = repeatClearValue(level);

  if (state.status !== 'won') {
    return { coins: Math.round(clearValue * rewards.lossShare * roadProgress(state)) };
  }

  let coins = clearValue + Math.max(0, Math.floor(state.survivors)) * rewards.perSurvivor;
  if (firstClear) {
    coins += rewards.firstClear * Math.pow(Math.max(1, Math.floor(level)), rewards.levelExponent);
  }
  return { coins: Math.round(coins) };
}
