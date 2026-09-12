/**
 * What the player brings to a run: the fire, the evolutions and the familiar.
 *
 * Assembled in one place because the three know about each other — the burn and
 * the wisp both damage bodies, and every kill in the sim has to go through the
 * one path in `Firing` so that a stream is booked, a corpse is stamped and the
 * events come out in the right order however the body died. `Run` then holds
 * three fields instead of forty lines of wiring.
 */

import { Burn } from './burn';
import type { EventBuffer } from './events';
import { Familiar } from './familiar';
import { Firing } from './firing';
import { evolutionOf, progression } from './player';
import type { PlayerMods } from './player';
import type { Streams } from './streams';
import type { TargetList } from './targeting';
import type { EnemyState, RunState } from './types';
import { weaponIds } from './weapons';
import type { Balance, BurnDef } from '@/data/types';

export interface Loadout {
  firing: Firing;
  /** Null unless one of the player's staffs is evolved into a burn. */
  burn: Burn | null;
  /** Null unless the Sanctum sold them a wisp. */
  familiar: Familiar | null;
}

/**
 * The burn the player's staffs can apply, if any. One definition serves the
 * whole run because only ember carries a burn; a second staff with one would
 * need its own `Burn`.
 */
function burnDef(mods: PlayerMods): BurnDef | null {
  for (const id of weaponIds) {
    const burn = evolutionOf(id, mods.tiers[id])?.burn;
    if (burn !== undefined) return burn;
  }
  return null;
}

export function buildLoadout(
  balance: Balance,
  events: EventBuffer,
  targets: TargetList,
  streams: Streams,
  mods: PlayerMods,
  onBossKilled: () => void,
): Loadout {
  // Bound before `Firing` exists and shared by the burn and the wisp; both only
  // ever call it inside a step, long after this returns.
  let fire: Firing | null = null;
  const hit = (state: RunState, enemy: EnemyState, amount: number): void => {
    fire?.hit(state, enemy, amount);
  };

  const def = burnDef(mods);
  const burn = def === null ? null : new Burn(def, events, hit);
  fire = new Firing(balance, events, targets, streams, onBossKilled, mods, burn);

  const tier = mods.familiarTier;
  const familiar =
    tier > 0 ? new Familiar(progression.wisp, tier, balance, events, targets, hit) : null;

  return { firing: fire, burn, familiar };
}
