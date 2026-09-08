/**
 * Look-and-feel constants for the Babylon layer.
 *
 * Gameplay tuning lives in `src/data/*.json` (CLAUDE.md). These are the numbers
 * only the renderer can have an opinion about — colours, pool sizes, animation
 * durations — so they live next to the code that reads them. Anything the sim
 * also needs (lane width, projectile cap, max squad count) is read from
 * `@/data` here rather than duplicated.
 *
 * Palette, per docs/06-milestone-2-plan.md ("Palette and tone"): a near-black
 * indigo sky with a dusk band, a dark desaturated road, and three saturated
 * spell colours — ember orange, storm violet, frost cyan — that own every
 * bright pixel on screen. Gate panels stay the most readable thing in frame.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import { balance, levels } from '@/data';

/** Sky gradient, bottom to top. The fog fades to `SKY_HAZE`, so there is no seam. */
export const SKY_HORIZON = new Color3(0.29, 0.16, 0.15);
export const SKY_HAZE = new Color3(0.14, 0.1, 0.15);
export const SKY_MID = new Color3(0.07, 0.06, 0.12);
export const SKY_ZENITH = new Color3(0.021, 0.024, 0.055);
/** What the canvas clears to: the top of the dome, for the pixels it misses. */
export const SKY = SKY_ZENITH;
export const FOG_COLOR = SKY_HAZE;
export const FOG_START = 22;
export const FOG_END = 72;

export const ROAD_COLOR = new Color3(0.24, 0.235, 0.27);
export const FIELD_COLOR = new Color3(0.055, 0.056, 0.07);
/** Lane runes: cool arcane light, dim enough that a gate number still wins. */
export const LANE_LINE_COLOR = new Color3(0.36, 0.44, 0.95);
export const ARENA_COLOR = new Color3(0.85, 0.4, 0.12);

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
 * The longest level in `levels.json`. Pool sizes are derived from it rather
 * than guessed, so adding rows to a level cannot silently starve the pools and
 * drop gates or blocks on the floor.
 */
const MAX_ROWS = levels.reduce((most, level) => Math.max(most, Math.ceil(level.rows)), 1);

/** Three lanes per row, plus slack for the ones still playing their exit. */
const PER_ROW_POOL = MAX_ROWS * 3 + 6;

/**
 * Every pool is allocated once in `Renderer.init` and handed out by
 * `loadLevel`, so no mesh, material or label is ever created during a run.
 */
export const POOL = {
  gates: PER_ROW_POOL,
  enemies: PER_ROW_POOL,
  /**
   * Live stomp shockwaves. Three, not eight: a ring lives half a second of
   * *frame* time while the sim can throw one every 1.2 s of *sim* time, so a
   * fast-forwarded run (or a phone at ten frames a second) stacks them into a
   * bright portal around the boss instead of one wave leaving it.
   */
  stompRings: 3,
  /** Concurrent shrinking corpses; a big `sub` gate can kill dozens at once. */
  dyingUnits: 96,
  squad: balance.squad.maxCount,
  projectiles: balance.projectiles.max,
  /** Skeleton instances across every live block of one kind. */
  grunts: 220,
  brutes: 120,
  /** Frost rings under slowed blocks. */
  slowRings: 16,
  /** Simultaneous impact effects, per the plan's cap. */
  impacts: 24,
  splashes: 12,
  chains: 12,
} as const;

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
export const BOSS_LABEL_SIZE = 54;
export const BOSS_LABEL_MIN = 26;

/**
 * Mage height in metres, and the skeletons' relative to it.
 *
 * The manifest's 0.35 makes a KayKit character 0.62 m. Measured against the
 * camera's 75 CSS px per metre and the sim's 0.35 m formation spacing: a
 * KayKit mage's pointed hat is wider than its shoulders, so at 0.78 m the front
 * ranks are a single mass of hat brims seen from above, and at 0.62 m the crowd
 * reads but the staff is lost. 0.66 m is the compromise — hats still touching
 * at the back where the crowd is meant to look dense, daylight between the
 * front three, and the staff long enough to see against the road.
 */
export const MAGE_HEIGHT = 0.66;
export const GRUNT_HEIGHT = 0.72;
/** The brute is the silhouette that says "this row is going to hurt". */
export const BRUTE_HEIGHT = 0.92;
/** What a KayKit character is tall at the manifest's own scale of 0.35. */
const KAYKIT_UNIT_HEIGHT = 0.62;
/** Multipliers on that scale, which is what `VatCrowd.setInstance` takes. */
export const MAGE_SCALE = MAGE_HEIGHT / KAYKIT_UNIT_HEIGHT;
/**
 * Self-lit share of the mage's own albedo, above the 0.26 the enemies get.
 * The squad is the thing the player's eye lives on and it is the furthest into
 * the bottom of the frame, where the key light rakes across it; the extra lift
 * is what separates one hat from the next instead of a single dark mass.
 */
export const MAGE_LIFT = 0.34;
export const GRUNT_SCALE = GRUNT_HEIGHT / KAYKIT_UNIT_HEIGHT;
export const BRUTE_SCALE = BRUTE_HEIGHT / KAYKIT_UNIT_HEIGHT;

/**
 * Unit meshes shrink as the crowd tightens: full size while the formation has
 * room, three quarters at the squad cap. The sim packs 500 units into the same
 * 4 m of road as 100, so without this the mages read as one solid slab.
 */
export const CROWD_SCALE_FROM = 50;
export const CROWD_SCALE_TO = balance.squad.maxCount;
export const CROWD_SCALE_MIN = 0.72;
/** Scale bounce for a unit that just appeared. */
export const POP_DURATION = 0.25;
/** Shrink-and-fade for a unit that just died. */
export const DEATH_DURATION = 0.3;

/** Share of the squad casting rather than running while the crowd advances. */
export const CASTING_SHARE = 3;

/** A panel spans its lane exactly, so what the player aims at is what they hit. */
export const GATE_WIDTH = LANE_WIDTH;
export const GATE_HEIGHT = 2.2;
export const GATE_CENTER_Y = 1.15;
export const GATE_PULSE_DURATION = 0.2;
export const GATE_EXIT_DURATION = 0.3;
export const GATE_BASE_ALPHA = 0.46;
/** The staff a `weapon` gate offers, floating above its panel. */
export const GATE_PROP_HEIGHT = 0.8;
export const GATE_PROP_Y = GATE_CENTER_Y + GATE_HEIGHT / 2 + 0.45;
export const GATE_PROP_SPIN = 1.1;

/** Skeletons drawn for one block, however many units it is worth. */
export const ENEMY_MAX_INSTANCES = 18;
/** How tightly a block's skeletons pack inside its own footprint. */
export const ENEMY_CLUSTER_DEPTH = 1.6;
export const SLOW_RING_COLOR = FROST_COLOR;

/**
 * How far ahead the boss is drawn. Its meshes opt out of frustum culling (a
 * skinned model's rest-pose bounds are wrong once it animates), so without this
 * the demon and its trident are two draw calls on every frame of the road
 * phase — for a body sixty metres away and fully inside the fog. `FOG_END` is
 * the distance at which it would be a silhouette of haze anyway.
 */
export const BOSS_DRAW_RANGE = FOG_END;

export const BOSS_HEIGHT = 3;
/** The stand-in box, for a build whose boss model could not be loaded. */
export const BOSS_COLOR = new Color3(0.58, 0.2, 0.88);
export const BOSS_WIDTH = 2.4;
export const BOSS_DEPTH = 1.8;
/** The Quaternius demon is 2.91 m in its own units at the manifest's scale 1. */
export const BOSS_MODEL_HEIGHT = 2.91;
export const BOSS_SCALE = BOSS_HEIGHT / BOSS_MODEL_HEIGHT;
/** Chest height, not head height: the number is huge and the demon's horns are
 *  the half of it worth seeing. */
export const BOSS_LABEL_HEIGHT = 1.1;
/** Seconds a hit reaction is held before another one may interrupt the walk. */
export const BOSS_HIT_THROTTLE = 1.5;
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
/** Ring alpha and thickness. Dim: the glow pass doubles whatever this is. */
export const STOMP_ALPHA = 0.3;
export const STOMP_THICKNESS = 0.07;

/** Weapon effects. Impacts are pooled per weapon and capped at `POOL.impacts`. */
export const IMPACT_DURATION = 0.26;
export const SPLASH_DURATION = 0.34;
export const CHAIN_DURATION = 0.12;
export const MUZZLE_DURATION = 0.06;

/** Camera shake the renderer calls on itself, per the juice checklist. */
export const SHAKE_STOMP = { strength: 0.15, seconds: 0.3 } as const;
export const SHAKE_BOSS_KILL = { strength: 0.35, seconds: 0.6 } as const;

/**
 * Camera rig, per docs/06-milestone-2-plan.md ("Camera").
 *
 * Lower and tilted further down than M1: the squad's centre lands about four
 * fifths down the screen, road fills the frame from there up to the haze at
 * roughly a quarter, and three rows are in shot at 11 m spacing — the nearest
 * two carrying numbers. The values are one set, not five knobs: pitch is
 * `atan((height - lookHeight) / (behind + lookAhead))`, and it decides both how
 * high the horizon sits and how far down the screen the squad lands — so change
 * them together and re-shoot `npm run smoke`.
 */
export const CAMERA = {
  fov: 0.9,
  height: 7,
  behind: 9.5,
  lookAhead: 9,
  lookHeight: 0.8,
  /** The camera tracks the squad's x only partly, so the road stays framed. */
  lateralFollow: 0.35,
  /**
   * Extra distance as the squad grows, so the tail of the crowd stays on
   * screen. The formation is an ellipse whose depth grows with `sqrt(count)`
   * and saturates around 3.5 m, so this reaches its cap at about 70 units
   * rather than climbing all the way to 500.
   */
  pullbackPerUnit: 0.03,
  pullbackMax: 2,
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
