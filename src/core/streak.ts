/**
 * The daily streak (D51).
 *
 * The rule is one sentence: a *finished* run — won or lost, campaign or endless
 * — on a calendar day the player has not yet finished one on advances the
 * streak; a day skipped entirely resets it to 1; a second run on the same day
 * changes nothing. It is deliberately not "open the app": a streak the player
 * can claim by launching and closing the game is a notification, not a game,
 * and this one is paid for by playing.
 *
 * Nothing here reads the clock — `./clock.ts` does, once, and hands the day in —
 * so every case below is a pure function of two strings and testable without
 * pinning a machine's timezone.
 */

import { missions as missionsData } from '@/data';
import type { StreakState } from '@/data';

import { daysBetween } from './clock';

/** What one finished run did to the streak. */
export interface StreakStep {
  streak: StreakState;
  /** Coins the new day is worth; 0 for a second run on the same day. */
  coins: number;
  /** True when this run was the first of a new day. */
  advanced: boolean;
  /** True when a skipped day sent the count back to 1. */
  reset: boolean;
}

/**
 * Coins a streak of `days` is worth on the day it is claimed: `perDay` a day to
 * a cap, so the habit is worth something from day one and a hundred-day streak
 * is not an income (the plan's "sized so the campaign's runs-per-purchase bands
 * hold"). Provisional numbers: Phase D sizes them.
 */
export function streakBonus(days: number): number {
  const tuning = missionsData.streak;
  const count = Math.max(0, Math.floor(days));
  return Math.min(Math.round(tuning.cap), Math.round(tuning.perDay * count));
}

/** The most a single day can pay, for the copy that says so. */
export function streakCap(): number {
  return Math.round(missionsData.streak.cap);
}

/**
 * Advances the streak for a run finished on `day`.
 *
 * The four cases, in the order they are tested:
 *
 *   already today     nothing at all, and no coins. The day is claimed.
 *   yesterday         day n + 1.
 *   longer ago        back to day 1. A miss costs the streak, not the habit.
 *   never, or junk    day 1. An empty or unparseable `lastDay` is a new player
 *                     or a hand-edited save, and both start at the beginning.
 *
 * A `lastDay` in the *future* — the player moved the phone's clock back, or
 * crossed the date line westward — is treated as "longer ago" and resets, which
 * is the conservative reading: it can cost a streak but it can never mint coins.
 */
export function advanceStreak(streak: StreakState, day: string): StreakStep {
  const days = Math.max(0, Math.floor(streak.days));
  if (streak.lastDay === day && days > 0) {
    return { streak, coins: 0, advanced: false, reset: false };
  }

  const gap = daysBetween(streak.lastDay, day);
  const continued = gap === 1 && days > 0;
  const next = continued ? days + 1 : 1;
  return {
    streak: { days: next, lastDay: day },
    coins: streakBonus(next),
    advanced: true,
    reset: !continued && days > 1,
  };
}

/** What the title screen shows (D51: "the streak on the title"). */
export interface StreakView {
  days: number;
  /** True when a run has already finished today, so the bonus is spent. */
  claimedToday: boolean;
  /** Coins the *next* finished run pays: today's if unclaimed, tomorrow's if not. */
  nextBonus: number;
  /** The ceiling one day can pay, so the copy can say "of {cap}". */
  cap: number;
}

export function streakView(streak: StreakState, day: string): StreakView {
  const days = Math.max(0, Math.floor(streak.days));
  const claimedToday = streak.lastDay === day && days > 0;
  // What the next finished run would pay, which is the number worth showing:
  // claimed today, that run is tomorrow's, and tomorrow is only day + 1 if
  // tomorrow is actually the next day — which it is, by definition.
  const step = claimedToday ? days + 1 : advanceStreak(streak, day).streak.days;
  return { days, claimedToday, nextBonus: streakBonus(step), cap: streakCap() };
}
