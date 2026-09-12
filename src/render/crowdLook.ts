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
 * solid slab: the sim packs 500 units into the same 4 m of road as 100.
 *
 * Milestone 3 changes what the shrink follows. Milestone 2 eased from 1 to 0.72
 * between 50 and 500 units, which was a guess; the number that actually decides
 * whether two mages overlap is the sim's own `unitSpacing`, so the scale is
 * that spacing measured against what it is at `CROWD_SCALE_FROM` (see
 * `crowdScale` in `./squad.ts`). A unit is then a constant fraction of the gap
 * it has to stand in, at every squad size, which is the thing the eye reads.
 *
 * This is where the plan's "formation spacing raised" landed. The spacing
 * itself could not move: `halfWidth(80)` is 1.9962 against a hard 2.0 from the
 * sim's road clamp (`road.halfWidth - road.clampMin`, asserted in
 * `run.test.ts`), so there is no headroom at all — see the Phase B2 log entry.
 * The separation had to come from the drawn size instead, and this is it.
 *
 * The floor is the dense end: past about a hundred units the crowd is *meant*
 * to be shoulder to shoulder, and shrinking further only makes ants.
 */
export const CROWD_SCALE_FROM = 8;
export const CROWD_SCALE_MIN = 0.6;
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
 * The renderer has no "advancing" flag from the sim, only the squad's z, and z
 * moves in the sim's own fixed 1/60 s steps behind an accumulator. A frame that
 * happens to fall between two steps sees *no* movement at all, and a frame on a
 * 120 Hz display sees none every other frame — so a per-frame delta made the
 * whole crowd cut from `run` to `idle` and back, with the idle sway snapping on
 * top of it. That was the "glitchy walking" of the Milestone 3 playtest
 * (Milestone 4, task P): measured at 8.3 ms frames, 120 frames in 240 were
 * drawn standing still.
 *
 * So the view low-passes the speed it measures over `ADVANCE_SMOOTHING`
 * seconds — long enough to swallow a step the sim has not taken yet, short
 * enough that the squad stops looking like it is running about a fifth of a
 * second after it stops — and switches on hysteresis, so a squad hovering at
 * the threshold cannot flicker.
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
