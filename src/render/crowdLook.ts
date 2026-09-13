/**
 * How the crowds are drawn: how tall a unit is, how it shrinks as the squad
 * packs together, how its baked clips are played, and how the view decides the
 * squad is running rather than standing still.
 *
 * Split out of `./theme.ts` in Milestone 4 Phase C, which had grown past the
 * file-size rule (CLAUDE.md); `theme.ts` re-exports all of it, so every view
 * still reads one module. Grouped because these are the numbers task P's
 * walking-glitch fix left behind — the smoothing, the clip speeds and the sway
 * only make sense read together.
 */

import { unitSpacing } from '@/sim';

/**
 * Mage height in metres, and the skeletons' relative to it.
 *
 * Milestone 2 settled on 0.66 m because a full-size KayKit hat is wider than
 * the mage's shoulders and, from a 36-degree camera, a crowd of them was a
 * field of brims. Milestone 3 fixes the cause rather than the symptom (plan,
 * "Squad reads as hats"): the hat is scaled to 0.88 in the merge
 * (`assets.json` → `partScales`, which says why it cannot go lower), the camera
 * drops to about 26 degrees so the units are seen from nearer their own height,
 * and the formation spacing is wider. With all three, 0.78 m is faces, robes
 * and staffs rather than brims.
 */
export const MAGE_HEIGHT = 0.78;
export const GRUNT_HEIGHT = 0.72;
/** The brute is the silhouette that says "this row is going to hurt". */
export const BRUTE_HEIGHT = 0.92;
/** What a KayKit character is tall at the manifest's own scale of 0.35. */
const KAYKIT_UNIT_HEIGHT = 0.62;
/** Multipliers on that scale, which is what `VatCrowd.setInstance` takes. */
export const MAGE_SCALE = MAGE_HEIGHT / KAYKIT_UNIT_HEIGHT;
/**
 * Self-lit share of the mage's own albedo, a little above what the enemies get
 * (`CHARACTER_LIFT` in `models.ts`).
 *
 * Much smaller than Milestone 2's 0.34: that number existed because the biome
 * was a near-black dusk and a navy mage under it was a silhouette. Under D28's
 * daylight the ambient does that work, and a third of the albedo added back on
 * top clips the robes to flat white.
 */
export const MAGE_LIFT = 0.14;
export const GRUNT_SCALE = GRUNT_HEIGHT / KAYKIT_UNIT_HEIGHT;
export const BRUTE_SCALE = BRUTE_HEIGHT / KAYKIT_UNIT_HEIGHT;

/**
 * Unit meshes shrink as the crowd tightens, so the mages never read as one
 * solid slab: the sim packs 500 units into the same 1.6 m lane as 100.
 *
 * Milestone 3 changes what the shrink follows. Milestone 2 eased from 1 to 0.72
 * between 50 and 500 units, which was a guess; the number that actually decides
 * whether two mages overlap is the sim's own `unitSpacing`, so the scale is
 * that spacing measured against what it is at `CROWD_SCALE_FROM` (see
 * `crowdScale` in `./squad.ts`). A unit is then a constant fraction of the gap
 * it has to stand in, at every squad size, which is the thing the eye reads.
 *
 * This is where the plan's "formation spacing raised" landed, and it is still
 * where it has to land. In Milestone 3 the spacing had nowhere to go because
 * the crowd was as wide as the road clamp allowed; under D42 the ceiling is the
 * lane instead — `halfWidth(80)` is 0.8, which is half the 1.6 m band exactly,
 * against the 1.0 the road clamp would permit — and a wider spacing inside a
 * fixed band buys nothing anyway, because it takes columns *out* of the rows
 * and pays for them in depth the camera cannot frame. The separation between
 * two mages has to come from the drawn size instead, and this is it.
 *
 * The floor is the dense end: past about a hundred units the crowd is *meant*
 * to be shoulder to shoulder, and shrinking further only makes ants.
 *
 * D42 raises that floor from 0.6 to 0.7, and it is now a framing number rather
 * than a taste one. The plan asks that a 500-unit front rank be no smaller on
 * screen than 70% of a 50-unit one; measured at 390x844 against the column, the
 * Phase E rig and a floor of 0.6 gave 48%. Most of that is the camera and the
 * new caps answer it (64%), but the last of it is the mesh: the column's
 * spacing bottoms out at 0.25 m where the wide formation's did at 0.28, so the
 * unshrunk scale at five hundred is 0.62 where it used to be 0.69, and no
 * camera can put that back — a shot that zoomed *in* on the biggest crowd would
 * be framing six ranks of seventy-seven. At 0.7 the front rank measures 32.3 px
 * against 43.5, which is 74%. A mage is then 0.55 m tall standing 0.25 m from
 * its neighbour — shoulders just touching, which is the packed mass the plan
 * asks for, and still short of the slab a floor of 1 would draw.
 */
export const CROWD_SCALE_FROM = 8;
export const CROWD_SCALE_MIN = 0.7;
/** Scale bounce for a unit that just appeared. */
export const POP_DURATION = 0.28;
/**
 * How far a popping unit stretches on y before it settles. Squash-and-stretch:
 * the overshoot in `popScale` alone reads as a unit that grew, and stretching
 * the same unit tall while it is thin is what reads as a unit that *landed*.
 */
export const POP_STRETCH = 0.45;
/** Shrink-and-fade for a unit that just died. */
export const DEATH_DURATION = 0.3;

/**
 * Casual timing (D28): the baked clips are played faster than the artist's own
 * tempo. `VatCrowd.setInstance` takes this as its `speed`.
 */
export const RUN_CLIP_SPEED = 1.3;
export const CAST_CLIP_SPEED = 1.25;
/** `cast2` is `Spellcast_Raise`, a 2.1 s windup; at 1.8 it matches the volley. */
export const CAST2_CLIP_SPEED = 1.8;
export const IDLE_CLIP_SPEED = 1;

/**
 * How the squad decides it is running rather than standing still.
 *
 * Milestone 4 (task P) answered this by differencing `squad.z` between frames,
 * which on a 120 Hz display saw the squad standing still every other frame — a
 * whole crowd cutting from `run` to `idle` and back, with the idle sway
 * snapping on top of it, 120 frames in 240 drawn standing still. The smoothing
 * below is what bridged that gap.
 *
 * D43 removes the gap instead of bridging it: the agents carry their own
 * velocities, so the view reads the crowd's mean `vz` — a physical fact the
 * sim already holds, which is the same number on a frame that took a step and
 * on one that fell between two. What the smoothing still buys is the *stop*:
 * the crowd should not cut out of `run` on the single step it touches the
 * arena, and a squad hovering at the threshold should not flicker, which is
 * what the hysteresis pair is for.
 */
export const ADVANCE_SMOOTHING = 0.12;
export const ADVANCE_START_SPEED = 0.5;
export const ADVANCE_STOP_SPEED = 0.2;

/**
 * Idle sway. A VAT cannot blend, and the mage rig has one idle clip, so the
 * variety is added on top of it: each unit rocks a few degrees of yaw and a
 * centimetre of height on its own phase, which is what turns a hundred
 * identical idle loops into a crowd shifting its weight.
 */
export const IDLE_SWAY_RATE = 0.55;
export const IDLE_SWAY_YAW = 0.11;
export const IDLE_SWAY_LIFT = 0.012;

/**
 * How far a unit's own facing may wander from straight ahead, in radians, and
 * how far apart in its own loop two units may be, in seconds.
 *
 * Both are what `index % 7` and `index % 29` spanned before D42 scrambled them
 * (`scramble`): a crowd that all faced exactly forward would read as printed,
 * and one spread much wider than eight degrees stops reading as a rank at all.
 * The clip spread is a shade under the run clip's own length, so the phases
 * cover the loop once rather than doubling back over the first half of it.
 */
export const UNIT_YAW_SPREAD = 0.15;
export const UNIT_CLIP_SPREAD = 1.15;

/**
 * Slowest the gate hop may travel down the column, in metres a second.
 *
 * The wave's real speed is the crowd's own measured forward speed, because what
 * it draws is a physical fact: the row the squad just crossed reaches the tenth
 * rank two metres of road later than the first, and a 500-unit column takes
 * 13 m of road to pass through a gate (`SquadView.update`). The floor is only
 * for the cases where that speed is not a speed — the first frames of a level,
 * where it is still `NaN`, and the arena, where the crowd has stopped — and it
 * is a little under the shipped run speed so a hop there still crosses the
 * crowd in a couple of seconds rather than stalling half-way down it.
 */
export const GATE_HOP_WAVE_FLOOR = 4;

/**
 * Reactions (D43). The sim writes a flag bit per unit per step and render turns
 * each one into something the eye can read; `SquadView` reads the whole set
 * once per unit per frame, so everything here has to be an arithmetic term on a
 * transform rather than a state change.
 *
 * Milestone 5's per-unit follow lag is gone with the flock it belonged to: the
 * units are agents now, they carry their own positions and velocities, and a
 * lag on top of that would be a second, slower crowd drawn over the real one.
 *
 * The stumble is what a shove looks like from outside. A `VatCrowd` instance
 * carries a yaw, a height and a non-uniform y scale and nothing else — there is
 * no pitch to lean back with — so a stumble is a crouch (the dip and the
 * squash) with a twist away from whatever pushed, over a third of a second,
 * which is about as long as a person takes to catch their footing. The clip
 * phase is kicked at the same moment so the stride visibly breaks rather than
 * marching on through the shove.
 */
export const STUMBLE_DURATION = 0.34;
/** Metres the unit drops at the bottom of the crouch, and the squash with it. */
export const STUMBLE_DIP = 0.075;
export const STUMBLE_SQUASH = 0.16;
/** Radians twisted away from the side the shove came from. */
export const STUMBLE_YAW = 0.55;
/** Seconds of clip the stride jumps by, so a shoved unit breaks step. */
export const STUMBLE_CLIP_KICK = 0.37;

/**
 * The shoulder bump, for a unit the fence is holding (`CROWD_ON_FENCE`).
 *
 * Shorter and smaller than the stumble, and it points the other way: a unit
 * against a fence turns its shoulder *into* the line and stands a little
 * taller, because it is being pressed from behind rather than knocked over.
 * It is re-armed every step the flag is still set, so a column leaning on a
 * fence for two seconds holds the pose instead of flickering through it.
 */
export const BUMP_DURATION = 0.24;
export const BUMP_YAW = 0.42;
export const BUMP_SQUASH = 0.07;

/**
 * The dust a held unit kicks up at the line, drawn into the shared sprite batch
 * (`./squadDust.ts`) so it costs no draw call.
 *
 * Capped twice: a ring of `DUST_POOL` puffs, and at most `DUST_PER_FRAME` new
 * ones a frame. A column of five hundred jammed against a fence has a hundred
 * units on the line at once and a puff each would be a fog bank; two a frame is
 * a scuffle at the point of contact, which is what the eye is looking for.
 */
export const DUST_POOL = 14;
export const DUST_PER_FRAME = 2;
export const DUST_DURATION = 0.42;
export const DUST_SIZE = 0.34;
/** Metres above the road the puff sits, and how far it drifts up as it fades. */
export const DUST_Y = 0.12;
export const DUST_RISE = 0.18;

/**
 * Rejoining (D44): a straggler group has been released and is scurrying back to
 * the column's tail.
 *
 * The sim already gives these units a raised speed cap (`crowd.rejoinSpeed`),
 * so what render owes is the *look* of hurrying: the run clip runs faster than
 * the column's, and the unit is drawn hunched — a little shorter and a little
 * wider — which is the only forward lean a yaw-and-scale instance can carry.
 */
export const REJOIN_CLIP_SPEED = 1.45;
export const REJOIN_CROUCH = 0.93;
export const REJOIN_WIDEN = 1.04;

/**
 * Lean. A unit turns a little into the direction it is sliding, which is the
 * cheapest thing that reads as weight on a crowd with no blendable skeleton;
 * `VatCrowd` takes a yaw and nothing else, so the lean is a yaw. Radians per
 * metre a second, a ceiling, and the seconds the lean itself is smoothed over
 * so a one-frame jitter cannot flick a mage sideways.
 */
export const UNIT_LEAN_PER_SPEED = 0.055;
export const UNIT_LEAN_MAX = 0.32;
export const UNIT_LEAN_SMOOTHING = 0.09;

/** Casual timing: every clip runs faster than the artist's tempo (D28). */
export function clipSpeed(animation: string): number {
  if (animation === 'run') return RUN_CLIP_SPEED;
  if (animation === 'cast') return CAST_CLIP_SPEED;
  if (animation === 'cast2') return CAST2_CLIP_SPEED;
  return IDLE_CLIP_SPEED;
}

/**
 * Everything a unit is given "at random" comes out of this: the same formation
 * slot always gets the same number, and its neighbours get unrelated ones.
 *
 * The three variations below used to be `index % 7`, `index % 29` and
 * `index % 3`, which was fine on a crowd ten to sixteen columns wide because a
 * row's length and those periods shared no factors and the pattern drifted
 * sideways a little every row. The column is *seven* wide (D42), and rows
 * alternate seven and six, so `% 7` repeated every second rank and slid by one
 * column every second rank after that: identical pairs of ranks on a diagonal,
 * which is exactly the conveyor belt a column has to avoid. A hash has no
 * period to resonate with, and it costs a handful of integer operations against
 * the modulo's one. Measured over all three variations at 500 units: 2 to 4 us
 * a frame where the modulos cost 2 to 3, both of them lost in the 8 us the same
 * loop already spends on the flock's `exp` and in the instance writes after it.
 *
 * Deliberately not the sim's RNG, and deliberately not stateful: a unit's look
 * has to survive a corpse outliving the crowd it stood in and a `mul` gate
 * renumbering nothing (`SquadView.diffCount` keeps indices).
 */
function scramble(index: number, salt: number): number {
  let h = Math.imul(index ^ salt, 0x85eb_ca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2_ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4_294_967_296;
}

/** A little turn per unit, so five hundred mages are not one rigid block. */
export function yawOf(index: number): number {
  return (scramble(index, 0x9e37_79b9) - 0.5) * 2 * UNIT_YAW_SPREAD;
}

/** Seconds into the loop, spread over the crowd so nobody marches in lockstep. */
export function timeOffsetOf(index: number): number {
  return scramble(index, 0x632b_e5ab) * UNIT_CLIP_SPREAD;
}

/**
 * Does this unit cast rather than run while the crowd advances? One in
 * `CASTING_SHARE` of them does (`./theme.ts`), and which one is scrambled
 * rather than always the first: in a seven-wide column `index % 3` is a
 * diagonal line of spellcasters marching down the crowd.
 *
 * Scrambled *inside* each group of `share` rather than rolled per unit, so the
 * share stays exact at every squad size. A coin flip per unit is the same
 * thing on average and the wrong thing at the start of a level, where a squad
 * of five would go a whole run with nobody casting one time in eight.
 */
export function castsWhileRunning(index: number, share: number): boolean {
  const size = Math.max(1, Math.floor(share));
  const group = Math.floor(index / size);
  return index % size === Math.floor(scramble(group, 0x27d4_eb2f) * size);
}

/**
 * How big a unit is drawn, as a share of `MAGE_HEIGHT`: the room the formation
 * actually gives it, measured against the room it has at `CROWD_SCALE_FROM`.
 *
 * Reading the sim's own `unitSpacing` rather than easing between two guessed
 * counts is the point (see `CROWD_SCALE_FROM` in `theme.ts`): the spacing is
 * what decides whether two mages overlap, it is not linear in the count, and
 * tying the two together means a change to the formation cannot silently make
 * the crowd a slab again.
 *
 * Exported for the stress scene, which has to draw the crowd at the size the
 * game draws it or it is measuring a scene the game never renders.
 */
export function crowdScale(count: number): number {
  if (count <= CROWD_SCALE_FROM) return 1;
  const room = unitSpacing(count) / unitSpacing(CROWD_SCALE_FROM);
  return Math.max(CROWD_SCALE_MIN, Math.min(1, room));
}

/** Ease-out-back: overshoots past 1 then settles, which reads as a pop. */
export function popScale(age: number): number {
  const p = Math.min(1, age / POP_DURATION) - 1;
  const overshoot = 1.7;
  return 1 + (overshoot + 1) * p * p * p + overshoot * p * p;
}
