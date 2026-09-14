/**
 * Frost tier 4 (D54): once every M seconds, a wall of ice across the lane the
 * column is standing in, holding that lane's river where it stands.
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

import type { EventBuffer } from './events';
import { laneOf } from './lanes';
import type { RunState, WeaponId } from './types';
import { weaponOf } from './weapons';
import type { Balance, GlacierBalance } from '@/data/types';

export class Glacier {
  private readonly tuning: GlacierBalance;
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly staffs: Record<WeaponId, boolean>;

  /** Seconds until another wall may go up. Starts full, like the meteor's. */
  private cooldown: number;

  constructor(
    tuning: GlacierBalance,
    balance: Balance,
    events: EventBuffer,
    staffs: Record<WeaponId, boolean>,
  ) {
    this.tuning = tuning;
    this.balance = balance;
    this.events = events;
    this.staffs = staffs;
    this.cooldown = Math.max(0.1, tuning.intervalSeconds);
  }

  update(state: RunState, dt: number): void {
    // The wall melts on its own clock, whoever is holding what: a run that ends
    // the step after one goes up must not leave a wall standing in the state.
    if (state.ice != null && state.time >= state.ice.until) state.ice = null;

    this.cooldown -= dt;
    if (this.cooldown > 0 || state.ice != null) return;
    if (!this.staffs[weaponOf(state.squad)]) return;

    const lane = laneOf(state.squad.x, this.balance.road.laneWidth);
    const z = state.squad.z + this.tuning.ahead;
    if (this.bodiesAhead(state, lane, z) < this.tuning.minBodies) return;

    this.cooldown = Math.max(0.1, this.tuning.intervalSeconds);
    const until = state.time + this.tuning.holdSeconds;
    state.ice = { lane, z, until };
    this.events.glacier(lane, z, until);
  }

  /**
   * Live bodies in `lane` between the wall's line and the far end of the
   * squad's reach: what the wall would actually hold. Counted rather than
   * sampled, because a wall that went up for one straggler would spend a
   * fourteen-second cooldown on nothing.
   */
  private bodiesAhead(state: RunState, lane: number, z: number): number {
    const width = this.balance.road.laneWidth;
    const far = state.squad.z + this.balance.projectiles.range;
    let count = 0;
    for (const enemy of state.enemies) {
      if (!enemy.alive || enemy.z < z || enemy.z > far) continue;
      if (laneOf(enemy.x, width) !== lane) continue;
      count++;
    }
    return count;
  }
}
