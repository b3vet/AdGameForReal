/**
 * The composer (document 31, 3.8): a level's script of beats turned into the
 * `RowDef`s, fences and marks the sim already runs, so `buildWorld`, the
 * crossings, render and the bots keep their input shape.
 *
 * Each beat is its gate row G and the lead-in rows before it, 18 m apart: a
 * threat anchored in front of the panels is filed under the row at G - 18, and
 * anything anchored behind them under the gate row itself. Roles become lanes
 * by the seed (`roles.ts`), budgets are checked and spent (`budgets.ts`), the
 * squad each beat is sized for is walked with its losses (`beatCurve.ts`),
 * and the sizes follow (`beatSize.ts`).
 *
 * Deterministic: the roles and the value draws come from two salted streams of
 * the level seed, one permutation and three draws per beat whatever the beat
 * holds, so a script and a seed always give the same road (4.3).
 */

import type { LevelDef } from '../level';
import { applyGateBonus, placeScriptStaffs } from '../levelPasses';
import type { StaffOffer } from '../levelPasses';
import { emptyPlayer, playerMods } from '../player';
import { mulberry32 } from '../rng';
import type { RowDef, RowEnemyDef } from '../rows';
import type { GateDef, Lane } from '../types';
import type { WallDef } from '../walls';
import { balance, beats as shippedLibrary, levels } from '@/data';
import type {
  BeatLibrary,
  BiomeId,
  BossKind,
  ExpectedKit,
  LevelGenConfig,
  PlayerState,
  ScriptBeat,
} from '@/data/types';
import { scaleAt, shotSeconds, solveGrowthCurve } from './beatCurve';
import type { BeatCurve, CurveBeat, CurveScales } from './beatCurve';
import { blockFor, capBodies, capLive, gateFor, holdAt, sizeRiver, stopsShots } from './beatSize';
import type { SizedRiver } from './beatSize';
import { checkMultipliers, fundCurses, staffDemand, staffHosts } from './budgets';
import { checkFenceSides, fenceWalls } from './fences';
import { beatBunch, beatDps, findBeat, resolveTier, ROLES, withPrize } from './library';
import type { ResolvedTier } from './library';
import type { BeatMark } from './marks';
import { RolePicker } from './roles';

/** Mixed into the level seed for the panel-value draws. */
const VALUE_SALT = 0x0b_ea_75_1d;

/** One beat, resolved and ready to lay: what it is and the squad it is sized for. */
export interface LaidBeat {
  entry: ScriptBeat;
  rows: number;
  tier: ResolvedTier;
  /** E: the squad the reference player is expected to bring to it. */
  expected: number;
  /** The three value draws, in role order (prize, safe, other). */
  draws: readonly [number, number, number];
}

export interface Layout {
  rows: RowDef[];
  walls: WallDef[];
  marks: BeatMark[];
  /** Per beat, in order: the lanes a staff gate could take on its gate row. */
  offers: StaffOffer[];
}

/** Three value draws from the stream, in a fixed order. */
export function drawValues(stream: () => number): [number, number, number] {
  const prize = stream();
  const safe = stream();
  const other = stream();
  return [prize, safe, other];
}

export function valueStream(seed: number): () => number {
  return mulberry32((seed ^ VALUE_SALT) >>> 0);
}

function emptyRow(z: number): RowDef {
  return { z, gates: [null, null, null], enemies: [], streams: [] };
}

/**
 * Lays beats down the road from row slot `firstRow`. Rows are appended in
 * road order; `scale` is the curve's factor on the plus panels, one for every
 * beat or each beat its own (`BeatCurve.scales`).
 */
export function layBeats(
  laid: readonly LaidBeat[],
  firstRow: number,
  seed: number,
  biome: BiomeId,
  scale: CurveScales,
  library: BeatLibrary,
): Layout {
  const spacing = balance.level.rowSpacing;
  const picker = new RolePicker(seed);
  const blockDps = beatDps(library, 'block', biome, balance);
  const riverDps = beatDps(library, 'river', biome, balance);
  const bunch = beatBunch(library, biome);
  const layout: Layout = { rows: [], walls: [], marks: [], offers: [] };
  // Every river of the road, in the order laid, for the road-wide ceiling.
  const rivers: SizedRiver[] = [];

  let slot = firstRow;
  let floorZ = 0;
  for (const [k, beat] of laid.entries()) {
    const id = beat.entry.beat;
    const tier = beat.tier;
    const roles = picker.pick(tier, id);
    const e = beat.expected;

    const beatRows: RowDef[] = [];
    for (let r = 0; r < beat.rows; r++) beatRows.push(emptyRow(spacing * (slot + r + 1)));
    slot += beat.rows;
    const gateRow = beatRows[beatRows.length - 1];
    if (gateRow === undefined) throw new Error(`beat "${id}" has no rows`);
    const leadRow = beatRows[beatRows.length - 2] ?? gateRow;
    const gateZ = gateRow.z;
    const rowFor = (at: number): RowDef => (at < 0 ? leadRow : gateRow);

    ROLES.forEach((role, index) => {
      gateRow.gates[roles[role] + 1] = gateFor(
        tier.gates[role],
        e,
        beat.draws[index] ?? 0,
        scaleAt(scale, k),
        library,
        balance,
      );
    });
    const gates: readonly (GateDef | null)[] = gateRow.gates;
    const screenedAt = (lane: Lane, at: number): boolean => at > 0 && stopsShots(gates[lane + 1] ?? null);
    const threatened = new Set<Lane>();

    for (const enemy of tier.enemies) {
      const spread = enemy.lanes !== undefined && enemy.lanes.length > 0 ? enemy.lanes : [enemy.lane];
      // A block that holds the gateway never stands in front of its line.
      const hold = holdAt(enemy, balance);
      const at = hold === null ? enemy.at : Math.max(enemy.at, hold);
      for (const role of spread) {
        const lane = roles[role];
        const row = rowFor(at);
        const def: RowEnemyDef = blockFor(
          enemy,
          lane,
          gateZ + at - row.z,
          e,
          blockDps,
          screenedAt(lane, at),
          balance,
          hold === null ? undefined : gateZ + hold - row.z,
        );
        row.enemies.push(def);
        threatened.add(lane);
      }
    }

    const poured: SizedRiver[] = [];
    for (const river of tier.rivers) {
      const row = rowFor(river.at);
      for (const role of river.lanes) {
        const lane = roles[role];
        const sized = sizeRiver(river, lane, gateZ + river.at, e, riverDps, screenedAt(lane, river.at), bunch, balance);
        poured.push(sized);
        rivers.push(sized);
        (row.streams ??= []).push(sized.def);
        threatened.add(lane);
      }
    }
    capBodies(poured, balance);

    const fence = tier.fence;
    if (fence !== null && fence !== undefined) {
      const outer = roles[fence.outer];
      layout.walls.push(...fenceWalls(id, fence, gateZ, outer, floorZ, balance));
      checkFenceSides(id, fence, gates, outer, threatened);
    }

    layout.rows.push(...beatRows);
    layout.marks.push({ z: gateZ, beat: id, tier: beat.entry.tier, prize: roles.prize, expected: e });
    const lanes: Lane[] = [roles.safe, roles.other];
    lanes.sort((a, b) => a - b);
    layout.offers.push({ row: layout.rows.length - 1, lanes });
    floorZ = gateZ + balance.walls.gateClearance;
  }

  capLive(rivers, balance);
  layout.walls.sort((a, b) => a.zStart - b.zStart || a.boundary - b.boundary);
  return layout;
}

/**
 * What the level curve reads of each beat (`beatCurve.ts`): the prize, its own
 * value draw, the loss the tier expects, the fire its panel is expected to
 * take and the gate bonus it is expected to be printed with (`bonus`, one for
 * a bare hand).
 */
export function curveBeats(
  tiers: readonly ResolvedTier[],
  prizeDraws: readonly number[],
  bonus = 1,
): CurveBeat[] {
  return tiers.map((tier, k) => {
    const beat: CurveBeat = {
      prize: tier.gates.prize,
      prizeU: prizeDraws[k] ?? 0,
      expectLoss: tier.expectLoss,
      shotSeconds: shotSeconds(tier, balance),
      bonus,
    };
    // A flip curse pays when shot green (document 32, `gateFor`).
    if (ROLES.some((role) => tier.gates[role].kind === 'sub' && tier.gates[role].size === 'flip')) {
      beat.flipPayout = balance.gates.flip.payout;
    }
    return beat;
  });
}

/**
 * The level-shaping half of `playerMods` for the kit a level's curve expects
 * (`LevelGenConfig.kit`): read through `playerMods` itself, so the curve and
 * the run can never disagree about what a rung is worth.
 */
export function expectedMods(kit: ExpectedKit | undefined): { startCount: number; gateBonus: number } {
  if (kit === undefined) return { startCount: 0, gateBonus: 1 };
  const player = emptyPlayer();
  player.upgrades.startCount = kit.startCount ?? 0;
  player.upgrades.gateBonus = kit.gateBonus ?? 0;
  const mods = playerMods(player);
  return { startCount: mods.startCount, gateBonus: mods.gateBonus };
}

/**
 * The curve a script is sized on (3.4): walked from the count the expected
 * kit starts with, every prize read as that kit prints it, and solved so the
 * level peaks on `peakTarget * curveTrim` under the pool's ceiling with half
 * of that grown by the middle beat (document 32, `solveGrowthCurve`). Shared
 * with the static tests, so they check the curve the composer lays.
 */
export function levelCurve(
  config: LevelGenConfig,
  tiers: readonly ResolvedTier[],
  prizeDraws: readonly number[],
  library: BeatLibrary,
): BeatCurve {
  const kit = expectedMods(config.kit);
  const target = Math.min(balance.squad.maxCount, config.peakTarget * (config.curveTrim ?? 1));
  return solveGrowthCurve(
    config.startCount + kit.startCount,
    curveBeats(tiers, prizeDraws, kit.gateBonus),
    target,
    library,
    balance,
  );
}

/** A data error with the level it was found on in front of it. */
function levelError(index: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`level ${String(index)}: ${message}`, { cause: error });
}

/**
 * The script's beats, resolved, budget-checked and with the level's curses
 * spent. Throws with the level's number on any data error.
 */
export function resolveScript(
  index: number,
  script: readonly ScriptBeat[],
  curses: number | undefined,
  library: BeatLibrary,
): Array<{ entry: ScriptBeat; rows: number; tier: ResolvedTier }> {
  try {
    const resolved = script.map((entry) => {
      const def = findBeat(library, entry.beat);
      return { id: entry.beat, entry, rows: def.rows, tier: withPrize(resolveTier(def, entry.tier), entry.prize) };
    });
    checkMultipliers(index, resolved, balance);
    const tiers = fundCurses(resolved, curses);
    return resolved.map((beat, k) => ({ entry: beat.entry, rows: beat.rows, tier: tiers[k] ?? beat.tier }));
  } catch (error) {
    throw levelError(index, error);
  }
}

/**
 * A scripted level. `generateLevel` calls this when the config has a
 * `script`; `library` is the shipped `beats.json` and `campaign` the shipped
 * `levels.json` unless a test hands in its own.
 */
export function composeLevel(
  index: number,
  config: LevelGenConfig,
  seed: number,
  player?: PlayerState,
  library: BeatLibrary = shippedLibrary,
  // The levels before this one, for the staff offers they could not host
  // (`staffDemand`); a test composing a level on its own passes none.
  campaign: readonly LevelGenConfig[] = levels,
): LevelDef {
  const script = config.script ?? [];
  if (script.length === 0) throw new Error(`level ${String(index)}: the script is empty`);
  const mods = playerMods(player);
  const biome: BiomeId = config.biome ?? 'meadow';
  const resolved = resolveScript(index, script, config.curses, library);

  const values = valueStream(seed);
  const draws = resolved.map(() => drawValues(values));
  const curve = levelCurve(
    config,
    resolved.map((beat) => beat.tier),
    draws.map((draw) => draw[0]),
    library,
  );

  const laid: LaidBeat[] = resolved.map((beat, k) => ({
    entry: beat.entry,
    rows: beat.rows,
    tier: beat.tier,
    expected: curve.expected[k] ?? config.startCount,
    draws: draws[k] ?? [0, 0, 0],
  }));

  let layout: Layout;
  try {
    layout = layBeats(laid, 0, seed, biome, curve.scales, library);
  } catch (error) {
    throw levelError(index, error);
  }

  // Only the open and rest beats past the first carry a staff (`staffHosts`):
  // every other beat's lanes are its question.
  const hosts = new Set(staffHosts(script));
  placeScriptStaffs(
    layout.rows,
    layout.offers.filter((_, k) => hosts.has(k)),
    staffDemand(index, campaign),
    seed,
  );
  applyGateBonus(layout.rows, mods.gateBonus);

  const arenaZ = balance.level.rowSpacing * (layout.rows.length + 1);
  const bossKind: BossKind = config.boss.kind ?? 'demon';
  return {
    index,
    seed,
    runSpeed: balance.squad.runSpeed,
    startCount: config.startCount + mods.startCount,
    rows: layout.rows,
    arenaZ,
    bossId: bossKind,
    biome,
    walls: layout.walls,
    boss: {
      hp: config.boss.hp,
      units: Math.max(1, Math.ceil(config.boss.hp / balance.enemies.boss.hpPerUnit)),
      bite: config.boss.bite,
      kind: bossKind,
    },
    beats: layout.marks,
    squadRates: true,
  };
}
