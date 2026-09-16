/**
 * One beat on a short road with no boss (document 31, 4.1 and 4.4): what the
 * beat lab plays at three squad sizes and what `?beat=<id>:<tier>` shows, so
 * a beat can be felt, and measured, in ten seconds.
 *
 * The road is the composer's own layout of a script one beat long, sized for
 * exactly the squad it is played with (E is `squadCount`, no curve). It is an
 * endless-style road — `endless` with no arenas — so a `Run` ends it as a win
 * the moment the column reaches its end, with nothing standing there.
 *
 * The beat is placed far enough up the road that the column starts outside
 * everything it holds: every block wakes, every portal opens and every fence
 * begins at least one row's spacing after the run starts, so what the lab
 * measures is the beat and not a squad that spawned inside it.
 */

import type { LevelDef } from '../level';
import { applyGateBonus } from '../levelPasses';
import { playerMods } from '../player';
import { balance, beats as shippedLibrary, levelCount } from '@/data';
import type { BeatLibrary, BiomeId, PlayerState, PrizeOverride } from '@/data/types';
import { drawValues, layBeats, valueStream } from './compose';
import { findBeat, resolveTier, withPrize } from './library';
import type { ResolvedTier } from './library';

export interface BeatLevelOptions {
  /** The script's prize override (`x2`, `x3`, `big`), as a level would write it. */
  prize?: PrizeOverride;
  /**
   * The level number the road is played as: the level-keyed rules (the curse
   * creep's `fromLevel`) read it. Defaults to the last campaign level, where
   * every such rule is on.
   */
  levelIndex?: number;
  /** The gate-bonus upgrade, as `generateLevel` applies it. */
  player?: PlayerState;
  /** A library other than the shipped `beats.json` (tests). */
  library?: BeatLibrary;
}

/** How far before the gate row the beat's first threat can act, in metres. */
function reachOf(tier: ResolvedTier): number {
  let reach = 0;
  for (const enemy of tier.enemies) reach = Math.max(reach, enemy.wake - enemy.at);
  for (const river of tier.rivers) reach = Math.max(reach, river.open - river.at);
  if (tier.fence !== null && tier.fence !== undefined) {
    reach = Math.max(reach, tier.fence.from + balance.walls.approach);
  }
  return reach;
}

/** How far past the gate row its last threat stands. */
function tailOf(tier: ResolvedTier): number {
  let tail = 0;
  for (const enemy of tier.enemies) tail = Math.max(tail, enemy.at);
  for (const river of tier.rivers) tail = Math.max(tail, river.at);
  return tail;
}

/**
 * One beat as a playable `LevelDef`.
 *
 * Deterministic in its arguments: `seed` picks the lanes and the panel values
 * exactly as it would for a level. Throws if the beat or the tier is not in the
 * library.
 */
export function buildBeatLevel(
  beatId: string,
  tier: number,
  squadCount: number,
  seed: number,
  biome: BiomeId = 'meadow',
  options: BeatLevelOptions = {},
): LevelDef {
  const library = options.library ?? shippedLibrary;
  const def = findBeat(library, beatId);
  const resolved = withPrize(resolveTier(def, tier), options.prize);
  const squad = Math.max(1, Math.round(squadCount));
  const spacing = balance.level.rowSpacing;

  // The gate row sits a row's spacing past the furthest the beat reaches, on
  // the row grid, and never so close that its lead-in rows fall before zero.
  const gateRow = Math.max(def.rows, Math.ceil((reachOf(resolved) + spacing) / spacing));
  const firstRow = gateRow - def.rows;
  const layout = layBeats(
    [
      {
        entry: { beat: beatId, tier, ...(options.prize === undefined ? {} : { prize: options.prize }) },
        rows: def.rows,
        tier: resolved,
        expected: squad,
        draws: drawValues(valueStream(seed)),
      },
    ],
    firstRow,
    seed,
    biome,
    1,
    library,
  );
  applyGateBonus(layout.rows, playerMods(options.player).gateBonus);

  const gateZ = spacing * gateRow;
  return {
    index: options.levelIndex ?? levelCount,
    seed,
    runSpeed: balance.squad.runSpeed,
    startCount: squad,
    rows: layout.rows,
    arenaZ: gateZ + spacing + Math.max(0, tailOf(resolved)),
    biome,
    walls: layout.walls,
    endless: true,
    boss: { hp: 0, units: 0 },
    beats: layout.marks,
    squadRates: true,
  };
}
