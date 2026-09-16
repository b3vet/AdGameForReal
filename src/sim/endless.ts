/**
 * The endless road (D52): one road with no level number and no end but its
 * own, for as long as the player keeps walking — and, since the owner's second
 * playtest (document 28), a boss every few hundred metres of it.
 *
 * It is built out of the campaign's own parts rather than beside them — the
 * same row dealer, the same gate rules, the same stream sizing, the same
 * fences, the same two bosses — because a second generator would be a second
 * game to balance. What is different is where the numbers come from. A
 * campaign level reads forty fixed numbers out of `levels.json`; this reads a
 * *start* and a *growth* out of `endless.json` and hands every row a level
 * recipe of its own, one row long, built for the squad the dials say that row
 * should meet.
 *
 * That "one row long" is the trick that makes the reuse honest. Everything
 * downstream asks a `LevelGenConfig` for the squad it is sizing against, and it
 * asks through `squadCurve`; a config whose `startCount` and `peakTarget` are
 * both this row's dial answers that question with the dial, whatever row index
 * it is asked about. So the block sizes, the curse ceilings, the stream
 * pressure and the gate values on row 90 are the ones the campaign's own rules
 * would produce for a level built for that many units — and the only thing
 * Endless had to invent is the curve those numbers are read off.
 *
 * The shape of the road — which row is which kind, where the arenas stand and
 * which fences they cannot have — is `./endlessLayout.ts`. The arenas are
 * spaced one biome span apart, so each boss closes the stretch of its own
 * land: the demon at the end of a meadow, the Rime Fiend at the end of a frost.
 */

import { addValueFor } from './curve';
import {
  ARENA_ROW,
  arenaDefs,
  arenaRows,
  clearArenas,
  dealRoad,
  dialAt,
  emptyRow,
  share,
} from './endlessLayout';
import { genDials } from './gateGen';
import type { RowBudget } from './gateGen';
import { applyGateBonus, buildRow, placeWeaponGates } from './level';
import type { LevelDef } from './level';
import { playerMods } from './player';
import { mulberry32 } from './rng';
import { countGateRows, GATE_ROW, MIXED_ROW } from './rowKinds';
import type { RowDef } from './rows';
import { generateWalls } from './walls';
import { balance, endless } from '@/data';
import type { DealtLevelConfig, PlayerState, ValueRange } from '@/data/types';

export { dialAt } from './endlessLayout';

/** The level index the generator's level-keyed rules are told the road is at. */
function virtualLevel(row: number): number {
  return 1 + Math.floor(row / Math.max(1, endless.rowsPerVirtualLevel));
}

/**
 * The recipe one row is built from: a level of exactly one row, sized for the
 * squad this row's dials expect. See the file comment for why.
 */
function rowConfig(row: number, seed: number): DealtLevelConfig {
  const dials = endless.dials;
  const gen = balance.gen;
  const index = virtualLevel(row);
  const estimate = dialAt(dials.peakTarget, row);
  const values = endless.gateValues;
  const floor = Math.max(1, Math.round(values.subFloor));

  const config: DealtLevelConfig = {
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
function rowBudget(config: DealtLevelConfig, mul: ValueRange): RowBudget {
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

  const arenaAt = arenaRows(rowCount);
  const kinds = dealRoad(rng, rowConfig(0, resolved), rowCount, arenaAt);
  let mulsLeft = Math.round(balance.gen.mulChance * countGateRows(kinds, 0));

  const rows: RowDef[] = [];
  for (let i = 0; i < rowCount; i++) {
    const grid = spacing * (i + 1);
    const kind = kinds[i] ?? GATE_ROW;
    // An arena and its breathers stand nothing and draw nothing, so a road's
    // rows after them are the rows the same seed deals whatever the dials say.
    if (kind === ARENA_ROW) {
      rows.push(emptyRow(grid));
      continue;
    }
    const config = rowConfig(i, resolved);
    const budget = rowBudget(config, config.gateValues.mul);
    const gateRowsLeft = countGateRows(kinds, i);
    const permits = {
      mul:
        i > 0 &&
        kind <= MIXED_ROW &&
        mulsLeft > 0 &&
        config.index >= balance.gen.mulFromLevel &&
        rng() < mulsLeft / gateRowsLeft,
    };

    const z = kind <= MIXED_ROW ? grid : grid + (rng() * 2 - 1) * jitter;
    const row = buildRow(kind, rng, config, i, z, budget, permits);
    if (row.gates.some((g) => g?.kind === 'mul')) mulsLeft--;
    rows.push(row);
  }

  const arenaZ = spacing * (rowCount + 1);
  const arenas = arenaDefs(arenaAt);
  // One road, so the level-keyed rules for fences and staff gates are told one
  // index (`endless.wallLevel`) rather than being asked per row: a fence that
  // covers three rows cannot be at three different levels at once.
  const staffGates = balance.gen.weaponGatesEnabled
    ? Math.max(1, Math.round(rowCount / Math.max(1, endless.staffGateEveryRows)))
    : 0;
  placeWeaponGates(rows, endless.wallLevel, resolved, staffGates);
  applyGateBonus(rows, mods.gateBonus);

  const walls = generateWalls(
    rows,
    endless.wallLevel,
    resolved,
    arenaZ,
    share(rowCount, endless.mix.wallRows),
  );

  return {
    index: 0,
    seed: resolved,
    endless: true,
    runSpeed: balance.squad.runSpeed,
    startCount: Math.max(1, Math.round(endless.startCount + mods.startCount)),
    rows,
    arenaZ,
    arenas,
    biome: endless.biomes[0] ?? 'meadow',
    biomes: endless.biomes,
    biomeSpan: Math.max(1, endless.rowsPerBiome) * spacing,
    walls: clearArenas(walls, arenas),
    // The road's own end stands nobody; its bosses are `arenas`. This is what
    // `LevelDef` asks every road for, and only a campaign level's is read.
    boss: { hp: 0, units: 0 },
  };
}
