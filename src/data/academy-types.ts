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

/** One evolution rung of a staff (D54): what it is called and what it does. */
export interface StaffTierCopy {
  name: string;
  /**
   * One line, and deliberately no numbers in it: how hard a mechanic hits is
   * `balance.json`'s and moves, and copy that repeats a number goes stale.
   */
  line: string;
}

export interface StaffCopy {
  /** A `WeaponId`. */
  id: string;
  name: string;
  blurb: string;
  /**
   * The three evolutions in the order they are sold (staff tier 2, 3, 4). The
   * Workbench greys the rungs the player has not reached yet.
   */
  tiers: readonly StaffTierCopy[];
}

/**
 * One rung of a bestiary entry's kill ladder (D53). Crossing `kills` of that
 * kind pays `coins` once and hands over `cosmetic` — an id in
 * `cosmetics.json`. Three rungs per entry, rising; `src/core/bestiary.ts` is
 * what counts the kills and what guarantees a rung is paid exactly once.
 */
export interface BestiaryTier {
  kills: number;
  coins: number;
  cosmetic: string;
}

export interface BestiaryCopy {
  /** An `EnemyKind` or a `LevelDef.bossId`. */
  id: string;
  name: string;
  blurb: string;
  /**
   * The three kill tiers, in rising order. Optional in the schema so an entry
   * added without a ladder is data rather than a type error; every shipped
   * entry has one.
   */
  tiers?: readonly BestiaryTier[];
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
    /** `{tier}` of `{max}` — where a staff stands on its four-rung ladder. */
    tierLabel: string;
    /** What a rung says while the staff has not reached it. */
    lockedTier: string;
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
    /** `{count}` — how many of this kind the player has killed (D53). */
    tierLabel: string;
    /** `{remaining}` more kills for `{name}`, the next tint on the ladder. */
    nextLabel: string;
    /** In place of `nextLabel` once all three tiers are taken. */
    maxedLabel: string;
  };
  /**
   * Milestone 8's own copy (D51 to D53): the board, the streak plaque, the
   * Endless card, the picker's badges and the result sheet's new rows.
   *
   * One section rather than five, because all of it is the same milestone's
   * furniture and because the rooms above are keyed by room — none of this
   * belongs to a room.
   */
  meta: {
    missions: {
      heading: string;
      /** `{progress}` of `{target}` on a mission's bar. */
      progressLabel: string;
      /** What a finished mission's card says where its progress was. */
      doneLabel: string;
    };
    streak: {
      /** `{days}` — the plaque's headline. */
      title: string;
      /** `{coins}` the next finished run pays. */
      nextLabel: string;
      claimedLabel: string;
      /** Day zero: nothing to show but the invitation. */
      startLabel: string;
    };
    endless: {
      title: string;
      blurb: string;
      /** `{metres}` — the best walk so far, on the picker's card. */
      bestLabel: string;
      noBestLabel: string;
      /** `{metres}` — the HUD chip that stands in for the level chip (D52). */
      hudLabel: string;
    };
    picker: {
      /** `{level}` — the label a milestone chip carries for a screen reader. */
      milestoneLabel: string;
      /** `{level}` — the label a starred chip carries. */
      starLabel: string;
    };
    result: {
      /** The title of an endless run's sheet, which has no level number. */
      endlessTitle: string;
      /** `{metres}` — the endless record after this run. */
      bestMetresLabel: string;
      /** `{survivors}` of `{peak}` — this level's best walk. */
      bestLabel: string;
      newBestLabel: string;
      /** The button that walks the same seed again (D52). */
      replay: string;
      bonusHeading: string;
      /** `{days}` — the streak line under the coins. */
      streakBonus: string;
      /** `{kind}` and `{tier}` — a bestiary rung crossed. */
      tierBonus: string;
      /** `{name}` — the tint that rung handed over. */
      tintBonus: string;
      nextHeading: string;
      /** `{coins}` still to save for the next thing the Academy sells. */
      nextShort: string;
    };
  };
  /**
   * The in-run HUD's two words (D49). The boss bar's title is the *bestiary's*
   * name for whichever boss is in the arena — "Demon", "Rime Fiend" — so there
   * are two copies of nothing; this is the fallback for a variant the bestiary
   * has no entry for, and the word that replaces the name once it enrages.
   */
  hud: {
    bossFallback: string;
    enraged: string;
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
