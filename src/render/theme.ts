/**
 * Look-and-feel constants for the Babylon layer.
 *
 * Gameplay tuning lives in `src/data/*.json` (CLAUDE.md). These are the numbers
 * only the renderer can have an opinion about — colours, pool sizes, animation
 * durations — so they live next to the code that reads them. Anything the sim
 * also needs (lane width, projectile cap, max squad count) is read from
 * `@/data` here rather than duplicated.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import { balance, levels } from '@/data';

/** Fog fades to this and the canvas clears to it, so the horizon has no seam. */
export const SKY = new Color3(0.4, 0.54, 0.76);
export const FOG_START = 24;
export const FOG_END = 70;

export const ROAD_COLOR = new Color3(0.44, 0.41, 0.37);
export const FIELD_COLOR = new Color3(0.2, 0.27, 0.24);
export const LANE_LINE_COLOR = new Color3(0.95, 0.93, 0.78);
export const ARENA_COLOR = new Color3(1, 0.78, 0.24);

export const SQUAD_BODY = new Color3(0.24, 0.44, 0.95);
export const SQUAD_GLOW = new Color3(0.1, 0.2, 0.55);
export const SQUAD_DEATH = new Color3(0.95, 0.18, 0.14);
export const PROJECTILE_COLOR = new Color3(1, 0.9, 0.5);

export const ENEMY_COLOR = new Color3(0.82, 0.18, 0.16);
export const ENEMY_GLOW = new Color3(0.26, 0.03, 0.02);
export const BOSS_COLOR = new Color3(0.58, 0.2, 0.88);
export const BOSS_GLOW = new Color3(0.22, 0.05, 0.38);
export const STOMP_COLOR = new Color3(1, 0.5, 0.18);

/** Gate tints, per `GateKind`. Keys are checked against the sim's union below. */
export const GATE_TINTS = {
  add: new Color3(0.22, 0.9, 0.42),
  sub: new Color3(0.95, 0.24, 0.26),
  mul: new Color3(0.3, 0.56, 1),
  fireRate: new Color3(1, 0.78, 0.2),
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
  stompRings: 8,
  /** Concurrent shrinking corpses; a big `sub` gate can kill dozens at once. */
  dyingUnits: 192,
  squad: balance.squad.maxCount,
  projectiles: balance.projectiles.max,
} as const;

export const LANE_WIDTH = balance.road.laneWidth;
export const ROAD_HALF_WIDTH = balance.road.halfWidth;

/** Labels cost a 2D canvas redraw, so only near things get one. */
export const LABEL_RANGE = 45;
/** Gate rows are 18 m apart; past two rows the numbers are noise, not choice. */
export const GATE_LABEL_RANGE = 46;
/**
 * Side lanes are two metres from the middle one, which is barely thirty screen
 * pixels once a row is thirty metres out — three numbers printed across that
 * touch each other. Past this distance only the middle lane keeps its label, so
 * the row the player is actually deciding about is the only one showing three.
 */
export const SIDE_GATE_LABEL_RANGE = 30;
/** How far behind the squad a label stays alive before it is hidden. */
export const LABEL_BEHIND = 4;

/** Full size, and the floor a shrinking distant label is clamped to. */
export const GATE_LABEL_SIZE = 34;
export const GATE_LABEL_MIN = 13;
export const ENEMY_LABEL_SIZE = 30;
export const ENEMY_LABEL_MIN = 12;
export const BOSS_LABEL_SIZE = 54;
export const BOSS_LABEL_MIN = 26;

export const SQUAD_RADIUS = 0.17;
export const SQUAD_HEIGHT = 0.62;
/**
 * Unit meshes shrink as the crowd tightens: full size while the formation has
 * room, three quarters at the squad cap. The sim packs 500 units into the same
 * 4 m of road as 100, so without this the capsules read as one solid slab.
 */
export const CROWD_SCALE_FROM = 50;
export const CROWD_SCALE_TO = balance.squad.maxCount;
export const CROWD_SCALE_MIN = 0.75;
/** Scale bounce for a unit that just appeared. */
export const POP_DURATION = 0.25;
/** Shrink-and-fade for a unit that just died. */
export const DEATH_DURATION = 0.25;

/** A panel spans its lane exactly, so what the player aims at is what they hit. */
export const GATE_WIDTH = LANE_WIDTH;
export const GATE_HEIGHT = 2.2;
export const GATE_CENTER_Y = 1.15;
export const GATE_PULSE_DURATION = 0.2;
export const GATE_EXIT_DURATION = 0.3;
export const GATE_BASE_ALPHA = 0.46;

export const ENEMY_HIT_FLASH = 0.06;
export const ENEMY_DEATH_DURATION = 0.25;

export const BOSS_WIDTH = 2.4;
export const BOSS_HEIGHT = 3;
export const BOSS_DEPTH = 1.8;
export const BOSS_DEATH_DURATION = 0.5;
export const STOMP_DURATION = 0.5;
export const STOMP_MAX_RADIUS = 7;

/** Camera rig, per docs/03-milestone-1-plan.md. */
export const CAMERA = {
  fov: 1,
  height: 9,
  behind: 9,
  lookAhead: 9,
  lookHeight: 0.5,
  /** The camera tracks the squad's x only partly, so the road stays framed. */
  lateralFollow: 0.35,
  /** Extra distance per unit as the squad grows, so a big blob still fits. */
  pullbackPerUnit: 0.01,
  pullbackMax: 3,
  /** Exponential smoothing rate, in 1/seconds. */
  smoothing: 6,
  /**
   * Camera movement per frame, in meters, below which the pose counts as
   * arrived. Well under a pixel at this distance, and it is what lets the title
   * screen stop redrawing an identical frame.
   */
  settleEpsilon: 0.002,
} as const;
