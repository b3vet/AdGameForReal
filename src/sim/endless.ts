/**
 * The endless road (D52): one road with no level number, no boss and no end
 * but its own, for as long as the player keeps walking.
 *
 * It is built out of the campaign's own parts rather than beside them — the
 * same row dealer, the same gate rules, the same stream sizing, the same
 * fences — because a second generator would be a second game to balance. What
 * is different is where the numbers come from. A campaign level reads forty
 * fixed numbers out of `levels.json`; this reads a *start* and a *growth* out
 * of `endless.json` and hands every row a level recipe of its own, one row
 * long, built for the squad the dials say that row should meet.
 *
 * That "one row long" is the trick that makes the reuse honest. Everything
 * downstream asks a `LevelGenConfig` for the squad it is sizing against, and it
 * asks through `squadCurve`; a config whose `startCount` and `peakTarget` are
 * both this row's dial answers that question with the dial, whatever row index
 * it is asked about. So the block sizes, the curse ceilings, the stream
 * pressure and the gate values on row 90 are the ones the campaign's own rules
 * would produce for a level built for that many units — and the only thing
 * Endless had to invent is the curve those numbers are read off.
 */

import { addValueFor } from './curve';
import { genDials } from './gateGen';
import type { RowBudget } from './gateGen';
import { applyGateBonus, buildRow, placeWeaponGates } from './level';
import type { LevelDef } from './level';
import { playerMods } from './player';
import { mulberry32 } from './rng';
import { countGateRows, dealRowKinds, GATE_ROW, MIXED_ROW } from './rowKinds';
import type { RowDef } from './rows';
import { generateWalls } from './walls';
import { balance, endless } from '@/data';
import type { EndlessDial, LevelGenConfig, PlayerState, ValueRange } from '@/data/types';

/** A dial `row` rows into the road, held under its own ceiling. */
export function dialAt(dial: EndlessDial, row: number): number {
  return Math.min(dial.cap, dial.start * Math.pow(dial.growth, Math.max(0, row)));
}

/** The level index the generator's level-keyed rules are told the road is at. */
function virtualLevel(row: number): number {
  return 1 + Math.floor(row / Math.max(1, endless.rowsPerVirtualLevel));
}

/** How many of the road's rows carry `share` of them. Never below zero. */
function share(rows: number, fraction: number): number {
  return Math.max(0, Math.round(rows * fraction));
}

/**
 * The recipe one row is built from: a level of exactly one row, sized for the
 * squad this row's dials expect. See the file comment for why.
 */
function rowConfig(row: number, seed: number): LevelGenConfig {
  const dials = endless.dials;
  const gen = balance.gen;
  const index = virtualLevel(row);
  const estimate = dialAt(dials.peakTarget, row);
  const values = endless.gateValues;
  const floor = Math.max(1, Math.round(values.subFloor));

  const config: LevelGenConfig = {
    index,
    seed,
    rows: 1,
    startCount: estimate,
    peakTarget: estimate,
    hpScale: dialAt(dials.hpScale, row),
    boss: { hp: 0, bite: 0 },
    gateValues: {
      // The x3 multiplier arrives on the virtual level the campaign's own does.
      mul: { min: 2, max: index >= gen.mulX3FromLevel ? 3 : 2 },
      add: { min: 1, max: values.addMax },
      // A curse as a share of the row's own squad rather than a fixed range:
      // the road runs from eight units to five hundred, and a range written for
      // one end of that is a shrug at the other.
      sub: {
        min: Math.max(floor, Math.round(estimate * values.subShare.min)),
        max: Math.max(floor + 1, Math.round(estimate * values.subShare.max)),
      },
      fireRate: values.fireRate,
    },
    gateRows: 1,
    mixedRows: 0,
    hordeRows: 0,
    bruteRows: 0,
    wallRows: 0,
    streamPressure: dialAt(dials.pressure, row),
    streamDensity: dialAt(dials.density, row),
  };
  // Every `milestoneEveryRows` rows the generator turns the milestone screws
  // (D45): fatter blocks, a third lane every time, double curses more often.
  // Row 0 is exempt — the road's first row is where the squad is smallest.
  const every = Math.max(1, Math.round(endless.milestoneEveryRows));
  if (row > 0 && row % every === 0) config.milestone = true;
  return config;
}

/** What the curve expects of one row: the same three numbers `level.ts` builds. */
function rowBudget(config: LevelGenConfig, mul: ValueRange): RowBudget {
  const estimate = config.peakTarget;
  return {
    estimate,
    addValue: addValueFor(
      estimate,
      endless.dials.peakTarget.growth,
      Math.min(1, Math.max(0.2, endless.mix.gateRows)),
      config.index,
      mul,
    ),
    curseCeiling: Math.max(2, Math.floor(estimate * genDials(config).curseShare)),
  };
}

/** The counts `dealRowKinds` deals the whole road from, as shares of its rows. */
function roadConfig(rows: number, seed: number): LevelGenConfig {
  const mix = endless.mix;
  const config = rowConfig(0, seed);
  config.rows = rows;
  config.gateRows = share(rows, mix.gateRows);
  config.mixedRows = share(rows, mix.mixedRows);
  config.hordeRows = share(rows, mix.hordeRows);
  config.bruteRows = share(rows, mix.bruteRows);
  config.chargerRows = share(rows, mix.chargerRows);
  config.shieldRows = share(rows, mix.shieldRows);
  return config;
}

/**
 * The endless road, as a `LevelDef` a `Run` plays exactly like a level.
 *
 * Deterministic in `seed` alone (and in the player's two level-shaping
 * upgrades, like `generateLevel`): the same seed is the same road, which is
 * what makes an endless score worth comparing and a run worth replaying (D52).
 */
export function generateEndless(seed: number = endless.seed, player?: PlayerState): LevelDef {
  const mods = playerMods(player);
  const resolved = seed >>> 0;
  const rng = mulberry32(resolved);
  const rowCount = Math.max(1, Math.floor(endless.rows));
  const spacing = balance.level.rowSpacing;
  const jitter = Math.max(
    0,
    Math.min(balance.streams.zJitter, spacing - balance.streams.gateClearance),
  );

  const road = roadConfig(rowCount, resolved);
  const kinds = dealRowKinds(rng, road, rowCount);
  let mulsLeft = Math.round(balance.gen.mulChance * road.gateRows);

  const rows: RowDef[] = [];
  for (let i = 0; i < rowCount; i++) {
    const config = rowConfig(i, resolved);
    const budget = rowBudget(config, config.gateValues.mul);
    const kind = kinds[i] ?? GATE_ROW;
    const gateRowsLeft = countGateRows(kinds, i);
    const permits = {
      mul:
        i > 0 &&
        kind <= MIXED_ROW &&
        mulsLeft > 0 &&
        config.index >= balance.gen.mulFromLevel &&
        rng() < mulsLeft / gateRowsLeft,
    };

    const grid = spacing * (i + 1);
    const z = kind <= MIXED_ROW ? grid : grid + (rng() * 2 - 1) * jitter;
    const row = buildRow(kind, rng, config, i, z, budget, permits);
    if (row.gates.some((g) => g?.kind === 'mul')) mulsLeft--;
    rows.push(row);
  }

  const arenaZ = spacing * (rowCount + 1);
  // One road, so the level-keyed rules for fences and staff gates are told one
  // index (`endless.wallLevel`) rather than being asked per row: a fence that
  // covers three rows cannot be at three different levels at once.
  const staffGates = balance.gen.weaponGatesEnabled
    ? Math.max(1, Math.round(rowCount / Math.max(1, endless.staffGateEveryRows)))
    : 0;
  placeWeaponGates(rows, endless.wallLevel, resolved, staffGates);
  applyGateBonus(rows, mods.gateBonus);

  return {
    index: 0,
    seed: resolved,
    endless: true,
    runSpeed: balance.squad.runSpeed,
    startCount: Math.max(1, Math.round(endless.startCount + mods.startCount)),
    rows,
    arenaZ,
    biome: endless.biomes[0] ?? 'meadow',
    biomes: endless.biomes,
    biomeSpan: Math.max(1, endless.rowsPerBiome) * spacing,
    walls: generateWalls(
      rows,
      endless.wallLevel,
      resolved,
      arenaZ,
      share(rowCount, endless.mix.wallRows),
    ),
    // No boss stands on this road (D52), so nothing reads these: `buildWorld`
    // returns before it looks, and `Run` never wakes an arena that is empty.
    boss: { hp: 0, units: 0 },
  };
}
