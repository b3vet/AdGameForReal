/**
 * What a scripted player does about a charger (D49).
 *
 * The kind is a question with two answers and the bot has to pick the same one
 * a player would. A charger commits to a lane when it sets off, a second and a
 * half out; the squad's whole output goes down the lane it is standing in
 * (D42); so the choice is *shoot it* — stay where you are, because it is
 * coming to you and you can take it apart before it arrives — or *leave the
 * lane*, because you cannot.
 *
 * That is exactly the shape of the cost function below: a charger whose
 * arrival lane the crowd is not standing in costs nothing, a charger it can
 * kill in the time it has costs nothing, and anything else costs the bite it
 * takes. The bot then stands wherever that sum is smallest.
 *
 * Split out of `./botStand.ts`, which is at the file-size rule (CLAUDE.md) and
 * whose other two questions — cover the river, step out of a block — are about
 * things that do not aim at you.
 *
 * Allocation-free like the rest of the bot code: a bot is asked for a target
 * every step.
 */

import { chargerKills } from './chargers';
import { overlapShare } from './contact';
import { enemyFootprint } from './enemies';
import { halfWidth } from './formation';
import { laneCenter } from './lanes';
import { stand } from './botStand';
import type { RunState } from './types';
import { clampToWalls } from './walls';
import type { WallLimits } from './walls';
import { weaponDef, weaponOf } from './weapons';
import type { Balance } from '@/data/types';

/** The same five places `botStand.ts` considers: lane centres and the gaps. */
const STAND_COUNT = 5;

/**
 * What the squad puts out per second, before anything about aim or what else
 * is on the road. `Firing.rateOf` times the damage a shot carries.
 */
function squadDps(state: RunState, balance: Balance): number {
  const squad = state.squad;
  const weapon = weaponDef(weaponOf(squad));
  return (
    squad.count *
    squad.fireRate *
    (1 + squad.fireRateBonus) *
    weapon.fireRateMul *
    squad.damage *
    balance.bots.chargerAimShare
  );
}

/**
 * Soldiers standing at `x` would lose to the chargers already running.
 *
 * Only chargers that have *set off* count: until then they have not picked a
 * lane, and which lane they will pick depends on where the squad is standing
 * when they do — so a bot that planned against a body still waiting would be
 * planning against its own future position.
 */
export function chargerCost(state: RunState, x: number, balance: Balance): number {
  const squad = state.squad;
  const squadHalf = halfWidth(squad.count, squad.formationWidth, balance);
  const config = balance.enemies.charger;
  const closing = Math.max(0.1, config.speed + balance.squad.runSpeed);
  const reach = balance.bots.chargerLookahead;
  const minShare = balance.enemies.contactMinShare;
  const dps = squadDps(state, balance);
  let cost = 0;

  for (const enemy of state.enemies) {
    if (!enemy.alive || !enemy.active || enemy.kind !== 'charger') continue;
    const gap = enemy.z - squad.z;
    if (gap < 0 || gap > reach) continue;

    const lane = enemy.charge?.lane;
    const arrival = lane === undefined ? enemy.x : laneCenter(lane, balance.road.laneWidth);
    const half = enemyFootprint(enemy.kind, enemy.units, balance);
    // It is coming down a lane the crowd would not be standing in: nothing to
    // answer, and nothing the squad's fire could reach either.
    if (overlapShare(arrival, half, x, squadHalf, minShare) <= 0) continue;
    // It is coming at us, so the squad's fire is on it: can we finish it in
    // the seconds it has left?
    if (dps * (gap / closing) >= enemy.hp) continue;
    cost += chargerKills(squad.count, balance);
  }
  return cost;
}

/**
 * Where to stand with a charger already running, or `false` when there is
 * nothing a charger would make the squad do.
 *
 * False both when no charger threatens the spot the squad is already on and
 * when no reachable spot is any cheaper: the bot only takes the wheel off its
 * gate and river logic when moving actually saves somebody.
 */
export function bestChargerStand(state: RunState, range: WallLimits, balance: Balance): boolean {
  const squad = state.squad;
  const here = clampToWalls(squad.x, range);
  const cost = chargerCost(state, here, balance);
  if (cost <= 0) return false;

  const laneWidth = balance.road.laneWidth;
  stand.x = here;
  stand.bodies = 0;
  let best = cost;
  let bestDistance = 0;
  for (let i = 0; i < STAND_COUNT; i++) {
    const x = clampToWalls(((i - 2) * laneWidth) / 2, range);
    const at = chargerCost(state, x, balance);
    const distance = Math.abs(x - squad.x);
    // Ties keep the squad where it is, as everywhere else in the bot code: a
    // swerve that saves nothing gives the next row's lane up for nothing.
    if (at < best || (at === best && distance < bestDistance)) {
      best = at;
      stand.x = x;
      bestDistance = distance;
    }
  }
  return best < cost;
}
