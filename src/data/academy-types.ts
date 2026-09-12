/**
 * Schema for `academy.json`: every word the Academy screens say, the order the
 * cards are in, and which level opens each room.
 *
 * A file of its own like `audio-types.ts`, and — unlike that one — it exports
 * the typed value as well as the type. `src/data/index.ts` is where a typed
 * accessor would normally go, but Milestone 4's sim track is adding
 * `progression.json` to that same file this week (docs/12-milestone-4-plan.md,
 * "Team plan"), and a merge conflict in the one module every layer imports is
 * not worth the tidiness. Fold this into `index.ts` when both have landed.
 *
 * No prices and no multipliers here: those are the sim's tuning
 * (`progression.json`), and copy that repeats a number is copy that goes stale.
 * `{value}`, `{level}`, `{max}`, `{tier}`, `{seen}` and `{total}` are filled in
 * by the screens from the live numbers.
 *
 * Ids are plain strings rather than unions because a string in JSON widens to
 * `string`: the screens match them against the ids they know and ignore the
 * rest, which is also what makes an entry safe to add here without a code
 * change.
 */

import academyJson from './academy.json';

export interface RoomCard {
  /** `play`, `yard`, `workbench`, `sanctum` or `bestiary`. */
  id: string;
  title: string;
  /** One line under the title on the home card. */
  blurb: string;
  /** The level that opens the room; 1 is "always open". */
  unlockLevel: number;
}

export interface UpgradeCopy {
  /** An `UpgradeId` from `src/core/player.ts`. */
  id: string;
  name: string;
  /** `{value}` is the per-level amount, formatted by `unit`. */
  effect: string;
  /** `percent` prints 0.08 as "8%"; `count` prints 1 as "1". */
  unit: string;
}

export interface StaffCopy {
  /** A `WeaponId`. */
  id: string;
  name: string;
  blurb: string;
  /** What evolving it buys; shown greyed until the staff is at tier 2. */
  tier2: string;
}

export interface BestiaryCopy {
  /** An `EnemyKind` or a `LevelDef.bossId`. */
  id: string;
  name: string;
  blurb: string;
}

export interface AcademyCopy {
  home: {
    /** `{level}` — what a locked card says instead of its blurb. */
    lockedHint: string;
    /** Over the level picker's chips. */
    levelsCaption: string;
  };
  rooms: readonly RoomCard[];
  yard: {
    heading: string;
    /** `{level}` of `{max}`. */
    levelLabel: string;
    upgrades: readonly UpgradeCopy[];
  };
  workbench: {
    heading: string;
    /** The badge an already-evolved staff carries. */
    evolvedTag: string;
    staffs: readonly StaffCopy[];
  };
  sanctum: {
    heading: string;
    name: string;
    blurb: string;
    /** `{tier}` of `{max}`. */
    tierLabel: string;
    /** One line per tier, in order. */
    tiers: readonly string[];
  };
  bestiary: {
    heading: string;
    /** `{seen}` of `{total}`. */
    seenLabel: string;
    /** Shown in place of the blurb on an entry that has not been met. */
    unknown: string;
    entries: readonly BestiaryCopy[];
  };
  buttons: {
    buy: string;
    max: string;
    unlock: string;
    evolve: string;
    select: string;
    selected: string;
    bind: string;
    empower: string;
  };
  result: { firstClear: string };
}

export const academy: AcademyCopy = academyJson;

/**
 * Fills `{name}` placeholders. Missing keys are left as written, so a template
 * that outlives its data is visibly wrong rather than silently empty.
 */
export function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
