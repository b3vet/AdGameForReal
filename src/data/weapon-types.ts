/**
 * Schema for `weapons.json`: the three staffs and what each one does when a
 * shot lands (docs/06-milestone-2-plan.md, "Weapons").
 *
 * Split out of `./types.ts` in Milestone 4 Phase D, which had grown past the
 * file-size rule (CLAUDE.md). A staff is its own thing rather than part of the
 * campaign's tuning: `WeaponId` is read by the sim, the app, the renderer and
 * the save, and `./types.ts` re-exports every name here so `@/data/types` is
 * still the one import site.
 */

/** The three staffs (docs/06-milestone-2-plan.md, "Weapons"). */
export type WeaponId = 'ember' | 'storm' | 'frost';

/** Ember: every block within `radius` of the impact takes damage, falling off
 *  linearly to `1 - falloff` at the rim. */
export interface WeaponSplash {
  radius: number;
  falloff: number;
}

/** Storm: after a hit, up to `count` further blocks within `range` of the last
 *  one are struck for `damageMul` of the shot's damage. No block twice. */
export interface WeaponChain {
  count: number;
  range: number;
  damageMul: number;
}

/** Frost: the block walks at `factor` of its speed for `seconds`, and a kill
 *  while slowed shatters instead of collapsing. */
export interface WeaponSlow {
  factor: number;
  seconds: number;
  shatterOnKill: boolean;
}

/**
 * One staff. The record key in `weapons.json` is the id, so the def itself
 * carries no `id` field: a string in JSON widens to `string` and would not
 * satisfy `WeaponId` without a cast.
 */
export interface WeaponDef {
  /** Multiplier on `balance.squad.damage`. */
  damage: number;
  /** Multiplier on the squad's effective fire rate. */
  fireRateMul: number;
  projectileSpeed: number;
  splash?: WeaponSplash;
  chain?: WeaponChain;
  slow?: WeaponSlow;
}

export type WeaponData = Record<WeaponId, WeaponDef>;
