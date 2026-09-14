/**
 * Schema for `missions.json`: the mission pool, the board's size, and the daily
 * streak's numbers (D51).
 *
 * A file of its own beside `academy-types.ts` for the same reason that one is
 * one: it is copy as much as it is tuning, and `index.ts` is the module every
 * layer imports. The streak lives here rather than in `progression.json`
 * because that file is Phase D's economy and this is Phase A's retention layer;
 * they are sized together (the plan's "mission rewards and the streak bonus
 * sized so the campaign's runs-per-purchase bands hold") but they are not the
 * same file's business.
 *
 * Numbers here are **provisional**: Phase A picked them so the board could be
 * built and tested, and Phase D sizes them against the campaign simulation.
 *
 * No behaviour here — what a `kind` counts is `src/core/missions.ts`, which is
 * also the only place that may read a sim event.
 */

import missionsJson from './missions.json';

/**
 * What a mission counts. The counting itself is `src/core/missions.ts`; this is
 * the contract between that file and the pool below.
 *
 *   clearLevel     `param` levels walked to their end. Any levels, campaign only.
 *   finishWith     arrive at the end of a level with `param` apprentices alive.
 *   breakShields   `param` shields broken off Bulwarks, across runs.
 *   killChargers   `param` Rimehounds killed, across runs.
 *   noStragglers   `param` levels cleared without a single unit cut off by a
 *                  fence — the run's own crowd groups say so, not an event.
 *   bossUnder      one boss killed within `param` seconds of reaching it.
 *   mulGates       `param` multiplier sigils walked through, across runs.
 *   endlessMetres  `param` metres in a single endless run (D52).
 */
export type MissionKind =
  | 'clearLevel'
  | 'finishWith'
  | 'breakShields'
  | 'killChargers'
  | 'noStragglers'
  | 'bossUnder'
  | 'mulGates'
  | 'endlessMetres';

export interface MissionDef {
  /** Stable: it is what a save carries. Never renamed, only retired. */
  id: string;
  kind: MissionKind;
  /** What the kind above counts to. Also the board's target, except `bossUnder`. */
  param: number;
  /** Coins paid once, on the frame the mission completes. */
  reward: number;
  /** One line, in the game's voice. The number is written into it, not filled. */
  text: string;
}

/** The daily streak's tuning (D51). A day is a local calendar day. */
export interface StreakTuning {
  /** Coins per day of the streak: day 3 pays `perDay * 3`, to `cap`. */
  perDay: number;
  /** Ceiling on one day's bonus, so a long streak is a habit and not an income. */
  cap: number;
}

export interface MissionsData {
  board: {
    /** How many missions are on the board at once. Three (D51). */
    active: number;
  };
  streak: StreakTuning;
  pool: readonly MissionDef[];
}

/**
 * The cast narrows `kind`, which a `.json` import widens to `string` — the same
 * move `src/data/index.ts` makes for `levels.json`, and for the same reason: one
 * place where the file's strings become the code's unions.
 */
export const missions: MissionsData = missionsJson as MissionsData;

/** The pool entry with this id, or null. Missions are retired, not renumbered. */
export function missionDef(id: string): MissionDef | null {
  return missions.pool.find((entry) => entry.id === id) ?? null;
}
