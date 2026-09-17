/**
 * How the level-design plan's new moments are drawn (document 31, 4.1): a
 * block setting off, a block holding its line, and a river pouring from a
 * fixed place on the road.
 *
 * A table of its own beside `./monsterLook.ts`, which it borrows its marks from
 * and which is not this track's file; `./theme.ts` re-exports all of it, so
 * every view still reads one module. None of it is gameplay: where a block
 * wakes and when a portal opens are `EnemyState.wake` and `StreamDef.openAt`,
 * and this is only what the player sees when they do.
 *
 * Both are marks in the shared ground-decal batch (`./groundDecals.ts`), for
 * the reason `./monsterLook.ts` gives at length: additive light cannot be seen
 * on the light roads of either biome, and a blended mark darker than the
 * ground reads on both. Neither costs a draw call or a material.
 */

import { paletteColor } from './palette';

/**
 * The squash a block plays the step it wakes: a crouch, then a rise onto its
 * toes, the size of a roar rather than of a jump. Blocks stood still for up
 * to seventy metres of approach, and this is what says "that one is coming
 * now" — the one moment of an ambush that has to be seen. A guard, which
 * wakes on its hold line at contact, plays none (`stanceOf`, `./enemyBlocks.ts`).
 *
 * `depth` is the crouch as a share of height (the width grows by the same
 * share), and the rise reaches `rise` of it the other way. The skeletons at
 * the back of the block play it `stagger` seconds late, so it ripples through
 * the mob rather than squashing one rigid box.
 */
export const WAKE_SQUASH_SECONDS = 0.5;
export const WAKE_SQUASH_DEPTH = 0.28;
export const WAKE_SQUASH_RISE = 0.75;
/** Share of the cue spent crouching before the rise. */
export const WAKE_SQUASH_CROUCH = 0.35;
export const WAKE_SQUASH_STAGGER = 0.09;

/**
 * The squash at `seconds` into the cue: positive is a crouch (shorter and
 * wider), negative a rise (taller and thinner), zero outside the cue.
 */
export function wakeSquash(seconds: number): number {
  if (seconds <= 0 || seconds >= WAKE_SQUASH_SECONDS) return 0;
  const t = seconds / WAKE_SQUASH_SECONDS;
  if (t < WAKE_SQUASH_CROUCH) {
    return WAKE_SQUASH_DEPTH * Math.sin((Math.PI * t) / WAKE_SQUASH_CROUCH);
  }
  const rise = (t - WAKE_SQUASH_CROUCH) / (1 - WAKE_SQUASH_CROUCH);
  return -WAKE_SQUASH_DEPTH * WAKE_SQUASH_RISE * Math.sin(Math.PI * rise);
}

/**
 * The block's number, the same moment: it pops to `WAKE_POP` over its size and
 * back in `WAKE_POP_SECONDS`, and prints in the alarm ink for
 * `WAKE_ALARM_SECONDS` (`DANGER_LABEL_COLOR`, which is otherwise a charger's
 * run and a broken shield — the other bodies that are happening *now*).
 *
 * The squash and the dust are measured at 24 m, where they read; the plan wakes
 * a guard at 45 m, where a brute is fifteen pixels tall and the road is
 * foreshortened nine times over, so a mark on it is a line. The number is the
 * one thing out there that is still its full size on screen.
 */
export const WAKE_POP = 0.45;
export const WAKE_POP_SECONDS = 0.32;
export const WAKE_ALARM_SECONDS = 1;
/** How long a slot keeps the cue's clock: until the last of the three ends. */
export const WAKE_CUE_SECONDS = Math.max(
  WAKE_SQUASH_SECONDS + WAKE_SQUASH_STAGGER,
  WAKE_POP_SECONDS,
  WAKE_ALARM_SECONDS,
);

/** The number's size multiplier at `seconds` into the cue. */
export function wakePop(seconds: number): number {
  if (seconds <= 0 || seconds >= WAKE_POP_SECONDS) return 1;
  return 1 + WAKE_POP * Math.sin((Math.PI * seconds) / WAKE_POP_SECONDS);
}

/**
 * A block standing on its beat's hold line (`EnemyState.holdZ`): a guard from
 * the first frame it is drawn, an ambush once it has walked through its panel.
 * The sim holds it there until the column arrives, so its walk would march on
 * the spot for seconds. The skeleton rigs bake no idle, so the stance is made
 * of the walk: the pose `HOLD_FRAME` seconds into the clip, rocked `HOLD_SWAY`
 * seconds either side at `HOLD_SWAY_HZ` and breathing by `HOLD_BREATH` of its
 * height, and the mob faces the column squarely (`HOLD_YAW` of scatter, a third
 * of a waiting block's): a line that is holding rather than a mob that is about
 * to set off.
 *
 * The frame is measured off the rigs rather than picked by eye. Both walks
 * (`Walking_C`, `Walking_D_Skeletons`) plant their feet on the same beat: at
 * 0.685 s both feet are at their lowest together and the stride is at its
 * widest (as far apart as the hips are high, arms swung fore and aft), the
 * one pose of the cycle that stands. Rocked 0.045 s either side, one heel lifts as
 * the other settles, which is the weight going from foot to foot.
 */
export const HOLD_FRAME = 0.685;
export const HOLD_SWAY = 0.045;
export const HOLD_SWAY_HZ = 0.55;
export const HOLD_BREATH = 0.025;
export const HOLD_BREATH_HZ = 0.9;
export const HOLD_YAW = 0.2;
/** How far behind its line a block still counts as standing on it, in metres. */
export const HOLD_SLACK = 0.001;

/**
 * The dust a waking block kicks up: a ring of marks thrown out from under its
 * feet. The charger's dust colour and opacity (`CHARGER_SPRAY_COLOR`,
 * `SPRAY_ALPHA`), because it is the same thing — a body tearing the road — and
 * the same value family is what reads on ice and warm stone alike.
 *
 * `size` is one mark's diameter as a share of the block's footprint, `drift`
 * how far out it travels as a share of the same.
 */
export const WAKE_KICK_PUFFS = 7;
export const WAKE_KICK_SECONDS = 0.65;
export const WAKE_KICK_SIZE = 1.4;
export const WAKE_KICK_DRIFT = 0.9;
export const WAKE_KICK_ALPHA = 0.85;
export const WAKE_KICK_COLOR = paletteColor('shadow.blob');

/**
 * A portal (document 31, 3.1): the place a river pours from, marked by a ring
 * on the road in the enemies' own role (`ENEMY_COLOR`, `danger.base`) for as
 * long as it has bodies to send.
 *
 * Nearly the lane's width, so the ring says which lane the river will fill,
 * and a ring rather than a disc so the bodies stepping out of it stand on
 * road. It breathes while it waits, swells as it opens, and fades when it is
 * poured out or the squad reaches it — the sim stops the pour
 * `enemies.portal.stopGap` short of the squad, and a ring left up past that
 * marks a place nothing will come out of.
 */
export const PORTAL_RING_SIZE = 2.3;
export const PORTAL_RING_INNER = 0.38;
export const PORTAL_RING_ALPHA = 0.85;
/** How far the alpha swings either side while it waits, and how fast. */
export const PORTAL_PULSE_DEPTH = 0.18;
export const PORTAL_PULSE_HZ = 1.1;
/** How much wider and harder it is drawn while it pours. */
export const PORTAL_OPEN_SCALE = 1.15;
export const PORTAL_OPEN_ALPHA = 1;
/** How long it takes to open out to that size, and to fade once it is done. */
export const PORTAL_OPEN_SECONDS = 0.35;
export const PORTAL_FADE_SECONDS = 0.6;
export const PORTAL_COLOR = paletteColor('danger.base');

/**
 * The burst a portal throws the moment it opens: the waking block's dust kick
 * at a portal's size, in the enemies' deep red rather than in shadow, so it
 * reads as the ring breaking open rather than as something landing.
 */
export const PORTAL_BURST_PUFFS = 8;
export const PORTAL_BURST_SECONDS = 0.6;
export const PORTAL_BURST_SIZE = 0.75;
export const PORTAL_BURST_DRIFT = 1.1;
export const PORTAL_BURST_ALPHA = 0.8;
export const PORTAL_BURST_COLOR = paletteColor('danger.deep');

/**
 * The see-through plaque a gate wears while a threat stands behind it
 * (`./gateScreens.ts`).
 *
 * `depth` is how far behind the row a threat still counts: the plaque hides the
 * road up to 9 m behind a row 14 m out and up to 13 m behind one 26 m out, and
 * a guard standing in front of the *next* row is 10 m behind this one — so 14
 * covers every beat's anchor without reaching the row after. `alpha` is the
 * slab's opacity: enough of the dark carving left for a number's white ink to
 * read against, and a skeleton behind it plain as a skeleton.
 */
export const PLAQUE_SCREEN_DEPTH = 14;
export const PLAQUE_GLASS_ALPHA = 0.42;

/**
 * Marks the two cues can have on the road at once, as decal instances: two
 * blocks waking together, a portal bursting, and every portal ring in sight
 * with room for the ones fading out.
 */
export const KICK_POOL = WAKE_KICK_PUFFS * 2 + PORTAL_BURST_PUFFS * 2;
export const PORTAL_RING_POOL = 6;
export const BEAT_DECAL_POOL = KICK_POOL + PORTAL_RING_POOL;
