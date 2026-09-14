/**
 * Ember tier 4 (D54): every N seconds the sky drops a charged shot on whatever
 * the crowd is aiming at.
 *
 * Three things happen at once, which is what makes it read as a meteor rather
 * than as a big bullet: a blast with a falloff (`WeaponEffects.splash`, the
 * same one an ember shot uses, so a body takes meteor damage exactly the way it
 * takes splash damage), a push on the crowd through the obstacle gatherer (the
 * same field a brute standing in the column pushes with, so the column bows
 * around the crater instead of walking through it), and one `meteor` event
 * carrying the place and the radius — which is the whole of what render needs,
 * since a meteor has no shooter and no projectile to follow.
 *
 * What it is worth is read off the squad rather than fixed: see
 * `MeteorBalance.secondsOfFire`. Nothing here allocates.
 */

import type { Blast, Shove, SquadOutput } from './evolutions';
import type { EventBuffer } from './events';
import { laneOf } from './lanes';
import type { TargetList } from './targeting';
import type { RunState, WeaponId } from './types';
import { weaponOf } from './weapons';
import type { Balance, MeteorBalance } from '@/data/types';

export class Meteor {
  private readonly tuning: MeteorBalance;
  private readonly balance: Balance;
  private readonly events: EventBuffer;
  private readonly targets: TargetList;
  /** Which staffs have it. A meteor is the staff in hand firing, like a burn. */
  private readonly staffs: Record<WeaponId, boolean>;
  private readonly output: SquadOutput;
  private readonly blast: Blast;
  private readonly shove: Shove;

  /** Seconds until the next one. Starts full, so the first is not free. */
  private cooldown: number;

  constructor(
    tuning: MeteorBalance,
    balance: Balance,
    events: EventBuffer,
    targets: TargetList,
    staffs: Record<WeaponId, boolean>,
    output: SquadOutput,
    blast: Blast,
    shove: Shove,
  ) {
    this.tuning = tuning;
    this.balance = balance;
    this.events = events;
    this.targets = targets;
    this.staffs = staffs;
    this.output = output;
    this.blast = blast;
    this.shove = shove;
    this.cooldown = Math.max(0.1, tuning.intervalSeconds);
  }

  /**
   * One step of the clock. The cooldown runs whatever staff is in hand — a
   * player who swaps to storm for a row and back does not come out of it owed
   * three meteors — but only ember drops one.
   */
  update(state: RunState, dt: number): void {
    this.cooldown -= dt;
    if (this.cooldown > 0) return;
    this.cooldown = Math.max(0.1, this.tuning.intervalSeconds);
    if (!this.staffs[weaponOf(state.squad)]) return;
    this.strike(state);
  }

  /**
   * Where the crowd is aiming: the nearest thing in the lane the squad is
   * standing in, or a fixed distance up that lane when it holds nothing.
   *
   * The aim point rather than the squad's own position, because a blast
   * centred on the squad would only ever catch what had already reached it —
   * and because "it lands where you are shooting" is the one sentence that
   * explains the mechanic to a player who never reads a tooltip.
   */
  private strike(state: RunState): void {
    const squad = state.squad;
    const lane = laneOf(squad.x, this.balance.road.laneWidth);
    const target = this.targets.sweepLane(lane, squad.z, squad.z + this.balance.projectiles.range);
    // A body, not a gate: the nearest thing in the lane is often a gate panel,
    // and a meteor dropped on one would be a crater in front of an arch with
    // the river still walking through it. With nothing to aim at, the shot
    // falls a fixed distance up the lane instead.
    const body = target?.enemy ?? null;
    const x = body === null ? squad.x : target?.cx ?? squad.x;
    const z = body === null ? squad.z + this.tuning.ahead : body.z;

    const tuning = this.tuning;
    this.events.meteor(x, z, tuning.radius);
    this.shove(x, z, tuning.radius, tuning.shoveStrength, state.time + tuning.shoveSeconds);
    this.blast(state, x, z, this.output(state) * tuning.secondsOfFire, tuning.radius, tuning.falloff);
  }
}
