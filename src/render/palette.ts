/**
 * The palette: every colour the Babylon layer paints with.
 *
 * Split out of `./theme.ts` in Milestone 3 Phase D, which had grown past the
 * file-size rule; `theme.ts` re-exports all of it, so nothing imports from here
 * directly and the palette stays one list rather than a set of literals spread
 * through the views.
 *
 * Bright and casual, per docs/09-milestone-3-plan.md and decision D28: a light
 * blue sky falling to a warm pale horizon, a light warm stone road, green
 * field, and three saturated spell colours — ember orange, storm violet, frost
 * cyan. Gate panels stay the most readable thing in frame.
 *
 * This supersedes Milestone 2's near-black dusk (the dark half of D21). The
 * whole set moves together: lights (`./scene.ts`), sky dome (`./road.ts`) and
 * the emissive lifts in `./models.ts` were all tuned against a scene with no
 * ambient in it, so raising the ambient without dropping the lifts washes every
 * character out to white.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

/** Sky gradient, bottom to top. The fog fades to `FOG_COLOR`, so there is no seam. */
export const SKY_HORIZON = new Color3(0.99, 0.93, 0.79);
export const SKY_HAZE = new Color3(0.82, 0.9, 0.97);
export const SKY_MID = new Color3(0.45, 0.71, 0.97);
export const SKY_ZENITH = new Color3(0.25, 0.55, 0.93);
/** What the canvas clears to: the top of the dome, for the pixels it misses. */
export const SKY = SKY_ZENITH;
/**
 * Daylight haze. The road runs into it at `FOG_END`, and the dome carries the
 * same colour in its horizon band, so the far end of the level dissolves
 * instead of stopping in mid-air.
 */
export const FOG_COLOR = new Color3(0.89, 0.91, 0.86);
export const FOG_START = 46;
export const FOG_END = 130;

/** Light warm stone, so the road is the bright floor the crowd reads against. */
export const ROAD_COLOR = new Color3(0.86, 0.79, 0.66);
/** Grass either side, the one large cool-green mass in the frame. */
export const FIELD_COLOR = new Color3(0.44, 0.67, 0.34);
/**
 * Lane runes. Brighter and bluer than Milestone 2's: on a near-black road a dim
 * violet line was already the loudest thing on the ground, and on light stone
 * the same colour disappears. The gate panels still win, because they are two
 * metres tall and these are twelve centimetres wide.
 */
export const LANE_LINE_COLOR = new Color3(0.36, 0.58, 1);
export const ARENA_COLOR = new Color3(1, 0.55, 0.16);

/** The three staffs. Everything a weapon touches is one of these three hues. */
export const EMBER_COLOR = new Color3(1, 0.45, 0.1);
export const STORM_COLOR = new Color3(0.72, 0.42, 1);
export const FROST_COLOR = new Color3(0.36, 0.86, 1);

/** The stand-in colour for a crowd whose model could not be loaded. */
export const ENEMY_COLOR = new Color3(0.82, 0.18, 0.16);
export const BOSS_ENRAGE_COLOR = new Color3(1, 0.12, 0.06);
export const STOMP_COLOR = new Color3(1, 0.5, 0.18);

/** Gate tints, per `GateKind`. Keys are checked against the sim's union below. */
export const GATE_TINTS = {
  add: new Color3(0.24, 0.95, 0.45),
  sub: new Color3(1, 0.26, 0.28),
  mul: new Color3(0.34, 0.62, 1),
  fireRate: new Color3(1, 0.8, 0.22),
  /**
   * Staff gates. A violet leaning white rather than another saturated hue: this
   * is the only panel that prints a word instead of a number, and the pale tint
   * keeps the letters legible while the violet still reads apart from `mul`'s
   * blue at a glance.
   */
  weapon: new Color3(0.85, 0.66, 1),
} as const;

/**
 * Label ink. The digit atlas paints its glyphs white with a near-black outline
 * and the shader multiplies by these, so a tint only ever darkens the ink and
 * the outline stays the outline (`src/render/labels.ts`).
 */
export const GATE_LABEL_COLOR = new Color3(1, 1, 1);
export const ENEMY_LABEL_COLOR = new Color3(1, 0.914, 0.902);
export const BOSS_LABEL_COLOR = new Color3(1, 0.851, 0.824);
/**
 * The number floating over a stream's head. In the gate numbers' family — white
 * ink with the atlas's own dark outline — so the player reads it as "a number
 * that matters" rather than as another enemy HP tag, but cooled a shade so it
 * is not mistaken for a gate on a lane with no panel in it.
 */
export const STREAM_LABEL_COLOR = new Color3(0.93, 0.97, 1);

/** The ring under a frost-slowed block: the frost staff's own hue. */
export const SLOW_RING_COLOR = FROST_COLOR;

/**
 * Lane walls (D32). Cool grey stone for the posts and rails, and an amber rune
 * for the top edge.
 *
 * The stone started in the road's own warm family and vanished into it: a fence
 * at `x = ±1` stands on light stone with green either side, and at twenty
 * metres a warm grey post against a warm stone road is the same pixel. Cooling
 * and darkening it is what gives the posts an edge; the rune then reads as the
 * lit part of a solid thing rather than as a line floating over the road.
 *
 * Amber rather than another of the spell hues: the fence is in frame for ten to
 * twenty metres at a time, right next to the gate panels, and every saturated
 * hue in the palette already means something the player has to decide about
 * (green add, red sub, blue mul and the lane runes, yellow fire rate, violet
 * staff). Amber is the one warm accent nothing else claims on the road, and it
 * reads as "carved stone lit from inside" against the light stone it sits on.
 */
export const WALL_STONE_COLOR = new Color3(0.6, 0.57, 0.53);
export const WALL_RUNE_COLOR = new Color3(1, 0.66, 0.2);

/**
 * The wisp (D33). A pale green-white will-o'-the-wisp: the one hue on the road
 * that is neither a staff nor a gate, so a familiar hovering beside the squad
 * is never mistaken for the squad's own fire. The sprite sheet carries a
 * white-hot core, so this only has to say which way the rim leans.
 */
export const WISP_COLOR = new Color3(0.68, 1, 0.72);

/**
 * Ember's burn (D33). Hotter and yellower than `EMBER_COLOR`: a body alight is
 * lit from inside, and the flame has to read on top of the ember impacts
 * already going off on the same body.
 */
export const BURN_COLOR = new Color3(1, 0.62, 0.14);
