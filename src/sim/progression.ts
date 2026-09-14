/**
 * `progression.json`, typed, and nothing else.
 *
 * Its own module since Milestone 8 because two files need it and neither may
 * import the other: `./player.ts` is what the Academy *sells* — prices, tiers,
 * purchases and the multipliers a purchase resolves to — and `./rewards.ts` is
 * what the road *pays*. Endless put those on opposite sides of a rule (a road
 * with no level index, paid by distance under a cap read off the campaign), so
 * the schema they share sits under both rather than inside one of them.
 */

import progressionJson from '@/data/progression.json';
import type { Progression } from '@/data/types';

export const progression: Progression = progressionJson;
