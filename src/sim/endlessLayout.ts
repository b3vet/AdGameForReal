/**
 * The endless road's shape (document 28): which kind every row is, where the
 * bosses stand, and which fences the arenas cannot have.
 *
 * Split out of `./endless.ts` for the file-size rule (CLAUDE.md), along the line
 * the generator already had: that file builds *one row* from the dials, and this
 * one decides what the rows are. It is the campaign's own dealer, asked once
 * per stretch rather than once for the whole road.
 *
 * A stretch is the road between two arenas, and it is dealt like a level: a
 * gate row first, then the dealt mix, and the campaign's gauntlet at its end
 * (`gen.gauntletRows`), so the squad walks into each boss thinned by a threat
 * row the way it walks into a campaign arena. The arena's own row and the
 * breathers after it are empty — nothing stands on them — so nothing past the
 * line can join the fight, and the first thing after it is a gate row.
 *
 * The stretches are dealt from a mix that climbs: `mix` at the start of the
 * road and `mixLate` from `mixRampRows` on, each stretch reading the shares at
 * its middle. That is the owner's "harder enemy batches" as a *composition*
 * change — fewer plain rivers, more hordes, brutes, chargers and shields —
 * beside the per-row dials that make each batch bigger.
 */

import { dealRowKinds } from './rowKinds';
import type { ArenaDef } from './level';
import type { RowDef } from './rows';
import type { WallDef } from './walls';
import { balance, endless } from '@/data';
import type { EndlessDial, EndlessMix, LevelGenConfig } from '@/data/types';

/**
 * Row kind of an arena and its breathers. Outside the dealer's own range on
 * purpose: nothing deals it, and it compares as "not a gate row" everywhere a
 * kind is asked that (`countGateRows`, the jitter rule in `./endless.ts`).
 */
export const ARENA_ROW = 100;

/** A dial `row` rows into the road, held under its own ceiling. */
export function dialAt(dial: EndlessDial, row: number): number {
  return Math.min(dial.cap, dial.start * Math.pow(dial.growth, Math.max(0, row)));
}

/** How many of `rows` carry `fraction` of them. Never below zero. */
export function share(rows: number, fraction: number): number {
  return Math.max(0, Math.round(rows * fraction));
}

/** The row index of every arena line the road has room for, in order. */
export function arenaRows(rowCount: number): number[] {
  const bosses = endless.bosses;
  const every = Math.max(2, Math.round(bosses.everyRows));
  const breathers = Math.max(0, Math.round(bosses.breatherRows));
  const rows: number[] = [];
  // Each arena keeps its breathers and at least one dealt row before the end,
  // so the road never finishes on a fight.
  for (let row = Math.max(1, Math.round(bosses.firstRow)); row + breathers < rowCount - 1; row += every) {
    rows.push(row);
  }
  return rows;
}

/** The shares a stretch centred on `row` is dealt from. */
function mixAt(row: number): EndlessMix {
  const t = Math.min(1, Math.max(0, row / Math.max(1, endless.mixRampRows)));
  const early = endless.mix;
  const late = endless.mixLate;
  const lerp = (a: number, b: number): number => a + (b - a) * t;
  return {
    gateRows: lerp(early.gateRows, late.gateRows),
    mixedRows: lerp(early.mixedRows, late.mixedRows),
    hordeRows: lerp(early.hordeRows, late.hordeRows),
    bruteRows: lerp(early.bruteRows, late.bruteRows),
    chargerRows: lerp(early.chargerRows, late.chargerRows),
    shieldRows: lerp(early.shieldRows, late.shieldRows),
    wallRows: lerp(early.wallRows, late.wallRows),
  };
}

/** `base` with the counts the dealer reads set for `rows` rows centred on `middle`. */
function stretchConfig(base: LevelGenConfig, rows: number, middle: number): LevelGenConfig {
  const mix = mixAt(middle);
  return {
    ...base,
    rows,
    gateRows: share(rows, mix.gateRows),
    mixedRows: share(rows, mix.mixedRows),
    hordeRows: share(rows, mix.hordeRows),
    bruteRows: share(rows, mix.bruteRows),
    chargerRows: share(rows, mix.chargerRows),
    shieldRows: share(rows, mix.shieldRows),
  };
}

/** Every row's kind, stretch by stretch, with the arenas laid in between. */
export function dealRoad(
  rng: () => number,
  base: LevelGenConfig,
  rowCount: number,
  arenas: readonly number[],
): number[] {
  const breathers = Math.max(0, Math.round(endless.bosses.breatherRows));
  const kinds: number[] = [];
  let from = 0;
  for (const at of [...arenas, rowCount]) {
    const rows = Math.min(at, rowCount) - from;
    if (rows > 0) {
      for (const kind of dealRowKinds(rng, stretchConfig(base, rows, from + rows / 2), rows)) {
        kinds.push(kind);
      }
    }
    if (at >= rowCount) break;
    for (let k = 0; k <= breathers && kinds.length < rowCount; k++) kinds.push(ARENA_ROW);
    from = kinds.length;
  }
  return kinds;
}

/** A row with nothing on it: an arena line, or the breather after one. */
export function emptyRow(z: number): RowDef {
  return { z, gates: [null, null, null], enemies: [] };
}

/** The boss at each arena: the kinds in turn, each bigger than the last. */
export function arenaDefs(arenas: readonly number[]): ArenaDef[] {
  const bosses = endless.bosses;
  const spacing = balance.level.rowSpacing;
  const hpPerUnit = balance.enemies.boss.hpPerUnit;
  return arenas.map((row, n) => {
    const hp = Math.round(dialAt(bosses.hp, n));
    return {
      z: spacing * (row + 1),
      hp,
      units: Math.max(1, Math.ceil(hp / hpPerUnit)),
      bite: dialAt(bosses.bite, n),
      kind: bosses.kinds[n % Math.max(1, bosses.kinds.length)] ?? 'demon',
      hold: bosses.holdSeconds,
    };
  });
}

/**
 * Keeps every fence clear of the arenas.
 *
 * The generator stops a stretch short of the gate row it guards and starts it
 * past the gate row before, and on the endless road the gate row before can
 * be on the far side of an arena. A fence holding across the line the squad
 * stops at would cut the fight in two, so a stretch that would is started
 * after the line instead — the squad has left the arena before it holds — and
 * dropped if what is left is too short to be a fence.
 */
export function clearArenas(walls: readonly WallDef[], arenas: readonly ArenaDef[]): WallDef[] {
  const tuning = balance.walls;
  const kept: WallDef[] = [];
  for (const wall of walls) {
    let zStart = wall.zStart;
    for (const arena of arenas) {
      const holdsFrom = zStart - tuning.approach;
      if (holdsFrom <= arena.z + tuning.gateClearance && wall.zEnd + tuning.gateGap >= arena.z) {
        zStart = arena.z + tuning.gateClearance + tuning.approach;
      }
    }
    if (wall.zEnd - zStart < tuning.minLength) continue;
    kept.push(zStart === wall.zStart ? wall : { ...wall, zStart });
  }
  return kept;
}
