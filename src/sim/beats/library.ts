/**
 * Reading the beat library (document 31, 4.2): finding a beat, resolving a
 * tier, and the two measured numbers the sizing reads.
 *
 * `beats.json` is hand-written and arrives in parallel with this code, so
 * everything here fails loudly and by name: a script that names a beat or a
 * tier the library does not have is a data error the author has to see, not a
 * level that quietly composes without it.
 */

import { dpsPerUnit } from '../pressure';
import { balance as shipped } from '@/data';
import type {
  Balance,
  BeatDef,
  BeatLibrary,
  BeatTier,
  BeatValueSize,
  BiomeId,
  GateSlot,
  LaneRole,
  PrizeOverride,
  RiverBunch,
} from '@/data/types';

export const ROLES: readonly LaneRole[] = ['prize', 'safe', 'other'];

/**
 * Beats a staff gate may stand on in Phase 1: the open and the rest, where
 * every lane is a plus, so giving one up still leaves a plus beside the
 * prize. Any other beat's lanes are its question and are never traded away.
 * Keyed on the id because the pinned script line names a beat, not a shape.
 */
export const STAFF_HOST_BEATS: ReadonlySet<string> = new Set(['open', 'rest']);

/** The two fork beats (F and K), whose riverless lane the role rules watch. */
export const FORK_BEATS: ReadonlySet<string> = new Set(['fork', 'chargeFork']);

/** A tier with everything the composer needs present. */
export interface ResolvedTier {
  rating: BeatTier['rating'];
  expectLoss: number;
  gates: Record<LaneRole, GateSlot>;
  enemies: NonNullable<BeatTier['enemies']>;
  rivers: NonNullable<BeatTier['rivers']>;
  fence: BeatTier['fence'] | null;
}

export function findBeat(library: BeatLibrary, id: string): BeatDef {
  const def = library.defs.find((candidate) => candidate.id === id);
  if (def === undefined) {
    const known = library.defs.map((candidate) => candidate.id).join(', ');
    throw new Error(`beat "${id}" is not in beats.json (known: ${known === '' ? 'none' : known})`);
  }
  return def;
}

/**
 * Tier `tier` of a beat, with every tier below it folded in.
 *
 * A tier lists only what differs from the one below (4.2), so resolving is a
 * walk up from "1": scalars and lists replace what came before, and `gates`
 * merges role by role so a tier can change the prize alone. The asked-for key
 * must exist even when it adds nothing (`{}`): a missing tier is far more often
 * a typo in a script than a tier identical to the one below.
 */
export function resolveTier(def: BeatDef, tier: number): ResolvedTier {
  const key = String(Math.floor(tier));
  if (def.tiers[key] === undefined) {
    throw new Error(`beat "${def.id}" has no tier ${key}`);
  }
  let rating: BeatTier['rating'] | undefined;
  let expectLoss: number | undefined;
  const gates: Partial<Record<LaneRole, GateSlot>> = {};
  let enemies: ResolvedTier['enemies'] = [];
  let rivers: ResolvedTier['rivers'] = [];
  let fence: ResolvedTier['fence'] = null;

  for (let t = 1; t <= Number(key); t++) {
    const part = def.tiers[String(t)];
    if (part === undefined) continue;
    if (part.rating !== undefined) rating = part.rating;
    if (part.expectLoss !== undefined) expectLoss = part.expectLoss;
    if (part.gates !== undefined) Object.assign(gates, part.gates);
    if (part.enemies !== undefined) enemies = part.enemies;
    if (part.rivers !== undefined) rivers = part.rivers;
    if (part.fence !== undefined) fence = part.fence;
  }

  const prize = gates.prize;
  const safe = gates.safe;
  const other = gates.other;
  if (rating === undefined || expectLoss === undefined) {
    throw new Error(`beat "${def.id}" tier ${key} has no rating or expectLoss`);
  }
  if (prize === undefined || safe === undefined || other === undefined) {
    throw new Error(`beat "${def.id}" tier ${key} does not name a gate for every role`);
  }
  return { rating, expectLoss, gates: { prize, safe, other }, enemies, rivers, fence };
}

/** The tier with a script's prize override written in (3.9's `x`, `x3`). */
export function withPrize(tier: ResolvedTier, prize: PrizeOverride | undefined): ResolvedTier {
  if (prize === undefined) return tier;
  const slot: GateSlot =
    prize === 'x2'
      ? { kind: 'mul', value: 2 }
      : prize === 'x3'
        ? { kind: 'mul', value: 3 }
        : { kind: 'add', size: 'big' };
  return { ...tier, gates: { ...tier.gates, prize: slot } };
}

/**
 * The measured fire of one unit of the reference squad, per biome.
 *
 * Absent from the library, it falls back on the dealt road's own stream model
 * (`dpsPerUnit`), which is the number the beat lab's measurement replaces, so
 * a half-written `beats.json` still composes a playable road.
 */
export function beatDps(
  library: BeatLibrary,
  what: 'block' | 'river',
  biome: BiomeId,
  balance: Balance = shipped,
): number {
  const measured = library.dps?.[what]?.[biome];
  if (measured !== undefined && measured > 0) return measured;
  return dpsPerUnit(balance);
}

/**
 * How a biome's river fire grows with bunching (`RiverBunch`), or undefined
 * when the library does not say: a river sized without it is sized as if its
 * bodies walked alone.
 */
export function beatBunch(library: BeatLibrary, biome: BiomeId): RiverBunch | undefined {
  return library.dps?.bunch?.[biome];
}

/**
 * The `[min, max]` share of E a gate size prints. A fire-rate panel has no size
 * of its own in the pinned file and is priced as a `mid` plus (`gateValue`).
 */
export function beatValues(library: BeatLibrary, size: BeatValueSize): [number, number] {
  const range = library.values?.[size];
  if (range === undefined) throw new Error(`beats.json has no "${size}" value range`);
  return range;
}

/** Lerp inside a `[min, max]` pair, `u` in `[0, 1)`. */
export function within(range: readonly [number, number], u: number): number {
  return range[0] + (range[1] - range[0]) * u;
}
