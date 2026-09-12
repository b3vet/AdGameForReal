/**
 * How the Milestone 4 spell effects are drawn: the wisp (D33), ember's burn and
 * frost's shatter puff (D33, tier 2).
 *
 * Split out of `./theme.ts` for the file-size rule, exactly as `./palette.ts`
 * and `./pools.ts` were in Milestone 3; `theme.ts` re-exports all of it.
 *
 * Everything here is measured in metres and seconds and lands in the shared
 * sprite batch (`./sprites.ts`), so none of it costs a draw call.
 */

/**
 * The wisp (D33): a hovering orb beside the squad, its rings, and the spark it
 * throws.
 *
 * Everything here is a billboarded quad in the shared sprite batch
 * (`./sprites.ts`), so the familiar costs no draw call of its own.
 */
export const WISP_SIZE = 0.42;
/**
 * How hard the orb is drawn. Not 1: the sheet's core is white-hot and the layer
 * is additive, so at full strength the orb saturates every channel and the one
 * hue that says "this is not your own fire" comes out as a white blob (the
 * first level-20 frame it was shot in). At 0.8 the green rim survives and the
 * core still reads as lit.
 */
export const WISP_ALPHA = 0.8;
/** Each tier is a shade bigger, and carries one more ring. */
export const WISP_TIER_GROWTH = 0.12;
export const WISP_Y = 1.15;
export const WISP_BOB_RATE = 0.7;
export const WISP_BOB_HEIGHT = 0.11;
/** Ring radii as shares of the orb, and how fast each one turns. */
export const WISP_RING_SCALE = 2;
export const WISP_RING_STEP = 0.55;
export const WISP_RING_SPIN = 0.8;
export const WISP_RING_ALPHA = 0.5;
/** The mote it sheds: one every this many seconds, living this long. */
export const WISP_TRAIL_EVERY = 0.09;
export const WISP_TRAIL_DURATION = 0.4;
export const WISP_TRAIL_SIZE = 0.16;
/** The spark in flight, and the two quads trailing it. */
export const WISP_SPARK_SIZE = 0.3;
export const WISP_SPARK_TAIL = 2;
export const WISP_SPARK_TAIL_GAP = 0.22;
/** Where a spark flies: the wisp's own height falling to the body's chest. */
export const WISP_SPARK_Y = 0.7;
/** The flash where it lands. */
export const WISP_BURST_SIZE = 0.6;
export const WISP_BURST_DURATION = 0.22;
/** A spark whose target died mid-flight fades out over this long instead. */
export const WISP_FIZZLE_DURATION = 0.16;

/**
 * Ember's burn (D33, tier 2). A body alight carries a soft additive wash the
 * size of its own footprint — which under additive blending is what "an ember
 * tint" means on a crowd whose shader has no per-instance colour — plus a
 * flame licking off the top of it and the odd spark thrown clear.
 */
export const BURN_WASH_SIZE = 0.62;
export const BURN_FLAME_SIZE = 0.44;
export const BURN_FLAME_Y = 0.5;
export const BURN_FLAME_FPS = 11;
/** How far a burning body's flame is drawn. Past this it is a warm dot. */
export const BURN_DRAW_RANGE = 42;
/** One burning body in this many sheds a spark on any given frame. */
export const BURN_SPARK_EVERY = 7;
export const BURN_SPARK_SIZE = 0.16;

/**
 * Frost's shatter (D33, tier 2): the ice going off takes the neighbours with
 * it, and this is that — a ring of chips thrown out to the shatter's own radius
 * rather than another impact burst on the body that just died.
 */
export const SHATTER_PUFF_SPOKES = 6;
export const SHATTER_PUFF_SIZE = 0.34;
export const SHATTER_PUFF_DURATION = 0.3;
