/**
 * The daily streak (D51) and the clock behind it.
 *
 * The streak is the one part of the game whose behaviour is *about* the device
 * clock, so every test here pins the day by hand: `advanceStreak` takes a day
 * string, and the only thing that ever turns a timestamp into one is
 * `./clock.ts`. That split is what makes "a run at 23:50 and a run at 00:10 are
 * two days" a thing a test can assert without waiting ten minutes.
 */

import { describe, expect, it } from 'vitest';

import { missions } from '@/data';

import { dayKey, daysBetween, isDayKey, today } from '../clock';
import { advanceStreak, streakBonus, streakCap, streakView } from '../streak';

/** Local midday on a named day, so no timezone can move the date. */
function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
}

describe('the clock', () => {
  it('writes a local YYYY-MM-DD', () => {
    expect(dayKey(at(2026, 9, 14))).toBe('2026-09-14');
    expect(dayKey(at(2026, 1, 3))).toBe('2026-01-03');
  });

  it('splits a local midnight rather than a 24-hour window', () => {
    // The pair the decision names: ten minutes apart, two days of the streak.
    const late = new Date(2026, 8, 14, 23, 50, 0, 0).getTime();
    const early = new Date(2026, 8, 15, 0, 10, 0, 0).getTime();
    expect(dayKey(late)).toBe('2026-09-14');
    expect(dayKey(early)).toBe('2026-09-15');
    expect(daysBetween(dayKey(late), dayKey(early))).toBe(1);
  });

  it('counts whole days across a month and a year boundary', () => {
    expect(daysBetween('2026-09-14', '2026-09-15')).toBe(1);
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-09-14', '2026-09-14')).toBe(0);
    expect(daysBetween('2026-09-15', '2026-09-14')).toBe(-1);
  });

  it('refuses anything that is not a day', () => {
    expect(isDayKey('2026-09-14')).toBe(true);
    expect(isDayKey('yesterday')).toBe(false);
    expect(isDayKey('')).toBe(false);
    expect(isDayKey(20260914)).toBe(false);
    expect(daysBetween('', '2026-09-14')).toBeNull();
  });

  it('reads today off an injected clock', () => {
    expect(today(() => at(2026, 3, 7))).toBe('2026-03-07');
  });
});

describe('advancing the streak', () => {
  it('starts a new player at day one and pays for it', () => {
    const step = advanceStreak({ days: 0, lastDay: '' }, '2026-09-14');
    expect(step.streak).toEqual({ days: 1, lastDay: '2026-09-14' });
    expect(step.advanced).toBe(true);
    expect(step.reset).toBe(false);
    expect(step.coins).toBe(streakBonus(1));
    expect(step.coins).toBeGreaterThan(0);
  });

  it('advances on the next calendar day', () => {
    const step = advanceStreak({ days: 3, lastDay: '2026-09-13' }, '2026-09-14');
    expect(step.streak).toEqual({ days: 4, lastDay: '2026-09-14' });
    expect(step.advanced).toBe(true);
    expect(step.coins).toBe(streakBonus(4));
  });

  it('changes nothing for a second run the same day', () => {
    const before = { days: 4, lastDay: '2026-09-14' };
    const step = advanceStreak(before, '2026-09-14');
    expect(step.streak).toBe(before);
    expect(step.coins).toBe(0);
    expect(step.advanced).toBe(false);
  });

  it('resets after a skipped day', () => {
    const step = advanceStreak({ days: 9, lastDay: '2026-09-12' }, '2026-09-14');
    expect(step.streak).toEqual({ days: 1, lastDay: '2026-09-14' });
    expect(step.reset).toBe(true);
    expect(step.coins).toBe(streakBonus(1));
  });

  it('treats a day in the future as a miss rather than as money', () => {
    const step = advanceStreak({ days: 20, lastDay: '2026-10-01' }, '2026-09-14');
    expect(step.streak.days).toBe(1);
    expect(step.coins).toBe(streakBonus(1));
  });

  it('starts over on a junk lastDay', () => {
    const step = advanceStreak({ days: 5, lastDay: 'whenever' }, '2026-09-14');
    expect(step.streak).toEqual({ days: 1, lastDay: '2026-09-14' });
  });
});

describe('the bonus', () => {
  it('pays per day and stops at the cap', () => {
    const { perDay, cap } = missions.streak;
    expect(streakBonus(1)).toBe(Math.round(perDay));
    expect(streakBonus(3)).toBe(Math.round(perDay * 3));
    expect(streakBonus(1000)).toBe(Math.round(cap));
    expect(streakCap()).toBe(Math.round(cap));
    expect(streakBonus(0)).toBe(0);
  });

  it('never exceeds the cap however long the streak runs', () => {
    for (let days = 1; days < 400; days += 7) {
      expect(streakBonus(days)).toBeLessThanOrEqual(streakCap());
    }
  });
});

describe('the title view', () => {
  it('shows the count and what the next run pays', () => {
    const view = streakView({ days: 2, lastDay: '2026-09-13' }, '2026-09-14');
    expect(view.days).toBe(2);
    expect(view.claimedToday).toBe(false);
    expect(view.nextBonus).toBe(streakBonus(3));
    expect(view.cap).toBe(streakCap());
  });

  it('says the day is claimed once a run has finished on it', () => {
    const view = streakView({ days: 3, lastDay: '2026-09-14' }, '2026-09-14');
    expect(view.days).toBe(3);
    expect(view.claimedToday).toBe(true);
    // Claimed, so the number worth showing is tomorrow's.
    expect(view.nextBonus).toBe(streakBonus(4));
  });

  it('reads a fresh player as day zero', () => {
    const view = streakView({ days: 0, lastDay: '' }, '2026-09-14');
    expect(view.days).toBe(0);
    expect(view.claimedToday).toBe(false);
    expect(view.nextBonus).toBe(streakBonus(1));
  });
});
