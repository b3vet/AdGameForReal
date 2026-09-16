/**
 * What the level-design tests share (document 31): the plan's fixed rules and
 * the small readings of a resolved tier they all make. The numbers here are
 * the design's own (sight lines, loss bands, budgets), not tuning, which is
 * why they sit beside the tests that hold them rather than in `src/data`.
 */

import { ROLES } from '../beats/library';
import type { ResolvedTier } from '../beats/library';
import type { LaneRole, ScriptBeat } from '@/data/types';

/** The eleven defs of Phase 1's eight beats (O/R, G/Gs, F/K each two defs). */
export const PHASE_ONE = [
  'open',
  'rest',
  'guard',
  'shieldGuard',
  'ambush',
  'toll',
  'flip',
  'fork',
  'chargeFork',
  'fence',
  'prep',
] as const;

/**
 * Beats that never count toward a run of threats: the calm ones, the flip
 * (its red lane is the calm lane) and the prep, which ends every level.
 */
export const NOT_A_THREAT: ReadonlySet<string> = new Set(['open', 'rest', 'flip', 'prep']);

/** D55 and D49. */
export const MILESTONES: readonly number[] = [10, 15, 20, 25, 30, 35, 40];
export const FROST_FROM = 21;

/** 3.2: enemies, portals and labels are drawn from 70 m. */
export const SIGHT = 70;
/** 3.2: first sight to the earliest contact, and a charger's trigger to contact. */
export const SIGHT_SECONDS = 4.5;
export const CHARGER_SECONDS = 2;
/** 3.8: levels stay 16 to 19 rows and 60 to 75 s of road. */
export const ROWS = [16, 19] as const;
export const ROAD_SECONDS = [60, 75] as const;

/** 3.9's letters, so a script reads as the plan's outline does. */
const LETTER: Readonly<Record<string, string>> = {
  open: 'O',
  rest: 'R',
  guard: 'G',
  shieldGuard: 'Gs',
  ambush: 'A',
  toll: 'T',
  flip: 'C',
  fork: 'F',
  chargeFork: 'K',
  fence: 'W',
  prep: 'B',
};

/** A script in 3.9's notation: `O G2x W3 R ... B3`. A calm beat's tier 1 is left unwritten. */
export function notation(script: readonly ScriptBeat[]): string {
  return script
    .map((entry) => {
      const letter = LETTER[entry.beat] ?? `?${entry.beat}`;
      const calm = entry.beat === 'open' || entry.beat === 'rest';
      const tier = calm && entry.tier === 1 ? '' : String(entry.tier);
      const prize = entry.prize === 'x2' ? 'x' : entry.prize === 'x3' ? 'x3' : entry.prize === 'big' ? '+' : '';
      return `${letter}${tier}${prize}`;
    })
    .join(' ');
}

/** The curse slots a tier prints. */
export function curses(tier: ResolvedTier): { flip: number; price: number } {
  let flip = 0;
  let price = 0;
  for (const role of ROLES) {
    const slot = tier.gates[role];
    if (slot.kind !== 'sub') continue;
    if (slot.size === 'flip') flip++;
    else price++;
  }
  return { flip, price };
}

/** A role's lane carries something the reference player pays for standing in it. */
export function priced(tier: ResolvedTier, role: LaneRole): boolean {
  return (
    tier.enemies.some((enemy) => (enemy.lanes ?? [enemy.lane]).includes(role)) ||
    tier.rivers.some((river) => river.lanes.includes(role))
  );
}

/** A block stands behind the role's panel: an ambush. */
export function blockBehind(tier: ResolvedTier, role: LaneRole): boolean {
  return tier.enemies.some((enemy) => enemy.kind !== 'charger' && enemy.lane === role && enemy.at > 0);
}
