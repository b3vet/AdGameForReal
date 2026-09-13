/**
 * The crowd's arrays, and the queries over them that are not about *changing*
 * anything.
 *
 * Kept apart from `crowd.ts` so the shape of the state — which render and the
 * dev fixtures build and read — is one short module, and the simulation of it
 * is another.
 */

import type { CrowdState } from './types';

/**
 * A crowd with nobody in it. `Run` makes one per run at `squad.maxCount`;
 * callers that hold a `RunState` they built by hand — render's dev fixture,
 * the stress scene — can make one to fill the field with.
 */
export function createCrowdState(capacity: number): CrowdState {
  const size = Math.max(0, Math.floor(capacity));
  return {
    capacity: size,
    alive: new Uint8Array(size),
    x: new Float64Array(size),
    z: new Float64Array(size),
    vx: new Float64Array(size),
    vz: new Float64Array(size),
    group: new Uint8Array(size),
    slot: new Uint16Array(size),
    flags: new Uint8Array(size),
  };
}

/**
 * The live unit standing nearest `(x, z)`, or -1 if there is none. `group` is
 * -1 for "anyone".
 *
 * A linear scan, deliberately: it is asked once per unit a blow takes — a
 * handful a second at the arena, a few dozen when a block lands — and a scan
 * over five hundred entries costs less than keeping a second index up to date
 * every step for the sake of it. Ties go to the lower index, so the answer does
 * not depend on the order the crowd happens to be laid out in.
 */
export function nearestLive(crowd: CrowdState, group: number, x: number, z: number): number {
  let best = -1;
  let bestGap = Infinity;
  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0) continue;
    if (group >= 0 && (crowd.group[i] ?? 0) !== group) continue;
    const dx = (crowd.x[i] ?? 0) - x;
    const dz = (crowd.z[i] ?? 0) - z;
    const gap = dx * dx + dz * dz;
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}
