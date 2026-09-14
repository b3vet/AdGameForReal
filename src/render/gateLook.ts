/**
 * How a gate is proportioned (Milestone 5 plan, "Gates too basic").
 *
 * Split out of `./theme.ts` — which owns the gate *timings* and the label sizes
 * and is not this track's file — so the arch's geometry lives next to the code
 * that builds it (`./gateArch.ts`) and the view that places it (`./gates.ts`).
 *
 * Everything is measured off the lane. A lane is 2 m wide and an arch is 1.88 m
 * of it (`ARCH_CLEAR_WIDTH` plus a leg each side): the opening is what the squad
 * walks through and the legs stand either side of it, with a hand's breadth of
 * road left between one arch and its neighbour. That gap is the whole reason for
 * the number — three arches that spanned their lanes exactly met at the legs and
 * read as one barrier across the road rather than as three doors to choose
 * between.
 */

import { balance } from '@/data';

/**
 * The opening and the legs either side of it. A lane is 2 m wide and an arch is
 * 1.88 m of it, so a hand's breadth of road shows between one arch and its
 * neighbour — three arches that spanned their lanes exactly met at the legs and
 * read as one barrier across the road rather than as three doors.
 */
export const ARCH_CLEAR_WIDTH = 1.24;
export const ARCH_LEG_THICKNESS = 0.32;
/** How deep the whole assembly runs along the road. */
export const ARCH_DEPTH = 0.5;

/**
 * The arch proper: a semicircular ring of voussoirs springing from the top of
 * the legs.
 *
 * This is the second try at the top of a gate. The first was a straight lintel,
 * and three of them side by side read as a guardrail across the road — a
 * horizontal bar on posts is a fence in any art style. A real ring of wedge
 * blocks is unmistakable at any distance, and it costs seven small pieces of
 * the same mesh the legs are cut from.
 *
 * The radius is measured to the middle of the ring, so the opening the ring
 * encloses is the same width as the one between the legs.
 */
export const ARCH_RING_RADIUS = (ARCH_CLEAR_WIDTH + ARCH_LEG_THICKNESS) / 2;
export const ARCH_RING_THICKNESS = 0.34;
export const ARCH_VOUSSOIRS = 7;
/** Where the curve springs from, and where its underside is at the apex. */
export const ARCH_SPRING_Y = 1.5;
export const ARCH_APEX = ARCH_SPRING_Y + ARCH_RING_RADIUS;
export const ARCH_SOFFIT = ARCH_APEX - ARCH_RING_THICKNESS / 2;
/** A low parapet across the top, which is what the crown ornament stands on. */
export const ARCH_CROWN_HEIGHT = 0.3;

/**
 * How hard the arch's stone tint is driven (`./gateArch.ts`).
 *
 * The tint is a multiplier on the dungeon atlas, so it has to be able to go
 * *above* one — the pack is painted for torchlight and goes cold grey outdoors,
 * and nothing under 1 would ever lift it. A palette role is a colour in 0..1,
 * so the role says which way the stone leans and this says how far: role times
 * gain is the albedo multiplier. 1.26 is what the warm meadow tint has always
 * been worth, and `stone.arch` is that tint normalised.
 */
export const ARCH_TINT_GAIN = 1.26;
export const ARCH_HEIGHT = ARCH_APEX + ARCH_RING_THICKNESS / 2 + ARCH_CROWN_HEIGHT;

/**
 * The rune plaque, and where it hangs.
 *
 * It is a little wider than the arch's opening on purpose — it hangs in front
 * of the legs, and a staff gate prints a *word*: at the opening's own width
 * "STORM" ran off the end of its plaque. It is centred on `GATE_CENTER_Y`
 * because that is where the number has always been printed: the label API and the clearance rules that keep a block's HP
 * out of a gate's digits (`./labelClearance.ts`) are measured against that
 * height, and moving the plaque rather than the number is what keeps all of it
 * true. `GATE_PLAQUE_Z` pushes it a few centimetres toward the camera so it
 * hangs in the opening rather than inside the lintel's own depth.
 */
export const GATE_PLAQUE_WIDTH = 1.34;
export const GATE_PLAQUE_HEIGHT = 0.8;
export const GATE_PLAQUE_Z = 0.04;
/**
 * The two bars the plaque hangs from. Without them the slab floats in the
 * opening with nothing holding it, which at six metres is the one thing that
 * still read as a game object rather than as a thing in the world.
 */
export const PLAQUE_HANGER_WIDTH = 0.045;
export const PLAQUE_HANGER_X = 0.34;

/** How big one leaf, thorn, crown point or crystal is. */
export const ORNAMENT_SIZE = 0.16;
/**
 * How near a gate has to be before it is dressed.
 *
 * Two rows, which is where the kinds are still a decision. Past that the
 * ornament is a few pixels on an arch the player has not chosen a lane for yet,
 * and each kind on screen is a draw call — this is the cap that keeps a row of
 * arches inside the plan's six.
 */
export const ORNAMENT_RANGE = balance.level.rowSpacing * 1.9;

/**
 * The shimmer inside the arch: a billboard of kind-coloured light filling the
 * opening, scrolling upward.
 *
 * Slightly wider than the opening, so its soft edge is hidden behind the legs
 * rather than ending in mid-air, and short of the lintel so the arch reads as
 * stone holding light rather than as a lit rectangle.
 */
export const SHIMMER_WIDTH = ARCH_CLEAR_WIDTH * 1.1;
export const SHIMMER_HEIGHT = ARCH_SOFFIT - 0.1;
export const SHIMMER_Y = SHIMMER_HEIGHT / 2 + 0.02;
/**
 * How much of the shimmer quad's own width the light ramps up over at each
 * side (`./tintedQuads.ts`).
 *
 * The veil tiles horizontally so that the drift can wrap, which leaves the
 * quad's left and right edges as two hard vertical lines. Up close the arch's
 * legs stand in front of them; at two rows out a leg is a couple of pixels wide
 * and the seams read as bright bars inside the opening. A sixth of the width at
 * each side is enough to lose them and still leaves two thirds of the veil at
 * full strength.
 */
export const SHIMMER_EDGE_FADE = 0.17;
/** Base brightness, what a hit adds, and how fast the pattern drifts upward. */
export const SHIMMER_ALPHA = 0.75;
export const SHIMMER_HIT_BOOST = 0.8;
/** Turns of the pattern per second. It drifts across the opening, not up it:
 *  the texture tiles horizontally and fades out at the top and bottom, which is
 *  what keeps the quad from reading as a lit rectangle. */
export const SHIMMER_SCROLL = 0.07;
/** The burst the chosen arch throws as the squad goes through it. */
export const SHIMMER_BURST_ALPHA = 1.5;
export const SHIMMER_BURST_SCALE = 1.6;
/** What a skipped sibling fades to over the same beat. */
export const SHIMMER_SKIPPED_ALPHA = 0.12;
