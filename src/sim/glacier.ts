/**
 * Frost tier 4 (D54): once every M seconds, a wall of ice across the lane the
 * column is standing in, holding that lane's river where it stands — and
 * taking it apart while it holds it (`GlacierBalance.bite`).
 *
 * The wall is written onto `RunState.ice` and enforced in `contact.ts`, which
 * is the one place a body's `z` moves: a body in the walled lane may walk up to
 * the ice and no further until it lets go. Doing it that way rather than by
 * freezing the bodies that happen to be there is what makes it a *wall* — a
 * body that spawns during the hold walks into it too, and the river stacks up
 * against it instead of leaking around the edge of a spell that has already
 * been cast.
 *
 * It goes up only when there is a river to hold (`minBodies` in the lane), so
 * the cooldown is spent on the rows that need it rather than on empty road.
 */

import type { HitFn } from './burn';
import type { SquadOutput } from './evolutions';
import type { EventBuffer } from './events';
import { laneOf } from './lanes';
import type { TargetList } from './targeting';
import type { Lane, RunState, WeaponId } from './types';
import { weaponOf } from './weapons';
import type { Balance, GlacierBalance } from '@/data/types';

/** Metres either side of the line a body counts as *against* the wall. */
const GRIP = 0.6;

export class Glacier {
  private readonly tuning: GlacierBalance;
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly staffs: Record<WeaponId, boolean>;
  private readonly targets: TargetList;
  private readonly output: SquadOutput;
  private readonly hit: HitFn;

  /** Seconds until another wall may go up. Starts full, like the meteor's. */
  private cooldown: number;

  /** Bodies against the wall this step, counted before any of them is hurt. */
  private held = 0;

  /** Bodies per lane, for the wall's placement. Re-used, never re-allocated. */
  private readonly lanes: [number, number, number] = [0, 0, 0];

  constructor(
    tuning: GlacierBalance,
    balance: Balance,
    events: EventBuffer,
    staffs: Record<WeaponId, boolean>,
    targets: TargetList,
    output: SquadOutput,
    hit: HitFn,
  ) {
    this.tuning = tuning;
    this.balance = balance;
    this.events = events;
    this.staffs = staffs;
    this.targets = targets;
    this.output = output;
    this.hit = hit;
    this.cooldown = Math.max(0.1, tuning.intervalSeconds);
  }

  update(state: RunState, dt: number): void {
    // The wall melts on its own clock, whoever is holding what: a run that ends
    // the step after one goes up must not leave a wall standing in the state.
    if (state.ice != null && state.time >= state.ice.until) state.ice = null;
    this.grind(state, dt);
    if (state.status !== 'running') return;

    this.cooldown -= dt;
    if (this.cooldown > 0 || state.ice != null) return;
    if (!this.staffs[weaponOf(state.squad)]) return;

    const z = state.squad.z + this.tuning.ahead;
    const lane = this.fullestLane(state, z);
    if (lane === null) return;

    this.cooldown = Math.max(0.1, this.tuning.intervalSeconds);
    const until = state.time + this.tuning.holdSeconds;
    state.ice = { lane, z, until };
    this.events.glacier(lane, z, until);
  }

  /**
   * What the ice takes out of the river it is holding, this step.
   *
   * Counted first and hurt second, for the reason the overcharge splits its arc
   * the same way: a wall that paid every body against it the full rate would be
   * worth ten times as much on the row where ten bodies pile up, which is
   * exactly the row a run is decided on. The whole wall is worth `bite` seconds
   * of the squad's own fire a second, however many bodies are leaning on it.
   *
   * The window is narrow because a held body sits *on* the line: `contact.ts`
   * clamps whatever crossed to `ice.z` exactly, and everything still walking
   * up to it is the squad's own business.
   */
  private grind(state: RunState, dt: number): void {
    const ice = state.ice;
    if (ice == null || this.tuning.bite <= 0) return;
    const width = this.balance.road.laneWidth;
    const reach = GRIP + this.balance.enemies.footprintMax;

    this.held = 0;
    this.targets.forEachNear(ice.z, reach, (enemy) => {
      if (Math.abs(enemy.z - ice.z) > GRIP || laneOf(enemy.x, width) !== ice.lane) return true;
      this.held++;
      return true;
    });
    if (this.held === 0) return;

    const each = (this.output(state) * this.tuning.bite * dt) / this.held;
    this.targets.forEachNear(ice.z, reach, (enemy) => {
      if (Math.abs(enemy.z - ice.z) > GRIP || laneOf(enemy.x, width) !== ice.lane) return true;
      this.hit(state, enemy, each);
      return state.status === 'running';
    });
  }

  /**
   * The lane with the most bodies between the wall's line and the far end of
   * the squad's reach, or null when none of the three has `minBodies` in it.
   *
   * The fullest lane rather than the squad's own, which is the Milestone 8
   * correction and the whole of why the wall was worth nothing. A thumb is
   * *steering away* from the river — that is what the mechanic is for — so the
   * lane the column is standing in is the empty one by construction, and a
   * wall that went up there held two bodies a run. A crowd four hundred strong
   * is wider than its own lane and takes contact from all three (`contact.ts`),
   * so the river worth freezing is the one the player is dodging: "one lane's
   * river", as the Workbench puts it, rather than "the lane you are in".
   *
   * Counted rather than sampled, because a wall that went up for one straggler
   * would spend its whole cooldown on nothing.
   */
  private fullestLane(state: RunState, z: number): Lane | null {
    const width = this.balance.road.laneWidth;
    const far = state.squad.z + this.balance.projectiles.range;
    this.lanes[0] = 0;
    this.lanes[1] = 0;
    this.lanes[2] = 0;
    for (const enemy of state.enemies) {
      if (!enemy.alive || enemy.z < z || enemy.z > far) continue;
      const slot = laneOf(enemy.x, width) + 1;
      if (slot < 0 || slot > 2) continue;
      this.lanes[slot] = (this.lanes[slot] ?? 0) + 1;
    }

    let best = -1;
    let most = this.tuning.minBodies - 1;
    for (let slot = 0; slot < 3; slot++) {
      const count = this.lanes[slot] ?? 0;
      if (count > most) {
        most = count;
        best = slot;
      }
    }
    // -1, 0 or 1: the slot back as a lane. `as` rather than a lookup because
    // the loop above only ever leaves `best` in 0..2 (CLAUDE.md's no-cast rule
    // is about data crossing a boundary; this is arithmetic three lines up).
    return best < 0 ? null : ((best - 1) as Lane);
  }
}
