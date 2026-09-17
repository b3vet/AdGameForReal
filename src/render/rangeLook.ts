/**
 * How far out each thing on the road is drawn, and how far out it carries a
 * number.
 *
 * Split out of `./theme.ts` for the file-size rule (CLAUDE.md) when the
 * level-design plan moved every one of these numbers (document 31, sections 3.2
 * and 4.7); `theme.ts` re-exports all of it, so every view still reads one
 * module. It imports nothing from the render layer, because `./pools.ts` sizes
 * the minion crowd off the enemy range and `theme.ts` imports `pools.ts`.
 *
 * The rule the plan sets is one of *sight*: everything a beat uses is visible
 * from about 70 m, at least 4.5 s before it can reach the column, because a
 * choice the player cannot see coming is not a choice. Milestone 3 drew blocks
 * from 52 m and numbered them from 45, which suited threats that woke at 26 m
 * and nothing else; a guard that wakes at 45 m and a portal that opens at 50 m
 * would both have started moving before they were drawn.
 *
 * None of these reaches the fog: at 74 m ahead the camera is about 88 m away,
 * and the haze starts at 120 (`FOG_START`, D38).
 */

import { balance } from '@/data';

/**
 * The plan's sight line (document 31, 3.2): the squad-to-threat distance from
 * which a block, a charger, a river's count and a portal are all on screen and
 * numbered.
 */
export const THREAT_SIGHT = 70;

/**
 * How far ahead an enemy body is drawn at all.
 *
 * A few metres past `THREAT_SIGHT`, the same order the gates keep: the body is
 * on the road a moment before its number, so a number never appears over
 * empty road. Its skeletons are instanced, and one that far out is a few
 * pixels tall — which is what sends a unit to the crowd's low-polygon copy
 * (`./characters/crowdCull.ts`) — so the longer reach costs a few dozen small
 * instances rather than triangles the phone would feel.
 */
export const ENEMY_DRAW_RANGE = THREAT_SIGHT + 4;
/**
 * How far ahead a block's, a charger's and a river's number is printed, and a
 * portal's waiting count (`./portalMarks.ts`). Past forty metres every one of
 * them is at its floor size, so the far half of the road reads as small
 * numbers on the things that will cost the player, which is what a choice
 * made at 45 m has to be made on.
 */
export const ENEMY_LABEL_RANGE = THREAT_SIGHT;
/** Where a portal's ring comes into view: with the bodies, not after them. */
export const PORTAL_DRAW_RANGE = ENEMY_DRAW_RANGE;

/**
 * The boss's number. Unchanged at 45 m: the HUD bar is the boss's readout, and
 * a number over the horns at seventy metres is a dot in the haze band.
 */
export const LABEL_RANGE = 45;
/** How far behind the squad a label stays alive before it is hidden. */
export const LABEL_BEHIND = 4;

/**
 * Past two and a half rows a gate's number is noise, not choice — and with
 * the rows this close together the third and fourth rows print their digits on
 * top of the second one's. Derived from the sim's spacing so moving the rows
 * again cannot silently turn the far half of the road back into a stack of
 * numbers.
 *
 * Every lane is numbered from here since document 31 (4.1): the side lanes as
 * a glance (`GATE_SIDE_GLANCE_SCALE`) until `SIDE_GATE_LABEL_RANGE`, and at full
 * size inside it.
 */
export const GATE_LABEL_RANGE = balance.level.rowSpacing * 2.5;
/**
 * Where a side lane's number reaches full size.
 *
 * Side lanes are two metres from the middle one: 44 px at thirty metres on a
 * 390 px phone and 33 px at forty-five. Cinzel's widest print a gate makes is
 * `+25%` at 2.36 em, which at the 13 px floor is 32 px of ink — so from thirty
 * metres out two full-size numbers side by side close to a pixel of each
 * other. The side lanes shrink instead of vanishing: the player reading the
 * row at 45 m needs all three offers, and the middle one keeps its full size.
 */
export const SIDE_GATE_LABEL_RANGE = Math.min(balance.level.rowSpacing * 2.3, 30);
/**
 * A side lane's number at `GATE_LABEL_RANGE`, as a share of the middle lane's.
 *
 * It ramps down from full size at `SIDE_GATE_LABEL_RANGE` rather than stepping,
 * so nothing pops as the row closes. At 0.8 a side `+25%` is 10.4 px at 45 m —
 * 26 px of ink — and sits six pixels clear of a full-size `+150` in the middle
 * lane on the same row, the widest pair the plan's rounding can print (3.4).
 * Staff words are the exception: `Storm` is 3.5 em, which no size that can
 * still be read fits between two lanes, so a side staff gate keeps its word
 * for `SIDE_GATE_LABEL_RANGE` and the arch's violet light says what it is
 * until then.
 */
export const GATE_SIDE_GLANCE_SCALE = 0.8;

/**
 * How far out a gate at lateral `x` prints its number: every lane from
 * `GATE_LABEL_RANGE`, except a side lane's staff word, which waits for
 * `SIDE_GATE_LABEL_RANGE`. One rule for the view that prints the numbers
 * (`./gates.ts`) and the one that keeps other numbers off them
 * (`./labelClearance.ts`).
 */
export function gateLabelReach(x: number, word: boolean): number {
  return word && Math.abs(x) > 0.01 ? SIDE_GATE_LABEL_RANGE : GATE_LABEL_RANGE;
}

/**
 * A gate number's size, as a share of the middle lane's, `ahead` metres out:
 * 1 in the middle lane and inside `SIDE_GATE_LABEL_RANGE`, falling to
 * `GATE_SIDE_GLANCE_SCALE` at `GATE_LABEL_RANGE` in the side lanes.
 */
export function gateLabelScale(x: number, ahead: number): number {
  if (Math.abs(x) <= 0.01 || ahead <= SIDE_GATE_LABEL_RANGE) return 1;
  const span = GATE_LABEL_RANGE - SIDE_GATE_LABEL_RANGE;
  const t = Math.min(1, (ahead - SIDE_GATE_LABEL_RANGE) / span);
  return 1 - (1 - GATE_SIDE_GLANCE_SCALE) * t;
}

/**
 * How far ahead a gate's arch is drawn at all (document 31, 3.2 and 4.7).
 *
 * A row past where its numbers start, where Milestone 5 stopped just outside
 * them. The arch and its light are what a beat is *read* against from far off —
 * a block standing in front of a panel, a portal behind one — and the light
 * says the kind (green, red, gold) before any digit does. Every arch in view is
 * one instance of one mesh and every light one quad of one batch, so the extra
 * row is instances, not draw calls: at 18 m rows a 60 m reach plus the exits
 * behind the squad is at most four rows, inside the view's sixteen.
 */
export const GATE_DRAW_RANGE = 60;

/**
 * Lateral reach of the label-placement rule (`./labelClearance.ts`). Lanes are
 * two metres apart, which is 33 px even at forty-five metres — wider than
 * either number's half — so only a gate in the label's own lane can print on
 * the same patch of screen.
 */
export const BLOCK_LABEL_LANE_CLEARANCE = 1.2;
/**
 * Air between a block's number and the gate's number or plaque it is moved
 * clear of, in design pixels (`./labelClearance.ts`). Four rather than three
 * since the guards moved to a metre in front of their panels: two stacked
 * numbers need the air to read as two.
 */
export const BLOCK_LABEL_GAP = 4;
/**
 * The lowest a block's number may be moved to clear a gate's number above it,
 * in metres over the road. Below this it would be printed across the block's
 * own feet and the road, and hiding it for the second the two overlap is the
 * better miss.
 */
export const BLOCK_LABEL_FLOOR = 0.3;
