/**
 * Fences that commit (document 31, 3.6): a fence beat's stretch as the
 * `WallDef`s the sim already runs.
 *
 * Only a fence beat places a fence on a scripted road; the random pass and its
 * `bothHalvesPayable` guard are the dealt road's. What replaces that guard is
 * a check that the two sides of the fence are what the beat says they are: the
 * outer lane is a side lane holding a prize and a toll, and the inner side
 * holds a plus. The approach zone, the gate gap and the straggler rules are
 * the walls' own and are unchanged (D32, D43, D44).
 */

import type { GateDef, Lane } from '../types';
import type { WallBoundary, WallDef } from '../walls';
import { balance as shipped } from '@/data';
import type { Balance, BeatFence } from '@/data/types';

/**
 * The walls a fence beat stands. `gateZ` is its gate row; `floorZ` is the
 * nearest `z` the stretch may start at (the gate row behind it plus
 * `walls.gateClearance`), so a fence never reaches another beat's panels.
 */
export function fenceWalls(
  id: string,
  fence: BeatFence,
  gateZ: number,
  outerLane: Lane,
  floorZ: number,
  balance: Balance = shipped,
): WallDef[] {
  const walls = balance.walls;
  const zEnd = gateZ - walls.gateGap;
  const zStart = Math.max(gateZ - fence.from, floorZ);
  if (zEnd - zStart < walls.minLength) {
    throw new Error(
      `beat "${id}": its fence runs ${(zEnd - zStart).toFixed(1)} m, shorter than walls.minLength`,
    );
  }
  if (fence.both === true) {
    if (outerLane !== 0) throw new Error(`beat "${id}": a fence on both boundaries needs its lane in the middle`);
    return [
      { boundary: -1, zStart, zEnd },
      { boundary: 1, zStart, zEnd },
    ];
  }
  if (outerLane === 0) throw new Error(`beat "${id}": a fence's outer lane must be a side lane`);
  const boundary: WallBoundary = outerLane < 0 ? -1 : 1;
  return [{ boundary, zStart, zEnd }];
}

function grows(gate: GateDef | null | undefined): boolean {
  return gate !== null && gate !== undefined && (gate.kind === 'add' || gate.kind === 'mul');
}

/**
 * Throws unless the fence's sides are what 3.6 says: the outer lane grows the
 * squad and carries a threat (the toll), and the side inside the fence has a
 * plus to take. A gauntlet (both boundaries) has one lane and no inside.
 */
export function checkFenceSides(
  id: string,
  fence: BeatFence,
  gates: readonly (GateDef | null)[],
  outerLane: Lane,
  threatened: ReadonlySet<Lane>,
): void {
  if (!grows(gates[outerLane + 1])) {
    throw new Error(`beat "${id}": the fence's outer lane does not hold a prize`);
  }
  if (!threatened.has(outerLane)) {
    throw new Error(`beat "${id}": the fence's outer lane has no toll`);
  }
  if (fence.both === true) return;
  const inner: Lane[] = outerLane < 0 ? [0, 1] : [-1, 0];
  if (!inner.some((lane) => grows(gates[lane + 1]))) {
    throw new Error(`beat "${id}": the side inside the fence has no plus`);
  }
}
