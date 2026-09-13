/**
 * Stragglers (D44): the units a wall shuts out, and what becomes of them.
 *
 * The product owner's rule for Milestone 6 is that a slow lane change *costs*
 * part of the crowd rather than being clamped away. So the moment a stretch
 * begins to hold at the column's front, every unit on the far side of that
 * fence line stops being one of the column: it becomes a group of its own, led
 * down the middle of the lane it is standing in, walking with the column,
 * firing, being shoved and contacted, and taking the gates it walks through on
 * its own account. When the stretch releases, its survivors scurry back to the
 * slots at the back of the column.
 *
 * The cut is made once, on the step the wall starts to hold. Dragging the head
 * across a fence *after* that does not cut a second group: the column simply
 * jams against the fence and spills along it, which is the honest consequence
 * of a finger asking for somewhere the crowd cannot go.
 */

import { laneCenter, laneOf } from './lanes';
import { wallHolds, wallX } from './walls';
import type { CrowdSim } from './crowd';
import type { Lane, RunState } from './types';
import type { Balance } from '@/data/types';

/**
 * Cuts off whoever a stretch shuts out, and sends home whoever it releases.
 * Called once a step, before the forces, so a unit changes group and then
 * walks under its new leader in the same step.
 */
export function updateStragglers(sim: CrowdSim, state: RunState, balance: Balance): void {
  // Released first: a group that goes home this step frees its slot for the
  // next fence, which matters on the levels that wall both boundaries.
  release(sim, state, balance);
  cutOff(sim, state, balance);
}

function release(sim: CrowdSim, state: RunState, balance: Balance): void {
  const runSpeed = Math.max(0.1, balance.squad.runSpeed);
  for (let g = 1; g < sim.groups.length; g++) {
    const group = sim.groups[g];
    if (group === undefined || group.count === 0) continue;
    const at = sim.releaseZ[g] ?? 0;
    // Kept honest every step rather than stamped once: the column stops at the
    // arena, and a group whose fence is still ahead of it then is one that
    // fights where it stands (D44) rather than one that is about to go home.
    group.rejoinAt = state.time + Math.max(0, at - group.z) / runSpeed;
    if (group.z < at) continue;
    sim.rejoinToMain(g);
  }
}

function cutOff(sim: CrowdSim, state: RunState, balance: Balance): void {
  const walls = state.walls ?? [];
  const approach = balance.walls.approach;
  const gap = balance.walls.gateGap;
  const squad = state.squad;

  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i];
    if (wall === undefined) continue;
    const holds = wallHolds(wall, squad.z, approach, gap);
    const held = (sim.wallHeld[i] ?? 0) === 1;
    sim.wallHeld[i] = holds ? 1 : 0;
    // Only the edge: the stretch starts to hold once, and that is the moment
    // the crowd is divided.
    if (!holds || held) continue;
    cut(sim, state, balance, wallX(wall.boundary, balance.road.laneWidth), wall.zEnd + gap);
  }
}

/**
 * Everyone in the main column on the far side of `line` leaves it.
 *
 * The side the column keeps is the side its head is on, which is the same test
 * `wallLimits` makes, so the group that keeps the name is the one the player
 * is steering.
 */
function cut(
  sim: CrowdSim,
  state: RunState,
  balance: Balance,
  line: number,
  releaseZ: number,
): void {
  const crowd = sim.crowd;
  const keepBelow = state.squad.x <= line;

  let count = 0;
  let sumX = 0;
  let sumZ = 0;
  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0 || (crowd.group[i] ?? 0) !== 0) continue;
    const x = crowd.x[i] ?? 0;
    if (keepBelow === x <= line) continue;
    count++;
    sumX += x;
    sumZ += crowd.z[i] ?? 0;
  }
  if (count === 0) return;

  const mean = sumX / count;
  const lane = laneBeyond(mean, line, keepBelow, balance);
  // The new group's anchor is where those units already are, a little behind
  // the column's front: they are being left behind, not teleported forward.
  let group = sim.openGroup(lane, laneCenter(lane, balance.road.laneWidth), sumZ / count, releaseZ);
  if (group < 0) {
    // At the cap. The cut still has to happen — those units are behind a fence
    // whatever the bookkeeping says — so they join the group already standing
    // nearest to them, and that group goes home at the later of the two fences
    // so nobody is released into one.
    group = sim.nearestGroup(mean);
    if (group < 0) return;
    sim.releaseZ[group] = Math.max(sim.releaseZ[group] ?? 0, releaseZ);
  }

  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0 || (crowd.group[i] ?? 0) !== 0) continue;
    const x = crowd.x[i] ?? 0;
    if (keepBelow === x <= line) continue;
    sim.moveToGroup(i, group);
  }
}

/** The lane the cut-off units are led down: theirs, but never one the fence
 *  would put them back through. */
function laneBeyond(mean: number, line: number, keepBelow: boolean, balance: Balance): Lane {
  const width = balance.road.laneWidth;
  let lane = laneOf(mean, width);
  for (let guard = 0; guard < 2; guard++) {
    const centre = laneCenter(lane, width);
    if (keepBelow ? centre > line : centre < line) break;
    lane = Math.min(1, Math.max(-1, lane + (keepBelow ? 1 : -1))) as Lane;
  }
  return lane;
}
