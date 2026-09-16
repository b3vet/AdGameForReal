/**
 * Where an event's debris starts from, read off the sim's state: which way a
 * corpse is thrown, and where a broken gate's panel stood.
 *
 * Split out of `./PhysicsLayer.ts` for the file-size rule (CLAUDE.md) when the
 * layer grew its pre-step gate (`./prestep.ts`). Both answers are written into
 * objects owned here and reused, because `onEvents` runs on every frame of
 * every run and may not allocate; a caller reads them before asking again.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';

import { laneCenter } from '@/sim';
import type { RunState } from '@/sim';

const scratchDirection = new Vector3();
const scratchAway = { dx: 0, dz: 1 };
const scratchGate = { x: 0, z: 0 };
const DOWN_ROAD = { dx: 0, dz: 1 } as const;

/**
 * Which way a corpse is thrown: the unit direction from the squad to
 * `(x, z)`. A body killed on contact sits on top of the squad and has no
 * direction at all, so that case falls back to "further down the road".
 */
export function awayFromSquad(x: number, z: number, state: RunState): { dx: number; dz: number } {
  scratchDirection.set(x - state.squad.x, 0, z - state.squad.z);
  const length = scratchDirection.length();
  if (length < 0.01) return DOWN_ROAD;
  scratchAway.dx = scratchDirection.x / length;
  scratchAway.dz = scratchDirection.z / length;
  return scratchAway;
}

/** Where a gate's panel stands, or the squad if that gate is already gone. */
export function gatePosition(gateId: number, state: RunState): { x: number; z: number } {
  for (const gate of state.gates) {
    if (gate.id !== gateId) continue;
    scratchGate.x = laneCenter(gate.lane);
    scratchGate.z = gate.z;
    return scratchGate;
  }
  scratchGate.x = state.squad.x;
  scratchGate.z = state.squad.z;
  return scratchGate;
}
