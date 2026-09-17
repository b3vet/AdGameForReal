/**
 * Schema for `beats.json` and the beat scripts in `levels.json` (document 31,
 * sections 3 and 4.2): the designed situations a campaign level is written in
 * since Phase 1 of the level-design plan (D70).
 *
 * The shapes are pinned by the plan so the sim, the content and the render
 * tracks could be built in parallel; everything below the pinned block is the
 * loader's own vocabulary for a file that may not be complete yet. Re-exported
 * from `./types.ts`, so `@/data/types` stays the one import site.
 */

import type { BiomeId } from './biome-types';

/**
 * A beat is written in roles, not lanes: `prize` is the lane with the best face
 * value, `safe` the modest one and `other` the third. The composer maps roles
 * to lanes from the level seed.
 */
export type LaneRole = 'prize' | 'safe' | 'other';

/**
 * What one role's panel is. Sizes are shares of E (the squad the reference
 * player is expected to hold at the beat), read from `beats.json`'s `values`.
 * `sub` is a curse: `flip` is small enough to be shot green, `price` is the
 * cost of the lane beside a prize.
 */
export type GateSlot =
  | { kind: 'add'; size: 'small' | 'mid' | 'big' }
  | { kind: 'mul'; value: 2 | 3 }
  | { kind: 'sub'; size: 'flip' | 'price' }
  | { kind: 'fireRate' }
  | { kind: 'none' };

export interface BeatEnemy {
  kind: 'grunt' | 'brute' | 'shieldBrute' | 'charger';
  lane: LaneRole;
  /** Metres from the beat's gate row; negative is in front of the panels. */
  at: number;
  /** Squad-to-enemy distance at which it starts walking. */
  wake: number;
  /** Seconds of the reference squad's fire it takes to clear (blocks). */
  killSeconds: number;
  /** Chargers: how many, spread over the roles in `lanes`. */
  lanes?: LaneRole[];
  /**
   * Holds the gateway (Phase 1, wave two): the block walks no nearer than
   * `enemies.beat.holdGap` in front of its gate row and stands there, so the
   * column meets it at the row whatever its wake. A guard stands on that line
   * from the start (`at` is minus the gap); an ambush walks through its panel
   * to it. Without it a block in front of the panels meets the column rows
   * before them, and a column that stepped aside to let it pass stepped back
   * into the prize for nothing.
   */
  hold?: boolean;
}

/** A river poured from a fixed place on the road (a portal). */
export interface BeatRiver {
  lanes: LaneRole[];
  /** Metres from the beat's gate row the portal stands at. */
  at: number;
  /**
   * Squad-to-portal distance at which it starts pouring. Give this or `tail`,
   * not both: a river timed by its tail has its opening solved from it.
   */
  open?: number;
  /**
   * Where the pour's last body meets the column, in metres past the gate row
   * (Phase 1, wave two). The composer opens the portal early enough that the
   * whole pour has run by then, so the river is still arriving as the column
   * crosses the row: leaving its lane means leaving its panel. Needs the
   * portal behind the panels (`at` well past the stop gap).
   */
  tail?: number;
  /** How long it pours, in seconds. */
  seconds: number;
  /** Hit points it brings over what the squad lands in its fire window. */
  pressure: number;
  /** Bodies per unit of E, per lane. */
  density: number;
}

export interface BeatFence {
  /** The role whose lane is the single outer lane. */
  outer: LaneRole;
  /** Metres before the gate row the stretch starts. */
  from: number;
  /** Both boundaries (the gauntlet, Phase 2). */
  both?: boolean;
}

export interface BeatTier {
  rating: 0 | 1 | 2 | 3 | 4 | 5;
  /** Expected loss for the reference player, share of E. */
  expectLoss: number;
  gates: Record<LaneRole, GateSlot>;
  enemies?: BeatEnemy[];
  rivers?: BeatRiver[];
  fence?: BeatFence;
}

export interface BeatDef {
  id: string;
  rows: 1 | 2 | 3;
  /** Keyed by tier, "1" to "5"; a tier lists only what differs from the one below. */
  tiers: Record<string, Partial<BeatTier>>;
}

/** The panel sizes a gate slot can name, as `[min, max]` shares of E. */
export type BeatValueSize = 'small' | 'mid' | 'big' | 'flip' | 'price';

/**
 * How much more a column clears of a river whose bodies walk bunched: a splash
 * takes every body inside its radius, so the fire a lane lands on a river
 * grows with its bodies per metre, `rho`, as `max(1, gain * rho ^ power)`
 * (measured in the beat lab per biome, Phase 1 wave two).
 */
export interface RiverBunch {
  gain: number;
  power: number;
}

/** `beats.json`, as the plan pins it. */
export interface BeatsData {
  /**
   * Hit points per second one unit of the reference squad lands, measured in
   * the beat lab per biome (Frostfell with the kit the campaign affords). The
   * river's is what a lane clears of bodies that walk alone; `bunch` is how
   * that grows as they walk closer together.
   */
  dps: {
    block: Record<BiomeId, number>;
    river: Record<BiomeId, number>;
    bunch: Record<BiomeId, RiverBunch>;
  };
  values: Record<BeatValueSize, [number, number]>;
  defs: BeatDef[];
}

/**
 * `beats.json` as the loader hands it over: every part optional but `defs`,
 * because the file is written in parallel with the code that reads it and may
 * be missing or half-written when the game boots. The composer fails loudly
 * when a script needs a part that is not there; nothing fails at import.
 */
export interface BeatLibrary {
  dps?: {
    block?: Partial<Record<BiomeId, number>>;
    river?: Partial<Record<BiomeId, number>>;
    bunch?: Partial<Record<BiomeId, RiverBunch>>;
  };
  values?: Partial<Record<BeatValueSize, [number, number]>>;
  defs: readonly BeatDef[];
}

/** What a script may ask the prize to be, in place of the tier's own. */
export type PrizeOverride = 'x2' | 'x3' | 'big';

/** One line of a level's script: a beat at a tier. */
export interface ScriptBeat {
  beat: string;
  tier: number;
  prize?: PrizeOverride;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The per-biome numbers of one `dps` entry that are actually numbers. */
function readBiomeNumbers(raw: unknown): Partial<Record<BiomeId, number>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<BiomeId, number>> = {};
  if (isFiniteNumber(raw.meadow)) out.meadow = raw.meadow;
  if (isFiniteNumber(raw.frost)) out.frost = raw.frost;
  return out;
}

/** The per-biome bunching curves of `dps.bunch` that are whole. */
function readBunches(raw: unknown): Partial<Record<BiomeId, RiverBunch>> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Partial<Record<BiomeId, RiverBunch>> = {};
  for (const biome of ['meadow', 'frost'] as const) {
    const entry = raw[biome];
    if (isRecord(entry) && isFiniteNumber(entry.gain) && isFiniteNumber(entry.power)) {
      out[biome] = { gain: entry.gain, power: entry.power };
    }
  }
  return out;
}

const VALUE_SIZES: readonly BeatValueSize[] = ['small', 'mid', 'big', 'flip', 'price'];

/**
 * Whatever of `beats.json` is usable, and nothing that is not.
 *
 * The file is written by hand, in parallel with the code, so this reads it
 * the way a loader for a half-finished file has to: a part that is missing or
 * the wrong shape is left out, and a def without an id or tiers is skipped.
 * The defs themselves are otherwise trusted as the pinned `BeatDef`, because
 * their contents are what `levelDesign.test.ts` checks against the composer.
 */
export function readBeatLibrary(raw: unknown): BeatLibrary {
  if (!isRecord(raw)) return { defs: [] };
  const library: BeatLibrary = { defs: [] };

  if (isRecord(raw.dps)) {
    const dps: NonNullable<BeatLibrary['dps']> = {};
    const block = readBiomeNumbers(raw.dps.block);
    const river = readBiomeNumbers(raw.dps.river);
    const bunch = readBunches(raw.dps.bunch);
    if (block !== undefined) dps.block = block;
    if (river !== undefined) dps.river = river;
    if (bunch !== undefined) dps.bunch = bunch;
    library.dps = dps;
  }

  if (isRecord(raw.values)) {
    const values: NonNullable<BeatLibrary['values']> = {};
    for (const size of VALUE_SIZES) {
      const pair = raw.values[size];
      if (Array.isArray(pair) && isFiniteNumber(pair[0]) && isFiniteNumber(pair[1])) {
        values[size] = [pair[0], pair[1]];
      }
    }
    library.values = values;
  }

  if (Array.isArray(raw.defs)) {
    const defs: BeatDef[] = [];
    for (const def of raw.defs as unknown[]) {
      if (!isRecord(def) || typeof def.id !== 'string' || !isRecord(def.tiers)) continue;
      // Checked just above for the two fields the composer keys on; the rest
      // of the def is the pinned shape and is checked by the static test.
      defs.push(def as unknown as BeatDef);
    }
    library.defs = defs;
  }
  return library;
}
