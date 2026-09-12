/**
 * The Milestone 4 half of the render fixture: the wisp, and the fences.
 *
 * Split out of `dev-scenario.ts` for the reason every other half was — that
 * file owns the story (where the squad is, which row it crossed, when the boss
 * wakes up) and this owns two features that have their own clocks.
 *
 * Both are fixtures, not a second sim. The wisp fires on a timer at whatever is
 * nearest and cycles its tier so all three ring counts are reviewable inside
 * one screenshot pass; the walls re-use the sim's *own* clamp (`wallLimits`,
 * `clampToWalls`) against the scripted sine the fixture steers with, so the
 * `wallBlocked` beat the renderer flashes on is the one the sim would emit.
 */

import { clampToWalls, wallLimits } from '@/sim';
import type { FamiliarTier, RunState, SimEvent, WallDef, WallLimits } from '@/sim';
import { balance } from '@/data';
import { progression } from '@/sim';

/** Seconds at each wisp tier before it steps to the next, and wraps. */
const TIER_SECONDS = 6;
/** The fixture fires faster than tier 3 does, so a pass always shows sparks. */
const DEV_WISP_RATE = 2.4;
/** How far it looks for something to shoot. The sim's own range. */
const DEV_WISP_RANGE = progression.wisp.range;

export class DevExtras {
  private readonly limits: WallLimits = { lo: 0, hi: 0, wall: -1 };
  private cooldown = 0;
  private tierTimer = 0;
  /** Which wall the squad was last pushed by, so the beat fires on the edge. */
  private blockedWall = -1;

  constructor(
    private readonly state: RunState,
    private readonly events: SimEvent[],
    private readonly walls: readonly WallDef[],
  ) {}

  /** New pass: the wisp is back at tier 1 and no fence is pushing anything. */
  reset(): void {
    this.cooldown = 0;
    this.tierTimer = 0;
    this.blockedWall = -1;
    this.state.familiar = {
      x: this.state.squad.x + progression.wisp.offsetX,
      z: this.state.squad.z + progression.wisp.offsetZ,
      tier: 1,
      cooldown: 0,
      side: 1,
    };
    this.state.walls = this.walls;
  }

  /** Called after the squad has been moved, before the blocks are. */
  step(dt: number): void {
    this.clampToFences();
    this.moveWisp(dt);
  }

  /**
   * The sim's clamp, applied to the fixture's scripted lateral sine.
   *
   * `Run.step` does exactly this and emits `wallBlocked` only when the wall it
   * is being pushed by changes, so a finger held against a fence is one beat
   * and not a buzz; the fixture copies the rule rather than approximating it.
   */
  private clampToFences(): void {
    if (this.walls.length === 0) return;
    const squad = this.state.squad;
    const limits = wallLimits(
      this.walls,
      squad.z,
      squad.x,
      balance.road.clampX,
      this.limits,
      balance.road.laneWidth,
    );
    const wanted = squad.x;
    squad.x = clampToWalls(wanted, limits);
    squad.targetX = squad.x;

    const pushed = wanted !== squad.x && limits.wall >= 0;
    if (!pushed) {
      this.blockedWall = -1;
      return;
    }
    if (this.blockedWall === limits.wall) return;
    this.blockedWall = limits.wall;
    const wall = this.walls[limits.wall];
    if (wall === undefined) return;
    this.events.push({
      type: 'wallBlocked',
      boundary: wall.boundary,
      x: (wall.boundary * balance.road.laneWidth) / 2,
      z: squad.z,
    });
  }

  /** Hovers beside the squad, steps its tier, and throws a spark on its timer. */
  private moveWisp(dt: number): void {
    const wisp = this.state.familiar;
    if (wisp === null || wisp === undefined) return;
    const squad = this.state.squad;

    this.tierTimer += dt;
    if (this.tierTimer >= TIER_SECONDS) {
      this.tierTimer = 0;
      wisp.tier = ((wisp.tier % 3) + 1) as FamiliarTier;
    }

    wisp.side = squad.x + progression.wisp.offsetX > balance.road.halfWidth ? -1 : 1;
    wisp.x = squad.x + progression.wisp.offsetX * wisp.side;
    wisp.z = squad.z + progression.wisp.offsetZ;

    this.cooldown -= dt;
    if (this.cooldown > 0) return;

    const target = this.nearest(wisp.x, wisp.z);
    if (target < 0) return;
    this.cooldown = 1 / DEV_WISP_RATE;
    wisp.cooldown = this.cooldown;
    this.events.push({ type: 'familiarShot', x: wisp.x, z: wisp.z, targetId: target });
  }

  /** Id of the nearest live body in range, or -1. The boss counts. */
  private nearest(x: number, z: number): number {
    let best = -1;
    let bestGap = DEV_WISP_RANGE;
    for (const enemy of this.state.enemies) {
      if (!enemy.alive) continue;
      const gap = Math.hypot(enemy.x - x, enemy.z - z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = enemy.id;
    }
    const boss = this.state.boss;
    if (boss !== null && boss.alive && boss.active) {
      const gap = Math.hypot(boss.x - x, boss.z - z);
      if (gap < bestGap) best = boss.id;
    }
    return best;
  }
}
