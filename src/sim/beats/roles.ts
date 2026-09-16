/**
 * Mapping a beat's roles onto lanes (document 31, 3.8).
 *
 * A beat is written as `prize`, `safe` and `other`; the level seed decides
 * which lane is which, one permutation per beat, drawn on a stream of its own.
 * The draw is always exactly one number per beat, and a permutation the rules
 * forbid is stepped past in a fixed order rather than re-drawn, so a rule
 * change can move the lanes of the beat it touches and nothing after it.
 *
 * The rules:
 * - the prize is not in the same lane three beats running;
 * - a fence beat's outer lane is a side lane (the gauntlet's, fenced on both
 *   boundaries, is the middle one);
 * - a fork's unthreatened lane (its curse) is not the middle lane twice
 *   running.
 */

import { mulberry32 } from '../rng';
import type { Rng } from '../rng';
import type { Lane } from '../types';
import type { LaneRole } from '@/data/types';
import { FORK_BEATS, ROLES } from './library';
import type { ResolvedTier } from './library';

export type RoleLanes = Record<LaneRole, Lane>;

/** Mixed into the level seed: the role stream is not the level's own. */
const ROLE_SALT = 0x2b_0e_1a_7e;

/** Every way to put prize, safe and other on the three lanes, in that order. */
const PERMUTATIONS: ReadonlyArray<readonly [Lane, Lane, Lane]> = [
  [-1, 0, 1],
  [-1, 1, 0],
  [0, -1, 1],
  [0, 1, -1],
  [1, -1, 0],
  [1, 0, -1],
];

/**
 * The one role a fork leaves without a threat (its curse lane), or null when
 * the beat is not a fork or leaves no single such role. A fork is known by its
 * id: its threats are rivers on one tier and chargers on another, and a prep
 * beat that pours two rivers is not one.
 */
export function forkGap(id: string, tier: ResolvedTier): LaneRole | null {
  if (!FORK_BEATS.has(id)) return null;
  const threatened = new Set<LaneRole>();
  for (const river of tier.rivers) for (const role of river.lanes) threatened.add(role);
  for (const enemy of tier.enemies) {
    const roles = enemy.lanes !== undefined && enemy.lanes.length > 0 ? enemy.lanes : [enemy.lane];
    for (const role of roles) threatened.add(role);
  }
  const open = ROLES.filter((role) => !threatened.has(role));
  return open.length === 1 ? (open[0] ?? null) : null;
}

export class RolePicker {
  private readonly rng: Rng;
  /** Prize lanes of the last two beats, most recent last. */
  private readonly prizes: Lane[] = [];
  /** The unthreatened lane of the last fork, or null before the first. */
  private lastForkGap: Lane | null = null;

  constructor(seed: number) {
    this.rng = mulberry32((seed ^ ROLE_SALT) >>> 0);
  }

  /** Lanes for the next beat's roles. `id` names the beat in an error. */
  pick(tier: ResolvedTier, id: string): RoleLanes {
    const first = Math.min(PERMUTATIONS.length - 1, Math.floor(this.rng() * PERMUTATIONS.length));
    const gap = forkGap(id, tier);
    for (let step = 0; step < PERMUTATIONS.length; step++) {
      const perm = PERMUTATIONS[(first + step) % PERMUTATIONS.length];
      if (perm === undefined) continue;
      const roles: RoleLanes = { prize: perm[0], safe: perm[1], other: perm[2] };
      if (!this.allows(roles, tier, gap)) continue;
      this.prizes.push(roles.prize);
      if (this.prizes.length > 2) this.prizes.shift();
      if (gap !== null) this.lastForkGap = roles[gap];
      return roles;
    }
    throw new Error(`beat "${id}": no lane permutation satisfies the composer's rules`);
  }

  private allows(roles: RoleLanes, tier: ResolvedTier, gap: LaneRole | null): boolean {
    const [a, b] = this.prizes;
    if (a !== undefined && a === b && roles.prize === a) return false;
    const fence = tier.fence;
    if (fence !== null && fence !== undefined) {
      const outer = roles[fence.outer];
      if (fence.both === true ? outer !== 0 : outer === 0) return false;
    }
    if (gap !== null && this.lastForkGap === 0 && roles[gap] === 0) return false;
    return true;
  }
}
