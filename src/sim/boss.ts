/**
 * The boss fight, kept apart from `Run` because it is the only actor with its
 * own clocks: a stomp timer and a fractional contact-damage carry.
 *
 * `update` never emits events itself. It reports what happened in a re-used
 * result object and lets `Run` turn that into events, so event ordering stays
 * in one place.
 */

import type { EnemyState, SquadState } from './types';
import type { Balance } from '@/data/types';

/** Slack for the stand-off distance, which lands on `contactDistance` exactly. */
const CONTACT_EPSILON = 1e-6;

export interface BossStep {
  activated: boolean;
  stomped: boolean;
  contactKills: number;
}

export class BossController {
  private stompTimer = 0;
  private contactCarry = 0;

  /** Re-used every step: the sim must not allocate in hot loops (CLAUDE.md). */
  private readonly result: BossStep = { activated: false, stomped: false, contactKills: 0 };

  update(
    boss: EnemyState,
    squad: SquadState,
    arenaZ: number,
    balance: Balance,
    dt: number,
  ): BossStep {
    const out = this.result;
    out.activated = false;
    out.stomped = false;
    out.contactKills = 0;
    if (!boss.alive) return out;

    const config = balance.enemies.boss;

    if (!boss.active) {
      // The boss waits in its arena until the squad stops running.
      if (squad.z < arenaZ) return out;
      boss.active = true;
      out.activated = true;
    }

    // It lines itself up with the squad, slowly, and never leaves the road.
    const dx = squad.x - boss.x;
    const maxLateral = config.lateralSpeed * dt;
    boss.x += Math.abs(dx) <= maxLateral ? dx : Math.sign(dx) * maxLateral;
    const edge = Math.max(0, balance.road.halfWidth - config.footprint);
    boss.x = Math.min(edge, Math.max(-edge, boss.x));

    // It closes to contact, stops there, and grinds the squad down.
    const contact = balance.enemies.contactDistance;
    boss.z = Math.max(squad.z + contact, boss.z - boss.speed * dt);
    if (boss.z - squad.z <= contact + CONTACT_EPSILON) {
      this.contactCarry += config.contactKillsPerSecond * dt;
      const kills = Math.floor(this.contactCarry);
      if (kills > 0) {
        this.contactCarry -= kills;
        out.contactKills = kills;
      }
    }

    if (boss.z - squad.z <= config.stompRange) {
      this.stompTimer += dt;
      if (this.stompTimer >= config.stompInterval) {
        this.stompTimer -= config.stompInterval;
        out.stomped = true;
      }
    }

    return out;
  }
}
