/**
 * Numbers the physics layer has an opinion about.
 *
 * CLAUDE.md puts *tuning* in `src/data/*.json` because the sim, the bots and
 * the balance tests all read it. Nothing here is gameplay: the sim never reads
 * physics (decision D18), so these follow the same precedent as
 * `src/render/theme.ts` and live next to the code that uses them.
 *
 * Every length is in metres and every mass in kilograms, at the manifest scale
 * of the skeleton model (`assets.json` says 0.35 m per model unit, which makes
 * a minion about 0.52 m tall). Debris is small because the world is small.
 */

import { Color3 } from '@babylonjs/core/Maths/math.color';

import type { GateKind } from '@/sim';

/**
 * Hard caps. A spawn past either recycles the oldest body of that kind.
 *
 * The ragdoll pool is eight where the plan said twenty-four. A live ragdoll is
 * a skinned mesh in its own pose, so it is a draw call that nothing can batch,
 * and measured at the peak of a level-1 run the frame is about two dozen scene
 * meshes, 6 to 8 gate panels and 3 shard meshes — and then one per corpse.
 * Sixteen corpses put the peak over the budget; eight keeps it inside it.
 * Shards cost three draw calls however many are live, so their cap is
 * untouched.
 */
export const RAGDOLL_CAPACITY = 8;
export const SHARD_CAPACITY = 64;

/**
 * Live ragdolls allowed at each quality, indexed by quality. The ladder in
 * `src/core/quality.ts` is what moves between them; a spawn past the cap
 * recycles the oldest corpse rather than dropping the new one.
 */
export const RAGDOLL_LIVE_CAP = [0, 4, 8] as const;

/**
 * Ragdolls per `enemyKilled`, indexed by quality. 0 keeps the layer inert.
 *
 * Six rather than the plan's eight, so one block coming apart costs six draw
 * calls and the frame's peak stays under the budget; the pool's cap of eight is
 * then what a second kill inside the corpses' two and a half seconds runs into.
 */
export const RAGDOLLS_PER_KILL = [0, 3, 6] as const;

/** Shards per `enemyShattered` and per `gatePassed`, indexed by quality. */
export const SHATTER_SHARDS = [0, 5, 9] as const;
export const GLASS_SHARDS = [0, 6, 10] as const;
/** The ring thrown when the boss dies. */
export const BOSS_SHARDS = [0, 4, 8] as const;

export const RAGDOLL_LIFE = 2.5;
/** After `RAGDOLL_LIFE`: sink this far while fading out, then recycle. */
export const RAGDOLL_FADE = 0.6;
export const RAGDOLL_SINK = 0.5;

export const SHARD_LIFE = 1.5;
export const SHARD_FADE = 0.35;

/** Knockback given to a ragdoll, as a velocity rather than an impulse. */
export const RAGDOLL_PUSH_SPEED = 2.6;
export const RAGDOLL_PUSH_UP = 2.2;
export const RAGDOLL_PUSH_JITTER = 0.5;
export const RAGDOLL_SPIN = 7;
/**
 * Radius of the ring a block's worth of ragdolls is dealt around. A corpse is
 * half a metre tall, so a tighter ring than this stacks eight of them into one
 * lump instead of a spill.
 */
export const RAGDOLL_SPREAD = 0.8;
/**
 * How much of a block's knockback a single stream body gets (Milestone 3).
 *
 * A block coming apart throws its skeletons; one grunt shot off its feet in a
 * river of them should topple and slide, not fly — and the bodies behind it are
 * still walking through the same metre of road, so a long throw lands the
 * corpse inside the next rank.
 */
export const STREAM_PUSH_SCALE = 0.6;
/** Spawned this far above the road so the first step is not a penetration. */
export const RAGDOLL_LIFT = 0.04;

export const SHARD_PUSH_SPEED = 2.4;
export const SHARD_PUSH_UP = 2.6;
export const SHARD_SPIN = 12;

/** Boss stomp: everything within this of `(x, z)` gets shoved outward. */
export const STOMP_RADIUS = 6;
export const STOMP_IMPULSE = 1.4;
export const STOMP_UP = 0.9;

/** Road collider. `z` comes from the level; the rest is the road itself. */
export const GROUND_START_Z = -10;
export const GROUND_PAST_ARENA = 70;
/** Half a metre outside the drivable road, so debris is not clipped mid-air. */
export const GROUND_MARGIN = 0.5;
export const GROUND_THICKNESS = 1;
export const WALL_HEIGHT = 2.5;
export const GROUND_FRICTION = 0.55;
export const GROUND_RESTITUTION = 0.08;

export const SHARD_FRICTION = 0.4;
export const SHARD_RESTITUTION = 0.25;
/** Self-lit share of a shard's tint, so debris reads against the dark road. */
export const SHARD_EMISSIVE = 0.45;

/**
 * The three shard shapes, cycled across the pool so a burst of one kind always
 * finds slots. `panel` is the gate glass; the other two are body debris.
 */
export const SHARD_SIZES = [
  { width: 0.07, height: 0.07, depth: 0.055, mass: 0.05 },
  { width: 0.11, height: 0.06, depth: 0.04, mass: 0.06 },
  { width: 0.17, height: 0.2, depth: 0.02, mass: 0.05 },
] as const;
/** Index into `SHARD_SIZES` for the flat panel used by gate glass. */
export const SHARD_PANEL = 2;

export const ICE_TINT = new Color3(0.58, 0.86, 1);
export const BOSS_TINT = new Color3(0.72, 0.34, 0.95);

/**
 * Mirrors `GATE_TINTS` in `src/render/theme.ts`. It is copied rather than
 * imported to keep the palette's owner unambiguous — the renderer's theme is
 * the renderer's; if it moves, move this with it. `weapon`
 * gates have no tint in the theme yet, so they fall back to the boss violet.
 */
const GATE_TINTS: Record<GateKind, Color3> = {
  add: new Color3(0.22, 0.9, 0.42),
  sub: new Color3(0.95, 0.24, 0.26),
  mul: new Color3(0.3, 0.56, 1),
  fireRate: new Color3(1, 0.78, 0.2),
  weapon: new Color3(0.72, 0.34, 0.95),
};

export function gateTint(kind: GateKind): Color3 {
  return GATE_TINTS[kind];
}

/** Where the gate panel's glass falls from: the middle of the panel. */
export const GATE_PANEL_CENTER_Y = 1.15;
export const GATE_PANEL_HALF_WIDTH = 0.9;

/*
 * The degrade ladder used to live here. It is `src/core/quality.ts` now: its
 * first rungs are the renderer's (pixel ratio) and only the app can see all of
 * them, so the physics layer keeps `setQuality` and no clock.
 */

/** Parked bodies live down here, spread out so they do not pile into one cell. */
export const PARK_Y = -80;
export const PARK_SPACING = 2;
