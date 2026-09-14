/**
 * The sim state the stress scene pretends to be playing.
 *
 * Split out of `./stress.ts` for the file-size rule (CLAUDE.md): that file
 * builds and drives the worst-case frame, and this is the standing crowd it
 * draws it from. Nothing here ever ticks — the column is written once and the
 * scene advances only `state.time`, one sim step a frame, so the view's own
 * interpolation runs its full path over a crowd that photographs the same every
 * time (D43).
 */

import { balance } from '@/data';
import { createCrowdState, formationOffsets, openRoadWidth } from '@/sim';
import type { CrowdState, LevelDef, RunState } from '@/sim';

/**
 * Where the crowd's *front rank* stands; the column runs backward from it (D42)
 * a long way — five hundred units are one lane wide and seventy-seven ranks
 * deep, so the tail stands at `CROWD_Z - 13.3` and the camera, posed for that
 * depth every frame (`Renderer.poseCamera`), frames the front six metres of it
 * exactly as the game does. The ranks past that are below the bottom edge and
 * still cost their instances, which is the point of keeping all five hundred.
 *
 * The 2 m in front of the front rank keeps the tail in front of the *camera*:
 * the eye stands 14.4 m behind the anchor and the column is 13.3 long.
 */
export const CROWD_Z = 2;
export const ENEMY_Z = 14;
export const ARENA_Z = 40;

/** Just enough level for the physics layer's road collider. */
export function fakeLevel(mages: number): LevelDef {
  return {
    index: 1,
    seed: 1,
    runSpeed: balance.squad.runSpeed,
    startCount: mages,
    rows: [],
    arenaZ: ARENA_Z,
    boss: { hp: 400, units: 40 },
  };
}

/**
 * Just enough state for `PhysicsLayer.onEvents`, which reads the squad position
 * to know which way to throw a corpse, and for `Renderer.drawSquad`, which
 * reads the crowd. Nothing here ever ticks.
 */
export function fakeState(mages: number): RunState {
  const crowd = createCrowdState(balance.squad.maxCount);
  fillColumn(crowd, mages, CROWD_Z);
  return {
    levelIndex: 1,
    seed: 1,
    time: 0,
    status: 'running',
    squad: {
      count: mages,
      x: 0,
      targetX: 0,
      z: CROWD_Z,
      fireRate: balance.squad.fireRate,
      damage: balance.squad.damage,
      fireRateBonus: 0,
      vx: 0,
      // The open road: this scene has no walls, and it is what the camera's
      // pull-back measures the crowd's depth against.
      formationWidth: openRoadWidth(),
    },
    gates: [],
    enemies: [],
    streams: [],
    projectiles: [],
    boss: null,
    peakCount: mages,
    survivors: mages,
    arenaZ: ARENA_Z,
    crowd,
    groups: [{ id: 0, count: mages, leaderX: 0, z: CROWD_Z, lane: null, rejoinAt: 0 }],
  };
}

/**
 * A full column standing in its slots: the main group, front rank first, at the
 * sim's own formation. Every unit carries the level's run speed on `z`, which
 * is what makes the view draw the run clip — the crowd is standing still in
 * world space but it is a *walking* crowd, and the frame the tripwire measures
 * has to be the one the game draws.
 */
function fillColumn(crowd: CrowdState, count: number, z: number): void {
  const offsets = formationOffsets(count);
  const wanted = Math.min(crowd.capacity, count);
  for (let i = 0; i < wanted; i++) {
    const offset = offsets[i];
    crowd.alive[i] = 1;
    crowd.group[i] = 0;
    crowd.slot[i] = i;
    crowd.x[i] = offset?.x ?? 0;
    crowd.z[i] = z + (offset?.z ?? 0);
    crowd.vx[i] = 0;
    crowd.vz[i] = balance.squad.runSpeed;
  }
}
