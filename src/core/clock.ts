/**
 * The device clock, and the only place in the game that reads it (D51).
 *
 * `src/sim` is deterministic and may never call `Date` or `Math.random`
 * (CLAUDE.md), so the daily streak — which is about the player's calendar and
 * nothing else — is a `src/core` concern by construction. This module is the
 * one door onto the clock: everything downstream takes a `Clock` and a test
 * pins the day by handing it a function.
 *
 * A *local* calendar day, not a 24-hour window. A run at 23:50 and a run at
 * 00:10 are two days of the streak, and two runs at 09:00 and 21:00 are one.
 * That is what a player means by "I played yesterday", and it is why the day is
 * stored as `'YYYY-MM-DD'` rather than as a timestamp: a timestamp would have to
 * be re-interpreted in whatever timezone the phone is in when it is read, and
 * a flight would then silently break a streak.
 */

/** Milliseconds since the epoch. The only shape of clock anything here takes. */
export type Clock = () => number;

/** The device's own clock. The default everywhere; tests pass their own. */
export const systemClock: Clock = () => Date.now();

/** A day key: `'YYYY-MM-DD'` in the device's timezone. */
export function dayKey(ms: number): string {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${pad4(year)}-${pad2(month)}-${pad2(day)}`;
}

/** Today, from a clock. The one call the streak actually makes. */
export function today(clock: Clock): string {
  return dayKey(clock());
}

/** True for a string this module could have written. Anything else is not a day. */
export function isDayKey(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw);
}

/**
 * Whole days from `from` to `to`; negative when `to` is the earlier one, and
 * null when either is not a day key.
 *
 * Both are read at *noon* rather than at midnight. The arithmetic is otherwise
 * a subtraction of two local midnights, and on the day a timezone shifts by an
 * hour that difference is 23 or 25 hours — which floors to 0 or 1 day at random.
 * Noon puts eleven hours of slack on either side of every boundary, which no
 * civil offset change has ever come close to.
 */
export function daysBetween(from: string, to: string): number | null {
  const a = noonOf(from);
  const b = noonOf(to);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}

function noonOf(day: string): number | null {
  if (!isDayKey(day)) return null;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const ms = new Date(year, month - 1, date, 12, 0, 0, 0).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

function pad4(value: number): string {
  return String(value).padStart(4, '0');
}
