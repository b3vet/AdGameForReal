/**
 * How a lane wall is drawn (D32).
 *
 * Split out of `./theme.ts`, which owns the rest of the look and had grown past
 * the file-size rule; `theme.ts` re-exports all of it, so every view still
 * reads one module. The pool these sizes feed is in `./pools.ts`, next to the
 * level data it is derived from.
 */

/**
 * Lane walls (D32), drawn as rune-stone fence pieces along `x = ±laneWidth/2`.
 *
 * Low is the whole point of the decision: the squad cannot cross a wall, and
 * shots and streams are unaffected. So the fence has to stand *under* the
 * spells — `BOLT_Y` is 0.66 — and the post height is set just below it, which
 * at `MAGE_HEIGHT` 0.78 puts the rail at a mage's waist. Anything taller reads
 * as a wall the bolts are cutting through.
 *
 * One piece is a post plus the two metres of rail behind it, merged into one
 * mesh and never scaled, so the whole fence is one draw call and a post is
 * always a post. The rail of the piece that closes the near end therefore
 * overhangs the wall's `zStart` by up to `WALL_POST_SPACING` — which is exactly
 * the approach zone (`balance.walls.approach`, 2 m), where the sim's clamp is
 * already biting, so the drawn fence starts where the wall starts to be felt.
 */
export const WALL_POST_HEIGHT = 0.62;
export const WALL_POST_WIDTH = 0.24;
export const WALL_RAIL_HEIGHT = 0.16;
export const WALL_RAIL_WIDTH = 0.13;
/** Rail centre height: low enough that the posts still read as posts. */
export const WALL_RAIL_Y = 0.3;
/** The glowing edge: a thin bar capping the posts, and how thick it is. */
export const WALL_RUNE_HEIGHT = 0.06;
export const WALL_RUNE_WIDTH = 0.18;
/**
 * The approach marker: a brighter cap on the first post the player meets and a
 * rune plate on the road at the line where the clamp starts biting, so the wall
 * is announced two metres before it can push anyone.
 */
export const WALL_MARKER_SCALE = 2.2;
export const WALL_MARKER_PLATE = { width: 0.5, depth: 0.32 } as const;
/**
 * How far ahead a fence is drawn. Past this it is a hairline in the haze and it
 * costs instances; a little over two rows, so the wall guarding the row after
 * next is already in frame when the player is deciding about this one.
 */
export const WALL_DRAW_RANGE = 44;
export const WALL_DRAW_BEHIND = 8;
/** The rune edge breathes, like the lane strips it grows out of. */
export const WALL_PULSE_RATE = 0.45;
export const WALL_PULSE_DEPTH = 0.22;
/** `wallBlocked`: the post nearest the push flares for this long, this much. */
export const WALL_FLASH_DURATION = 0.3;
export const WALL_FLASH_SCALE = 3.2;
export const WALL_FLASH_SIZE = 0.8;
