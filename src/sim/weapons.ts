/**
 * The three staffs.
 *
 * Typed access to `weapons.json` lives here rather than in `src/data/index.ts`
 * because the sim is the only thing that reads the mechanics, and render and UI
 * already import everything sim-shaped from `@/sim`.
 *
 * The record key in the JSON is the weapon's id: a string written in JSON widens
 * to `string`, so an `id` field could not satisfy `WeaponId` without a cast.
 */

import weaponsJson from '@/data/weapons.json';
import type { WeaponData, WeaponDef, WeaponId } from '@/data/types';

const DATA: { start: string; staffs: WeaponData } = weaponsJson;

export const weaponIds: readonly WeaponId[] = ['ember', 'storm', 'frost'];

/**
 * The staff every run starts with. Read through `weaponIds` rather than cast:
 * a string in JSON widens to `string`, and the sim carries no casts.
 */
export const startWeapon: WeaponId = weaponIds.find((id) => id === DATA.start) ?? 'ember';

export function weaponDef(id: WeaponId): WeaponDef {
  return DATA.staffs[id];
}

/** The staff a squad is holding. Falls back to ember for hand-made states. */
export function weaponOf(squad: { weaponId?: WeaponId }, fallback: WeaponId = startWeapon): WeaponId {
  return squad.weaponId ?? fallback;
}

/**
 * What one block is worth as a splash or chain neighbour of another: the two
 * blocks' centre distance, minus the width they each already cover, so a fat
 * block in the next lane is reachable and a thin one is not.
 */
export function blockGap(ax: number, aHalf: number, bx: number, bHalf: number, dz: number): number {
  const dx = Math.max(0, Math.abs(ax - bx) - aHalf - bHalf);
  return Math.hypot(dx, dz);
}

/**
 * Expected damage per second of `id` against a layout of blocks, relative to a
 * single-target shot. Used by the bots to value a staff gate and by nothing
 * else: it is a ranking, not a simulation.
 *
 * `neighbours(radius, edgeToEdge)` answers "how many other blocks the average
 * block has within `radius`", which is the whole difference between a splash
 * staff on a packed row and the same staff on an empty road. It is asked the
 * way the sim measures: splash reaches from the impact to a block's edge, a
 * chain jumps from one block's centre to another's.
 */
export function expectedDps(
  id: WeaponId,
  neighbours: (radius: number, edgeToEdge: boolean) => number,
  slowWorth: number,
): number {
  const def = weaponDef(id);
  let multiplier = 1;

  const splash = def.splash;
  if (splash !== undefined) {
    // Half damage on average across the splash radius, and a block only ever
    // splashes what is actually next to it.
    multiplier += 0.5 * Math.min(2, neighbours(splash.radius, true));
  }

  const chain = def.chain;
  if (chain !== undefined) {
    multiplier += chain.damageMul * Math.min(chain.count, neighbours(chain.range, false));
  }

  if (def.slow !== undefined) multiplier += slowWorth;

  return def.damage * def.fireRateMul * multiplier;
}
