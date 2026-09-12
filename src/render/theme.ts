/**
 * Look-and-feel constants for the Babylon layer: sizes, ranges, scales and
 * timings.
 *
 * Gameplay tuning lives in `src/data/*.json` (CLAUDE.md). These are the numbers
 * only the renderer can have an opinion about, so they live next to the code
 * that reads them. Anything the sim also needs (lane width, projectile cap, max
 * squad count) is read from `@/data` here rather than duplicated.
 *
 * The two halves that grew their own files in Milestone 3 Phase D are
 * re-exported below rather than moved out of reach: `./palette.ts` is every
 * colour (D28's daylight set) and `./pools.ts` is every pool size. Every view
 * still imports all three from `./theme`.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import { balance } from '@/data';

export {
  ARENA_COLOR,
  BOSS_ENRAGE_COLOR,
  BOSS_LABEL_COLOR,
  EMBER_COLOR,
  ENEMY_COLOR,
  ENEMY_LABEL_COLOR,
  FIELD_COLOR,
  FOG_COLOR,
  FOG_END,
  FOG_START,
  FROST_COLOR,
  GATE_LABEL_COLOR,
  GATE_TINTS,
  LANE_LINE_COLOR,
  ROAD_COLOR,
  SKY,
  SKY_HAZE,
  SKY_HORIZON,
  SKY_MID,
  SKY_ZENITH,
  SLOW_RING_COLOR,
  STOMP_COLOR,
  STORM_COLOR,
  STREAM_LABEL_COLOR,
} from './palette';
export { POOL } from './pools';

export const LANE_WIDTH = balance.road.laneWidth;
export const ROAD_HALF_WIDTH = balance.road.halfWidth;

/** Labels cost a 2D canvas redraw, so only near things get one. */
export const LABEL_RANGE = 45;
/**
 * Past two rows the numbers are noise, not choice — and with the rows this
 * close together the third and fourth rows print their digits on top of the
 * second one's. Derived from the sim's spacing so moving the rows again cannot
 * silently turn the far half of the road back into a stack of numbers.
 */
export const GATE_LABEL_RANGE = balance.level.rowSpacing * 2.5;
/**
 * Side lanes are two metres from the middle one, which is barely thirty screen
 * pixels once a row is thirty metres out — three numbers printed across that
 * touch each other. Past this distance only the middle lane keeps its label, so
 * the row the player is actually deciding about is the only one showing three.
 */
export const SIDE_GATE_LABEL_RANGE = Math.min(balance.level.rowSpacing * 2.3, 30);
/** How far behind the squad a label stays alive before it is hidden. */
export const LABEL_BEHIND = 4;

/**
 * How far ahead a gate panel is drawn at all. Everything past this is inside
 * the fog and reads as a smudge, and a level carries up to sixty panels — one
 * draw call each, which is most of the frame budget (plan, "Performance").
 *
 * Just outside `GATE_LABEL_RANGE`, so a panel fades up shortly before its
 * number does and never the other way round. Three full rows (the Phase B2
 * value) put up to nine unlabelled slabs in the fog and three draw calls on
 * the frame's peak for panels the player cannot read.
 */
export const GATE_DRAW_RANGE = balance.level.rowSpacing * 2.7;
/** Same rule for enemy blocks: their skeletons are instanced, but not free. */
export const ENEMY_DRAW_RANGE = 52;

/**
 * How much road has to separate a block's HP number from a gate row's numbers
 * before both stay readable — as a share of the camera's distance to the gate,
 * not as metres.
 *
 * A share, because the same stretch of road is fewer pixels the further out it
 * is: five metres hold two labels 55 px apart at the nearest row and 16 px apart
 * three rows out, so M1's fixed 3 m window either hides everything up close or
 * nothing far away. Behind is the wider of the two: a block beyond a gate prints
 * *up* into that gate's panel, while a block in front prints below it, where the
 * HP label's low anchor on the block's face already buys separation.
 *
 * Measured off the camera rig below at 390x844: 0.28 is where the two numbers
 * stop touching and 0.31 to 0.44 (small squad to large) is where the block's
 * number clears the panel band entirely.
 */
export const BLOCK_LABEL_CLEARANCE_BEHIND = 0.35;
export const BLOCK_LABEL_CLEARANCE_FRONT = 0.15;
/**
 * Lateral reach of the same rule. Lanes are two metres apart, which is 55 px
 * even three rows out — wider than either number — so only a gate in the block's
 * own lane can print on the same patch of screen.
 */
export const BLOCK_LABEL_LANE_CLEARANCE = 1.2;

export const STREAM_LABEL_SIZE = 30;
export const STREAM_LABEL_MIN = 13;
/** How high over the stream's head body the count rides, in metres. */
export const STREAM_LABEL_HEIGHT = 1.6;

/** Full size, and the floor a shrinking distant label is clamped to. */
export const GATE_LABEL_SIZE = 34;
export const GATE_LABEL_MIN = 13;
/**
 * Staff gates print a word, not two digits. A lane is about 83 px wide two rows
 * out, and "Ember" at the number size is a hundred — it would run over whatever
 * the next lane offers. Smaller, so the word stays inside its own panel.
 */
export const GATE_WORD_SIZE = 22;
export const GATE_WORD_MIN = 10;
export const ENEMY_LABEL_SIZE = 30;
export const ENEMY_LABEL_MIN = 12;
/**
 * The boss's number, above its horns rather than across its chest and much
 * smaller than Milestone 2's 54 (plan, "Boss text blocks the boss"). The HUD
 * bar is the primary readout; this is the flavour, and at 54 across the chest
 * it was covering the model the whole fight.
 */
export const BOSS_LABEL_SIZE = 32;
export const BOSS_LABEL_MIN = 15;

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
 * Idle sway. A VAT cannot blend, and the mage rig has one idle clip, so the
 * variety is added on top of it: each unit rocks a few degrees of yaw and a
 * centimetre of height on its own phase, which is what turns a hundred
 * identical idle loops into a crowd shifting its weight.
 */
export const IDLE_SWAY_RATE = 0.55;
export const IDLE_SWAY_YAW = 0.11;
export const IDLE_SWAY_LIFT = 0.012;

/**
 * The hop the whole squad takes through a gate row. Short and low: it is a
 * beat of feedback on the choice the player just made, not a jump.
 */
export const GATE_BOUNCE_DURATION = 0.34;
export const GATE_BOUNCE_HEIGHT = 0.16;

/** Share of the squad casting rather than running while the crowd advances. */
export const CASTING_SHARE = 3;

/** A panel spans its lane exactly, so what the player aims at is what they hit. */
export const GATE_WIDTH = LANE_WIDTH;
export const GATE_HEIGHT = 2.2;
export const GATE_CENTER_Y = 1.15;
export const GATE_PULSE_DURATION = 0.2;
export const GATE_EXIT_DURATION = 0.3;
/**
 * Panel opacity. Raised from Milestone 2's 0.46: a translucent slab read as a
 * solid colour against a near-black road and washes out against a light stone
 * one, and the panels have to stay the most readable thing in frame (D28).
 */
export const GATE_BASE_ALPHA = 0.62;
/** The staff a `weapon` gate offers, floating above its panel. */
export const GATE_PROP_HEIGHT = 0.8;
export const GATE_PROP_Y = GATE_CENTER_Y + GATE_HEIGHT / 2 + 0.45;
export const GATE_PROP_SPIN = 1.1;

/** Skeletons drawn for one block, however many units it is worth. */
export const ENEMY_MAX_INSTANCES = 18;
/** How tightly a block's skeletons pack inside its own footprint. */
export const ENEMY_CLUSTER_DEPTH = 1.6;

/**
 * How far ahead the boss is drawn. Its meshes opt out of frustum culling (a
 * skinned model's rest-pose bounds are wrong once it animates), so without this
 * the demon and its trident are two draw calls on every frame of the road
 * phase — for a body sixty metres away and half inside the haze. A fixed
 * number rather than `FOG_END`: the daylight fog reaches much further than the
 * dusk one did, and tying the two together would draw the demon for most of the
 * road just because the air got clearer.
 */
export const BOSS_DRAW_RANGE = 75;

export const BOSS_HEIGHT = 3;
/** The stand-in box, for a build whose boss model could not be loaded. */
export const BOSS_COLOR = new Color3(0.58, 0.2, 0.88);
export const BOSS_WIDTH = 2.4;
export const BOSS_DEPTH = 1.8;
/** The Quaternius demon is 2.91 m in its own units at the manifest's scale 1. */
export const BOSS_MODEL_HEIGHT = 2.91;
export const BOSS_SCALE = BOSS_HEIGHT / BOSS_MODEL_HEIGHT;
/** Clear of the horns: the number floats above the head now, not across the
 *  chest, so the model the fight is about is never behind it. */
export const BOSS_LABEL_HEIGHT = BOSS_HEIGHT + 0.55;
/**
 * Seconds a hit reaction is held before another one may interrupt the walk.
 *
 * Down from Milestone 2's 1.5: the product owner asked for more animation, and
 * the boss standing still through a barrage is the most visible place there was
 * none. It cannot go much lower — `HitReact` is about 0.7 s, and a throttle
 * under that is a boss that only ever plays the first frame of a flinch.
 */
export const BOSS_HIT_THROTTLE = 0.85;
/**
 * The taunt the boss plays when it activates: `Punch` at half speed, which
 * reads as a slow raised arm rather than a strike. The Quaternius demon ships
 * no taunt clip, and a real one would be a fourth animation group to load for
 * one beat a level (docs/09-milestone-3-plan.md, "more animation").
 */
export const BOSS_TAUNT_SPEED = 0.5;
/** Death animation, then the body sinks through the road. */
export const BOSS_SINK_DELAY = 2;
export const BOSS_SINK_DURATION = 1.2;
export const BOSS_ENRAGE_PULSE = 4;
export const BOSS_ENRAGE_SPEED = 1.35;
export const STOMP_DURATION = 0.5;
/**
 * How far the shockwave sweeps, in metres — capped here and *not* read from the
 * sim's `stompRange` (18 m), which is how far the boss can reach, not how big
 * the tell should be. At seven metres the ring was wider than the road, ate the
 * boss and its HP number, and bloomed white through the glow pass; five metres
 * lands the ring at the squad's front rank, which is what it means.
 */
export const STOMP_MAX_RADIUS = 5;
/**
 * Ring alpha and thickness. Milestone 2 kept this dim because the glow pass
 * doubled it; the pass is off now and the road is light, so an additive ring
 * has to be thicker and hotter to read at all.
 */
export const STOMP_ALPHA = 0.9;
export const STOMP_THICKNESS = 0.13;

/**
 * How much brighter a spell's own emissive runs now that the glow pass is off
 * by default (Milestone 3 plan, performance step 4).
 *
 * The blur used to do this work: a bolt was a small opaque shape that the glow
 * layer smeared into a halo. Without the pass, brightness has to come from the
 * material — additive blending plus an emissive above 1, which saturates into a
 * white-hot core exactly where the bloom used to sit.
 *
 * Smaller than Milestone 2's numbers, and for a reason that only shows up
 * under D28's daylight: additive blending adds to what is behind it, and the
 * road is now light. A violet scaled past 1 clips every channel and comes out
 * white — storm stopped looking like lightning and started looking like steam.
 * The sheets (`./spriteSheets.ts`) carry their own white-hot cores, so the
 * multiplier only has to keep the hue this side of clipping.
 */
export const BOLT_GLOW_BOOST = 1.15;
export const IMPACT_GLOW_BOOST = 1.35;
/** A bolt's tail: the halo the glow pass used to paint around the core. */
export const TRAIL_GLOW_BOOST = 1.3;

/**
 * Magical projectiles (Milestone 3 plan, "Shots look like bullets").
 *
 * The bolts are gone: every spell in flight is a billboarded flipbook quad cut
 * out of one procedural sheet (`./spriteSheets.ts`, drawn by `./sprites.ts`).
 * "Bigger and slightly slower" is these numbers — the sim's projectile speed is
 * the sim's — so the head is two thirds of a metre rather than a 0.13 m pellet,
 * and the flipbook cycles slowly enough that a single frame is visible.
 */
export const BOLT_SIZE = 0.46;
/** Flipbook cycles per second for a projectile in flight. */
export const BOLT_FLIPBOOK_FPS = 14;
/** Height above the road a spell flies at: the mages' chests, not their hats. */
export const BOLT_Y = 0.66;
/** Tail quads behind each head, as (size, alpha) shares of the head's own. */
export const BOLT_TAIL: readonly (readonly [number, number])[] = [[0.66, 0.4]];
/** Metres between the head and each tail quad. */
export const BOLT_TAIL_GAP = 0.3;

/** Sparkles shed behind the volley: how long one lives and how big it starts. */
export const SPARKLE_DURATION = 0.24;
export const SPARKLE_SIZE = 0.22;
/**
 * One projectile in this many sheds a sparkle on any given frame. With 400
 * bolts in the air that is twenty a frame, which fills `POOL.sparkles` and
 * leaves the rest of the volley twinkling as the modulo rotates.
 */
export const SPARKLE_EVERY = 36;

/** Impact bursts: a flipbook, played once over this long, at this size. */
export const IMPACT_SIZE = 0.9;
/** Muzzle flash: the smallest, fastest sprite in the set. */
export const MUZZLE_SIZE = 0.3;
export const MUZZLE_Y = 0.72;
export const IMPACT_Y = 0.7;
export const CHAIN_Y = 0.8;

/** Weapon effects. Impacts are pooled per weapon and capped at `POOL.impacts`. */
export const IMPACT_DURATION = 0.26;
export const SPLASH_DURATION = 0.34;
export const CHAIN_DURATION = 0.12;
export const MUZZLE_DURATION = 0.06;

/** Camera shake the renderer calls on itself, per the juice checklist. */
export const SHAKE_STOMP = { strength: 0.15, seconds: 0.3 } as const;
export const SHAKE_BOSS_KILL = { strength: 0.35, seconds: 0.6 } as const;

/**
 * Camera rig, per docs/09-milestone-3-plan.md ("Squad reads as hats").
 *
 * The elevation — `atan(height / behind)`, the angle the shot looks down on the
 * squad at — drops from Milestone 2's 36 degrees to about 27. That is the whole
 * point of the change: at 36 degrees a KayKit mage is seen from above and what
 * faces the camera is the top of its hat, whatever the hat is scaled to.
 *
 * The values are one set, not six knobs. Two angles follow from them and both
 * were measured against 390x844 frames:
 *
 *   elevation  atan(height / behind)                       = 27.0 deg
 *   pitch      atan((height - lookHeight) / (behind + lookAhead)) = 13.6 deg
 *
 * The pitch decides where the horizon sits (`tan(pitch) / tan(fov/2)` of the
 * way up from the middle: 0.56, so a fifth of the way down from the top) and
 * where the squad lands (0.55 below the middle, about four fifths down). The
 * field of view is narrower than Milestone 2's 0.9 because a flatter shot
 * compresses the road: at 0.82 the two gate rows at 18 m and 36 m are 57 px
 * apart at that size rather than 48, which is what keeps both numbers readable.
 * Change any of them together and re-shoot `npm run smoke`.
 */
export const CAMERA = {
  fov: 0.82,
  height: 5.6,
  behind: 11,
  lookAhead: 8,
  lookHeight: 1,
  /** The camera tracks the squad's x only partly, so the road stays framed. */
  lateralFollow: 0.35,
  /**
   * Extra distance as the squad grows, so the tail of the crowd stays on
   * screen. The formation is an ellipse whose depth grows with `sqrt(count)`
   * and saturates around 3.5 m, so this reaches its cap at about 70 units
   * rather than climbing all the way to 500. A shade more than Milestone 2's,
   * because the units themselves are bigger and the formation is wider.
   */
  pullbackPerUnit: 0.035,
  pullbackMax: 2.4,
  /**
   * How far the eased pose may trail the ideal one, in meters. Steady-state lag
   * while running is `runSpeed / smoothing`, about 0.8 m, so normal play never
   * reaches this; a frame hitch or `?turbo` (several sim steps per frame) would,
   * and without the clamp the whole frame reframes.
   */
  maxLag: 1.5,
  /** Exponential smoothing rate, in 1/seconds. */
  smoothing: 6,
  /**
   * Camera movement per frame, in meters, below which the pose counts as
   * arrived. Well under a pixel at this distance, and it is what lets the title
   * screen stop redrawing an identical frame.
   */
  settleEpsilon: 0.002,
} as const;
