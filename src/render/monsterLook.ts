/**
 * How the Frostfell monsters are drawn (D49): the charger, the shielded
 * brute's label, and the Rime Fiend's charge.
 *
 * A table of its own, next to `./crowdLook.ts` and `./spellLook.ts`, for the
 * same reason those exist: `./theme.ts` re-exports all of it, so every view
 * still reads one module, and none of these numbers is gameplay — what a
 * charger *does* is `balance.json`, and this is only what it looks like doing
 * it.
 *
 * The colours are roles rather than literals (D36), which is also what makes
 * them follow the biome: `stone.light` is warm stone on the meadow and pale ice
 * on Frostfell, and a charger only ever runs on the second one.
 */

import { paletteColor } from './palette';

/**
 * The charger's mesh scale, on top of the manifest's own 0.45 — which is
 * already the 1.45 m the asset phase measured it at. 1 rather than a number of
 * its own, because a second scale here would silently fight the manifest's.
 */
export const CHARGER_SCALE = 1;
/** Body height in metres, for the number over its head and its blob. */
export const CHARGER_HEIGHT = 1.45;
/**
 * How far a charger leans into the lane it is crossing to, in radians per
 * metre of lateral gap, and the most it may lean.
 *
 * A runner that changes lane without turning at all reads as a body sliding
 * sideways; a runner that turns to face the lane it is *going* to reads as
 * sprinting away from the squad. This is the small amount in between.
 */
export const CHARGER_LEAN_PER_METRE = 0.35;
export const CHARGER_LEAN_MAX = 0.55;
/**
 * How close to the squad a charger has to have died for its death to be the
 * two-clip one: `attack`, then `death`.
 *
 * The sim kills a charger the moment it reaches the crowd (`contact.ts`), so
 * "it arrived" and "it was shot out of the lane" arrive as the same event and
 * the only thing that separates them is where the body was standing. Wider
 * than the sim's own contact distance, because the charger is drawn at its own
 * position and the crowd's front rank is a metre deep.
 */
export const CHARGER_ATTACK_RANGE = 2.5;
/** Where a charger's number floats: over its head, like a brute's over a block. */
export const CHARGER_LABEL_HEIGHT = CHARGER_HEIGHT + 0.25;
/**
 * The ink a body in motion prints its number in.
 *
 * The palette's one alarm colour, and the only place on the road that uses it
 * for a number: a charger wears it from the step it sets off, and a shielded
 * brute from the step its shield breaks. Both are saying the same thing — this
 * one is happening now — and nothing else in the frame says it.
 */
export const DANGER_LABEL_COLOR = paletteColor('danger.light');

/**
 * The shielded brute's second number (D49).
 *
 * It rides above the body's own, which keeps the two in one column and leaves
 * the block's HP where the player already reads it. Smaller than the HP number
 * — the shield is the thing to break, not the thing to count down — and never
 * below `SHIELD_LABEL_MIN` design pixels, which is where the shield glyph in
 * front of it stops being a shield.
 */
export const SHIELD_LABEL_RISE = 0.62;
/** Ice over the block's own bone-white number, so the two never read as one. */
export const SHIELD_LABEL_COLOR = paletteColor('spell.frost.core');
export const SHIELD_LABEL_SIZE = 22;
export const SHIELD_LABEL_MIN = 11;

/**
 * The burst a shield breaks with, in the shared sprite batch: a ring of frost
 * chips at the event's own position, on top of whatever the physics layer
 * throws (`src/physics/bursts.ts`), so the break still reads at quality 0
 * where there is no Havok at all.
 */
export const SHIELD_BREAK_SPOKES = 7;
export const SHIELD_BREAK_RADIUS = 0.75;
export const SHIELD_BREAK_SIZE = 0.46;
export const SHIELD_BREAK_DURATION = 0.34;
export const SHIELD_BREAK_COLOR = paletteColor('spell.frost.body');

/**
 * The spray a running body kicks up: the charger's dust and the Rime Fiend's
 * wake are the same effect at two sizes (`./frostSpray.ts`).
 *
 * Both land in the shared sprite batch, so neither costs a draw call, and both
 * are doubly capped — a ring this long, and at most one new puff every
 * `SPRAY_EVERY` seconds per emitter — because a charge is two seconds of a
 * body moving at 9 m/s and a puff per frame is a fog bank down the lane.
 */
export const SPRAY_POOL = 24;
export const SPRAY_EVERY = 0.055;
export const SPRAY_DURATION = 0.42;
export const SPRAY_RISE = 0.35;
export const SPRAY_DRIFT = 0.3;
export const SPRAY_Y = 0.12;
/** How big one puff starts, for the charger and for the boss. */
export const CHARGER_SPRAY_SIZE = 0.42;
export const BOSS_WAKE_SIZE = 0.95;
/** How far behind the body the puff is left, in metres. */
export const CHARGER_SPRAY_BEHIND = 0.35;
export const BOSS_WAKE_BEHIND = 0.9;
/**
 * How far either side of the body a puff is thrown (`FrostSpray`, `spread`).
 *
 * Wider for the boss than for the charger because it is three metres across
 * and its wake would otherwise be entirely behind it from a camera that looks
 * up the road — which is what the first Frostfell probe frame showed.
 */
export const CHARGER_SPRAY_SPREAD = 0.35;
export const BOSS_WAKE_SPREAD = 0.85;
/** How hard a puff is drawn at birth; it fades to nothing from there. */
export const SPRAY_ALPHA = 0.75;
/**
 * What the two sprays are made of: the road the charger is tearing up, and the
 * frost the Rime Fiend leaves behind it.
 */
export const CHARGER_SPRAY_COLOR = paletteColor('stone.light');
export const BOSS_WAKE_COLOR = paletteColor('spell.frost.core');

/**
 * The kick the Rime Fiend's charge gives the camera.
 *
 * Deliberately under the stomp's (`SHAKE_STOMP`, 0.15 for 0.3 s): the stomp is
 * the hit, and the charge is the wind-up to one. A charger's own `charge`
 * event does not shake at all — it goes off twenty metres up the road, and a
 * kick there would read as something landing on the crowd.
 */
export const SHAKE_CHARGE = { strength: 0.11, seconds: 0.26 } as const;

/**
 * Seconds past `EnemyState.charge.until` the Rime Fiend keeps running before it
 * is drawn walking home.
 *
 * The sim's `until` is when the run in *should* be over at the gap it set off
 * from; the walk back then takes as long as it takes. Running a little past the
 * deadline covers the frame or two a slow step costs, and a lunge that ends a
 * frame early is a boss sliding the last metre on the walk clip.
 */
export const BOSS_CHARGE_OVERRUN = 0.15;
/**
 * Radians per second the boss turns at when it swaps between facing the squad
 * and facing home. A snap would be a three-metre body spinning in one frame;
 * much slower and it walks home backwards.
 */
export const BOSS_TURN_RATE = 7;
