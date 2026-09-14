/**
 * The staff evolutions, resolved once per run (D33, widened by D54).
 *
 * Three tiers per staff and nine mechanics between them, and every one of them
 * is a *question asked once*: does this player hold it. Asking it once, here,
 * is what keeps the answer out of the hot loops — a burn tick that re-read
 * `progression.json` would do it four times a second on every body alight — and
 * it is what makes tier gating testable in one place rather than at nine call
 * sites.
 *
 * Where each mechanic then lives is where it happens: the burn and its wildfire
 * in `./burn.ts`, the chains, the shatter, the freeze pulse and the overcharge
 * in `./effects.ts` (everything that happens *around* the body hit), and the
 * two that run on a clock of their own — the meteor and the glacier — in
 * `./meteor.ts` and `./glacier.ts`, ticked by the `Evolutions` runtime at the
 * bottom of this file so `Run` holds one field and makes one call.
 */

import type { EventBuffer } from './events';
import { Glacier } from './glacier';
import { Meteor } from './meteor';
import type { PlayerMods } from './player';
import { progression } from './progression';
import type { TargetList } from './targeting';
import type { RunState, WeaponId } from './types';
import { weaponIds } from './weapons';
import type {
  Balance,
  BurnDef,
  EvolutionDef,
  EvolutionMechanic,
  EvolutionTier,
  ShatterDef,
} from '@/data/types';

/**
 * What `id` does once it has been evolved at all, or undefined while it has
 * not. `tier` is evolutions held (`PlayerMods.tiers`), so one rung is enough:
 * the Milestone 4 mechanic is staff tier 2 and every tier above it keeps it.
 */
export function evolutionOf(id: WeaponId, tier: EvolutionTier): EvolutionDef | undefined {
  return tier >= 1 ? progression.evolutions[id] : undefined;
}

/**
 * Whether `id` at `tier` evolutions held has `mechanic` switched on (D54).
 *
 * `progression.json` names the *staff* tier each mechanic arrives at — that is
 * what the Workbench sells and what a player reads on the row — and the sim
 * counts evolutions held, so the one conversion between the two lives here.
 */
export function hasEvolution(
  id: WeaponId,
  tier: EvolutionTier,
  mechanic: EvolutionMechanic,
): boolean {
  const rung = progression.evolutions[id][mechanic];
  return rung !== undefined && tier + 1 >= rung;
}

/**
 * Everything the player's staffs switch on for this run.
 *
 * Two kinds of field, and the difference is deliberate. `burn` and `shatter`
 * are resolved from the *player*: a body only shatters because frost froze it,
 * and which staff the squad happens to be carrying when it dies is beside the
 * point (the Milestone 4 rule, kept). Everything else is keyed by staff,
 * because it happens at the moment the squad fires and the staff in hand is
 * what fires it — a player who walks through a staff gate is holding the other
 * staff's mechanics until they walk through another one.
 */
export interface HeldEvolutions {
  burn: BurnDef | null;
  shatter: ShatterDef | null;
  /** Extra chain links per staff, from the tier its owner has it at. */
  extraChains: Record<WeaponId, number>;
  /** Per staff: the arc keeps its full damage at every hop. */
  fullChains: Record<WeaponId, boolean>;
  /** Per staff: a burning body passes the fire on, once. */
  wildfire: Record<WeaponId, boolean>;
  /** Per staff: a charged shot every N seconds. */
  meteor: Record<WeaponId, boolean>;
  /** Per staff: every Nth volley arcs to everything in range. */
  overcharge: Record<WeaponId, boolean>;
  /** Per staff: a slowed body that dies chills its neighbours. */
  freezePulse: Record<WeaponId, boolean>;
  /** Per staff: a wall of ice holds one lane. */
  glacier: Record<WeaponId, boolean>;
}

function noStaff(): Record<WeaponId, boolean> {
  return { ember: false, storm: false, frost: false };
}

/** Resolves `mods.tiers` into the nine answers above. Called once, by `Run`. */
export function heldEvolutions(mods: PlayerMods): HeldEvolutions {
  const held: HeldEvolutions = {
    burn: null,
    shatter: null,
    extraChains: { ember: 0, storm: 0, frost: 0 },
    fullChains: noStaff(),
    wildfire: noStaff(),
    meteor: noStaff(),
    overcharge: noStaff(),
    freezePulse: noStaff(),
    glacier: noStaff(),
  };

  for (const id of weaponIds) {
    const tier = mods.tiers[id];
    const evolution = evolutionOf(id, tier);
    if (evolution === undefined) continue;
    held.extraChains[id] = evolution.extraChains ?? 0;
    if (evolution.burn !== undefined) held.burn = evolution.burn;
    if (evolution.shatter !== undefined) held.shatter = evolution.shatter;
    held.fullChains[id] = hasEvolution(id, tier, 'fullChains');
    held.wildfire[id] = hasEvolution(id, tier, 'wildfire');
    held.meteor[id] = hasEvolution(id, tier, 'meteor');
    held.overcharge[id] = hasEvolution(id, tier, 'overcharge');
    held.freezePulse[id] = hasEvolution(id, tier, 'freezePulse');
    held.glacier[id] = hasEvolution(id, tier, 'glacier');
  }
  return held;
}

/** True when any staff in `flags` has the mechanic; what decides "build it at all". */
export function anyStaff(flags: Record<WeaponId, boolean>): boolean {
  return flags.ember || flags.storm || flags.frost;
}

/** The squad's whole output per second: shots a second times damage a shot. */
export type SquadOutput = (state: RunState) => number;

/**
 * A push on the crowd from something that is not a body: the meteor's impact.
 * `until` is the sim time it stops pushing — an absolute time rather than a
 * duration, because a crater is an event and the shove field is a per-step
 * force that has to know when to stop being one.
 */
export type Shove = (
  x: number,
  z: number,
  radius: number,
  strength: number,
  until: number,
) => void;

/** A blast that came from no shot: the meteor. Damage, radius and falloff. */
export type Blast = (
  state: RunState,
  x: number,
  z: number,
  damage: number,
  radius: number,
  falloff: number,
) => void;

/**
 * The two evolutions that run on a clock rather than on a hit.
 *
 * One object and one `update` so `Run` gains one field and one call: the step
 * order is already the delicate part of that file, and a second and third
 * "if the player bought it" branch in it would be two more places to get the
 * ordering wrong.
 */
export class Evolutions {
  private readonly meteor: Meteor | null;
  private readonly glacier: Glacier | null;

  constructor(
    held: HeldEvolutions,
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    output: SquadOutput,
    blast: Blast,
    shove: Shove,
  ) {
    const tuning = balance.evolutions;
    this.meteor = anyStaff(held.meteor)
      ? new Meteor(tuning.ember.meteor, balance, events, targets, held.meteor, output, blast, shove)
      : null;
    this.glacier = anyStaff(held.glacier)
      ? new Glacier(tuning.frost.glacier, balance, events, held.glacier)
      : null;
  }

  /** Both clocks, once a step. Called after the squad's own fire, like the burn. */
  update(state: RunState, dt: number): void {
    this.meteor?.update(state, dt);
    this.glacier?.update(state, dt);
  }
}
