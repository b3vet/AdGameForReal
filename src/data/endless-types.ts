/**
 * Schema for `endless.json`: the one road that has no level number (D52).
 *
 * Its own file rather than another block of `./types.ts` for the reason every
 * other split here had — the file-size rule — and for one of its own: Endless
 * is not a level recipe. A `LevelGenConfig` is forty numbers describing one
 * fixed road; this is a *start* and a *growth*, and `generateEndless` reads a
 * fresh set of dials off it for every row it lays down, so the road gets harder
 * for as long as the player keeps walking.
 *
 * Every dial rises geometrically and is held under a cap, so an endless run is
 * bounded arithmetic and not a curve that eventually overflows: a player who
 * reaches the last row has beaten the hardest road the dials describe.
 */

import type { BiomeId } from './biome-types';
import type { ValueRange } from './level-types';

/** A dial that starts somewhere, grows per row and stops at a ceiling. */
export interface EndlessDial {
  start: number;
  /** Multiplier applied once per row. */
  growth: number;
  cap: number;
}

/**
 * How many of the road's rows carry each kind, as shares of the whole. Dealt by
 * `dealRowKinds`, which is the campaign's own dealer: the counts are what a
 * level recipe names outright, and these are the same counts written as shares
 * so one set serves a road of any length.
 */
export interface EndlessMix {
  gateRows: number;
  mixedRows: number;
  hordeRows: number;
  bruteRows: number;
  chargerRows: number;
  shieldRows: number;
  wallRows: number;
}

export interface EndlessConfig {
  /** The seed a run uses when the caller does not name one. */
  seed: number;
  /** How long the road is. The last row is the win condition (D52). */
  rows: number;
  /** Rows before the biome flips; the road alternates through `biomes`. */
  rowsPerBiome: number;
  /**
   * Rows per "virtual level". The generator's own gates — curses from
   * `gen.negativeFromLevel`, multipliers from `gen.mulFromLevel`, x3 from
   * `gen.mulX3FromLevel`, three-lane rows from `gen.fullGateRowsFromLevel` —
   * are all written in terms of a level index, and Endless has none, so it
   * counts one every this many rows. That is what makes the opening rows read
   * like level 1 and the deep road like level 25 without a second copy of any
   * of those rules.
   */
  rowsPerVirtualLevel: number;
  /** Every this many rows the generator turns the milestone screws (D45). */
  milestoneEveryRows: number;
  /**
   * Rows per staff gate. The campaign's own budget is one or two *per level*
   * (`gen.weaponGatesEarly`), which on a road of 160 rows would be two offers
   * in ten minutes; this is the same rule counted in rows instead.
   */
  staffGateEveryRows: number;
  /** Units the road starts the squad with. */
  startCount: number;
  /**
   * The four dials that make the road harder as it goes.
   *
   * `peakTarget` is the squad the *row* is built for, and it is a target rather
   * than a measurement: every `add` gate on the road is sized to close the gap
   * between the squad and the dial, so a player who is ahead of the curve is
   * handed small numbers and one who is behind is handed big ones. That is what
   * keeps a road with no levels in it honest — the dials decide the difficulty,
   * not the run's luck with multipliers.
   */
  dials: {
    peakTarget: EndlessDial;
    hpScale: EndlessDial;
    pressure: EndlessDial;
    density: EndlessDial;
  };
  mix: EndlessMix;
  /** The biomes the road walks through, in order, flipping every `rowsPerBiome`. */
  biomes: readonly BiomeId[];
  gateValues: {
    /** A curse is this share of the row's expected squad, floored at `subFloor`. */
    subShare: ValueRange;
    subFloor: number;
    addMax: number;
    fireRate: ValueRange;
  };
  /**
   * The level index `generateWalls` is told the road is at. Endless has no
   * index, and walls read three level thresholds (`walls.fromLevel`,
   * `bothFromLevel`, `stretchGapFromLevel`); naming one number here turns all
   * three on at once rather than hiding the decision inside the generator.
   */
  wallLevel: number;
  /** Coins one metre of road is worth (D52). */
  coinsPerMetre: number;
  /**
   * Ceiling on an endless run's pay, as a share of what a *repeat* clear of the
   * player's best campaign level pays. Under 1 so the campaign stays the earner
   * however long a player walks (D52).
   */
  capShare: number;
}
