/**
 * What the player brings to a run: the fire, the evolutions and the familiar.
 *
 * Assembled in one place because they all know about each other — the burn, the
 * wisp, the splash, the arc and the meteor all damage bodies, and every kill in
 * the sim has to go through the one path in `Firing` so that a stream is
 * booked, a corpse is stamped and the events come out in the right order
 * however the body died. `Run` then holds three fields instead of sixty lines
 * of wiring.
 *
 * Milestone 8 made that wiring circular and this is where the knot is tied:
 * `WeaponEffects` damages through `Firing`, `Firing` resolves its splash and
 * its arc through `WeaponEffects`, and the meteor blasts through the same
 * effects without going near the shot clock. The three callbacks below are
 * bound before `Firing` exists and are only ever called inside a step, long
 * after this function has returned.
 */

import { Burn } from './burn';
import type { CrowdSim } from './crowd';
import { WeaponEffects } from './effects';
import { Evolutions, anyStaff, heldEvolutions } from './evolutions';
import type { EventBuffer } from './events';
import { Familiar } from './familiar';
import { Firing } from './firing';
import type { PlayerMods } from './player';
import { progression } from './progression';
import type { Streams } from './streams';
import type { TargetList } from './targeting';
import type { EnemyState, RunState } from './types';
import type { Balance, WeaponSlow } from '@/data/types';

export interface Loadout {
  firing: Firing;
  /** Null unless one of the player's staffs is evolved into a burn. */
  burn: Burn | null;
  /** Null unless the Sanctum sold them a wisp. */
  familiar: Familiar | null;
  /** The two evolutions that run on a clock: the meteor and the glacier (D54). */
  evolutions: Evolutions;
}

export function buildLoadout(
  balance: Balance,
  events: EventBuffer,
  targets: TargetList,
  streams: Streams,
  mods: PlayerMods,
  onBossKilled: () => void,
  crowd: CrowdSim,
): Loadout {
  const held = heldEvolutions(mods);

  // Bound before `Firing` exists and shared by everything that damages a body;
  // all of them are only ever called inside a step, long after this returns.
  let fire: Firing | null = null;
  const hit = (state: RunState, enemy: EnemyState, amount: number): void => {
    fire?.hit(state, enemy, amount);
  };
  const spill = (
    state: RunState,
    enemy: EnemyState,
    amount: number,
    slow: WeaponSlow | undefined,
  ): void => {
    fire?.spill(state, enemy, amount, slow);
  };

  const effects = new WeaponEffects(balance, events, targets, spill, held);

  const def = held.burn;
  // Ember tier 3 rides on the burn it spreads, so it is built with it or not
  // at all: a player who owns the wildfire tier owns the burn by construction.
  const wildfire =
    def !== null && anyStaff(held.wildfire)
      ? { tuning: balance.evolutions.ember.wildfire, targets, balance }
      : null;
  const burn = def === null ? null : new Burn(def, events, hit, wildfire);
  fire = new Firing(balance, events, targets, streams, crowd, onBossKilled, effects, held, mods, burn);

  const evolutions = new Evolutions(
    held,
    balance,
    events,
    targets,
    // The squad's whole output per second, which is what the meteor and the
    // overcharge are priced in (`MeteorBalance.secondsOfFire`).
    (state) => (fire === null ? 0 : fire.rateOf(state) * state.squad.damage),
    (state, x, z, damage, radius, falloff) => {
      // No source body to exclude: a meteor comes out of the sky, so every
      // body inside the crater takes the blast including the one under it.
      effects.splash(state, null, x, z, damage, radius, falloff, undefined);
    },
    (x, z, radius, strength, until) => {
      crowd.shove(x, z, radius, strength, until);
    },
    // The glacier grinds what it holds through the same door a burn tick uses.
    hit,
  );

  const tier = mods.familiarTier;
  const familiar =
    tier > 0 ? new Familiar(progression.wisp, tier, balance, events, targets, hit) : null;

  return { firing: fire, burn, familiar, evolutions };
}
