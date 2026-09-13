/**
 * How the road is built (Milestone 5 plan, "Road texture bad").
 *
 * Split out of `./road.ts` for the same reason `./wallLook.ts` was split out of
 * `./theme.ts`: the file that draws the road is long enough without the numbers
 * that describe it. Only the road files read these, so they import this module
 * directly rather than through `./theme.ts` — the re-export can be added there
 * if anything else ever needs them.
 *
 * The road is five things stacked from the middle out: a cobbled surface, a
 * worn stripe down each lane, a gutter shadow where the stone meets the kerb,
 * a run of kerb stones along both edges, and a band of grass overlapping the
 * kerb into the field. Each is one mesh drawn as thin instances, placed once
 * per level and then frozen — nothing here costs anything per frame.
 */

import { balance } from '@/data';

/**
 * Metres of road one repeat of the cobble albedo covers.
 *
 * The ambientCG tile is about nine stones across, so at 2.2 m a cobble is a
 * little under a quarter of a metre — the size of a real sett, and about eight
 * screen pixels at the near edge of the frame, which is what stops the road
 * reading as wallpaper when the squad walks over it.
 */
export const COBBLE_TILE_METRES = 2.2;
/** The grass tile is coarser and further from the camera, so it repeats wider. */
export const GRASS_TILE_METRES = 3.4;

/**
 * How far past the level's own end the dressed road runs, and how far the bare
 * surface runs past *that*.
 *
 * The fog ends at 260 m (`FOG_END`), and the camera can stand at the arena
 * looking down the rest of the road, so a surface that stopped at the level's
 * end would end in mid-air inside the haze. `Renderer` already asks for 80 m
 * past the arena; this adds 40 m of dressed road on top — kerbs, verge, wear —
 * because that is as far past the fight as a player can make anything out, and
 * then 220 m in which only the surface and the field continue. That tail is the
 * filler strip: it is the same two meshes stretched further, so the road runs
 * to the horizon at no extra draw call.
 */
export const ROAD_RUNOUT = 40;
export const ROAD_FILLER = 220;

/** One kerb stone: a low block with a chamfered cap, repeated down both edges. */
export const KERB_LENGTH = 1.6;
export const KERB_WIDTH = 0.28;
export const KERB_HEIGHT = 0.15;
export const KERB_CAP_WIDTH = 0.21;
export const KERB_CAP_HEIGHT = 0.06;
/**
 * The gap between two kerb stones, which is what makes a run of them read as
 * cut stone rather than as an extruded strip.
 */
export const KERB_GAP = 0.06;
/** How far the kerb's inner face overlaps the road, so no seam shows through. */
export const KERB_OVERLAP = 0.05;

/**
 * The gutter: a soft dark band painted on the road along both kerbs.
 *
 * This is the "baked ambient darkening" of the plan. The scene has one
 * directional light and a toon ramp, so nothing in it would ever put a contact
 * shadow where the kerb meets the stone; the band is that shadow, and it is
 * what makes the kerb sit *on* the road rather than float over it.
 */
export const GUTTER_WIDTH = 1.0;
export const GUTTER_ALPHA = 0.5;

/** The grass fringe: overlaps the kerb and fades out into the open field. */
export const FRINGE_WIDTH = 2.6;
export const FRINGE_OVERLAP = 0.24;

/**
 * Lane wear: a worn track down the middle of each lane, where the traffic goes.
 *
 * Wide enough to be a track (a lane is 2 m) and faint enough to read as
 * polish rather than as a painted line — the lane runes are the line, and two
 * marks per lane saying the same thing would be one too many.
 */
export const WEAR_WIDTH = balance.road.laneWidth * 0.62;
export const WEAR_ALPHA = 0.16;

/** Lane boundaries for a three-lane road: the two edges and the two splits. */
export const LANE_RUNE_WIDTH = 0.1;
/** Rune pulse: cycles per second, and how far the emissive swings. */
export const RUNE_PULSE_RATE = 0.6;
export const RUNE_PULSE_DEPTH = 0.3;
/**
 * How hot the rune strips run. Lower than Milestone 3's 0.95: they used to be
 * the only crafted thing on the road, and on cobbles with kerbs and a grass
 * verge either side a strip that bright is the only thing in frame.
 */
export const RUNE_EMISSIVE = 0.7;

/**
 * Ambient motes (plan, "Props re-tinted to the palette; sky dome; ambient
 * motes"): slow additive specks drifting over the road in the three spell
 * hues, at an alpha low enough to read as air rather than as effects.
 */
export const MOTE_COUNT = 42;
/** The box they drift in, around the camera: half-width, height, and depth. */
export const MOTE_SPAN_X = 14;
export const MOTE_SPAN_Z = 34;
export const MOTE_Y_MIN = 0.4;
export const MOTE_Y_MAX = 3.4;
export const MOTE_SIZE_MIN = 0.07;
export const MOTE_SIZE_MAX = 0.16;
export const MOTE_ALPHA = 0.3;
/** Metres a mote rises per second, and how far it sways either side of that. */
export const MOTE_RISE = 0.22;
export const MOTE_SWAY = 0.35;
export const MOTE_SWAY_RATE = 0.35;
