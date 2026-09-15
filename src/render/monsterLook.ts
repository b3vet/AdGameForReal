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
 * Both are marks on the road rather than puffs of light (`./groundDecals.ts`).
 * They were additive quads in the spell batch through wave two and the first
 * Frostfell hero set showed why that cannot work: additive light only ever
 * reads against something darker than itself, and the Frostfell road is
 * `stone.light` — the brightest surface in the frame. Every puff was
 * arithmetically invisible. A blended disc *darker* than the ground reads on
 * ice and on warm stone alike, and it is also what a heavy thing running
 * through snow actually leaves behind.
 *
 * Both are doubly capped — a ring this long, and at most one new puff every
 * `SPRAY_EVERY` seconds per emitter — because a charge is two seconds of a
 * body moving at 9 m/s and a puff per frame is a smear down the lane.
 */
export const SPRAY_POOL = 24;
/** The decal batch holds both emitters at once, and nothing else draws into it. */
export const SPRAY_DECAL_POOL = SPRAY_POOL * 2;
export const SPRAY_EVERY = 0.055;
/**
 * How long one mark lasts. Longer than the additive puff's 0.42 s: a mark on
 * the ground is a track, and a track that vanishes as fast as a puff of light
 * reads as flicker rather than as a trail.
 */
export const SPRAY_DURATION = 0.55;
/**
 * The Rime Fiend's own two (Milestone 7 review): a mark every `BOSS_WAKE_EVERY`
 * seconds, lasting `BOSS_WAKE_SECONDS`.
 *
 * The charger's numbers above photographed as a scuff under its feet, which is
 * what a charger's dust is. The Fiend's did not photograph at all, and the
 * reason is arithmetic rather than colour: it covers about seven metres in
 * 0.78 s, so at the charger's cadence it sheds fourteen marks half a metre
 * apart — every one of them inside the two metres its own body covers, and the
 * first of them already faded by the time it arrives. What is left is a blot
 * under a three-metre monster in the one lane the squad's volley fills.
 *
 * Spaced at 1.35 m and held for nearly the whole run, the same fourteen marks
 * become nine that lie along the road the body crossed and are all up at once —
 * a line on clean road *behind* the boss, where nothing occludes it and no fill
 * lands. Nine is well inside `SPRAY_POOL`, so the ring never saturates and the
 * head of the track is never the mark that was skipped.
 */
export const BOSS_WAKE_EVERY = 0.15;
export const BOSS_WAKE_SECONDS = 1.3;
export const SPRAY_DRIFT = 0.3;
/**
 * How far over the road the discs lie: above the lane runes at 0.02 and above
 * the blob shadows at 0.026, so a track is drawn over both rather than
 * z-fighting with either.
 */
export const SPRAY_Y = 0.03;
/**
 * Share of a disc's radius that is solid before the rim ramps out to nothing.
 *
 * Half, not a quarter. The rim is a `smoothstep` over what is left, so at 0.25
 * three quarters of every mark was a ramp and the *average* opacity of a puff
 * was a fraction of the alpha it was written with — which is most of why the
 * first two attempts at this effect could not be seen on the road at all. Half
 * a disc solid is a mark with a body; it is still soft enough at the edge that
 * two overlapping puffs read as one track rather than as two coins.
 */
export const DECAL_SOFT_EDGE = 0.5;
/**
 * How wide the *inner* rim of a ring decal ramps, as a share of the disc.
 *
 * A ring is a disc with a hole (`./groundDecals.ts`, Milestone 8), and the hole
 * needs the same softness the outer edge has or a meteor's crater is a cut-out
 * circle on the road. At 0 the ramp vanishes and every existing caller is
 * untouched, which is why this is a separate number rather than a reuse of the
 * outer one: the outer edge ramps over half the disc, and a hole that soft
 * would have no hole left.
 */
export const DECAL_RING_SOFT = 0.12;
/** What a mark is at birth and at death, as a share of the emitter's size. */
export const SPRAY_SIZE_START = 0.7;
export const SPRAY_SIZE_END = 1.6;
/**
 * How big one puff starts, for the charger and for the boss.
 *
 * The Fiend's is half again what it was (Milestone 7 review). Its wake is laid
 * down exactly where the squad's volley lands — the lane between the column and
 * the boss — and that fill is additive and near-clipping, so anything under it
 * survives only as the part of the mark the fill has not yet taken to white. A
 * wider disc is more of that part; see `BOSS_WAKE_COLOR` for the other half.
 */
export const CHARGER_SPRAY_SIZE = 0.9;
export const BOSS_WAKE_SIZE = 2.4;
/** How far behind the body the puff is left, in metres. */
export const CHARGER_SPRAY_BEHIND = 0.35;
export const BOSS_WAKE_BEHIND = 0.9;
/**
 * How far either side of the body a puff is thrown (`FrostSpray`, `spread`).
 *
 * Wider for the boss than for the charger because it is three metres across
 * and its wake would otherwise be entirely behind it from a camera that looks
 * up the road — which is what the first Frostfell probe frame showed. Wider
 * again after the review, with `BOSS_WAKE_SIZE`: two tracks either side of the
 * body read where one under it is inside the volley's own brightest column.
 */
export const CHARGER_SPRAY_SPREAD = 0.5;
export const BOSS_WAKE_SPREAD = 1.15;
/**
 * How hard a mark is drawn at birth; it fades linearly to nothing from there.
 *
 * Blended, not added, so this is opacity, and it is high on purpose. Measured
 * on the Frostfell road (Milestone 7 Phase E): the road is about luminance 144
 * on screen and the mark is 43, so at 0.8 the core of a fresh puff is a little
 * over half way down on the road under it. That is what it takes for a 0.6 m
 * disc twenty metres up an ice road to be seen at all — 0.45 and 0.6 were both
 * measured and both vanished into the tile's own mottling. It still reads as a
 * scuff rather than as paint, because every puff is fading from the frame it is
 * born in and the whole track is gone in half a second.
 */
export const SPRAY_ALPHA = 0.8;
/**
 * What the two sprays are made of, and why neither is a stone role.
 *
 * `stone.deep` was the obvious answer for a body tearing the road open and it
 * is the wrong one: on Frostfell it is #6f8aa3, which is *lighter in luminance
 * than the graded ice road under it* once the road's albedo has been through
 * `stone.light` and the tone mapper. A mark in it changed the road's hue by a
 * few percent and nothing else, which is how a first pass at this shipped a
 * track nobody could see (twice — the additive version had the same answer for
 * a different reason).
 *
 * So both are `shadow.blob`, the one role the palette keeps for "darker than
 * the ground it lies on", and the one that already carries a Frostfell override
 * — a churned track and a contact shadow are the same value family, and the
 * mark is a *hole* in the snow rather than snow in the air.
 *
 * The Fiend's wake was `spell.frost.edge` through Phase E and the review's
 * frame is why it is not (`artifacts/smoke/frost-boss-charge.png`): the frost
 * edge is a cold *hue* and no darker than the road, and the wake is laid down
 * in the one place the squad's volley fills — additive, near-clipping, right
 * down the lane the boss charged. A hue under a saturated additive fill is not
 * a hue at all. Only value survives there, so the wake takes the same dark the
 * dust does and reads as the track it is.
 */
export const CHARGER_SPRAY_COLOR = paletteColor('shadow.blob');
export const BOSS_WAKE_COLOR = paletteColor('shadow.blob');

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
