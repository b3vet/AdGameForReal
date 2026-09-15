/**
 * One sim event as one short line of the debug panel's log.
 *
 * Split out of `./debug.ts` in Milestone 9 for the file-size rule (CLAUDE.md),
 * on a seam that file already had: everything here is a `switch` over the sim's
 * event union and nothing here knows the panel exists. It grows with the sim,
 * which is exactly why it should not grow inside the panel.
 *
 * Nothing in here runs while the panel is hidden — building an event's string
 * is a per-event allocation the game does not otherwise make.
 */

import type { GateKind, SimEvent } from '@/sim';

export function describeEvent(event: SimEvent): string {
  switch (event.type) {
    case 'projectileFired':
      return 'fire';
    case 'projectileHit':
      return `impact ${event.weaponId}`;
    case 'gateHit':
      return `gateHit ${event.kind} ${gateValue(event.kind, event.value)}`;
    case 'gatePassed':
      return (
        `gate ${event.kind} ${gateValue(event.kind, event.value)} ` +
        `${String(event.countBefore)}>${String(event.countAfter)}`
      );
    case 'enemyActivated':
      return `activate #${String(event.enemyId)}`;
    case 'enemyHit':
      return `hit #${String(event.enemyId)} hp ${event.hp.toFixed(0)}`;
    case 'enemyKilled':
      return `kill #${String(event.enemyId)} ${event.kind}`;
    case 'enemyLeaked':
      return `leak #${String(event.enemyId)} str ${String(event.streamId)}`;
    case 'streamStarted':
      return `stream ${String(event.streamId)} lane ${String(event.lane)} x${String(event.count)}`;
    case 'streamCleared':
      return `stream ${String(event.streamId)} done leak ${String(event.leaked)}`;
    case 'enemyShattered':
      return `shatter #${String(event.enemyId)}`;
    case 'enemySlowed':
      return `slow #${String(event.enemyId)} ${event.seconds.toFixed(1)}s`;
    case 'enemyBurning':
      return `burn #${String(event.enemyId)} ${event.seconds.toFixed(1)}s`;
    case 'familiarShot':
      return `wisp >#${String(event.targetId)}`;
    case 'wallBlocked':
      return `wall ${event.boundary > 0 ? 'right' : 'left'}`;
    case 'splash':
      return `splash r${event.radius.toFixed(1)}`;
    case 'chain':
      return `chain #${String(event.from)}>#${String(event.to)}`;
    case 'weaponChanged':
      return `staff ${event.from}>${event.to}`;
    case 'unitsGained':
      return `+${event.amount.toFixed(0)} units`;
    case 'unitsLost':
      return `-${event.amount.toFixed(1)} units (${event.reason})`;
    case 'bossActivated':
      return 'boss active';
    case 'bossStomp':
      return 'boss stomp';
    case 'bossEnraged':
      return `boss enraged #${String(event.enemyId)}`;
    case 'bossKilled':
      return 'boss killed';
    case 'runEnded':
      return `runEnded ${event.status} surv ${String(event.survivors)}`;
    default:
      // An event the sim added and the panel has not been taught yet. Printing
      // its name is more use than the `undefined` an exhaustive switch would
      // leave in the log.
      return (event as { type: string }).type;
  }
}

/**
 * Gate values are floats now, so the raw number is fifteen digits of noise in a
 * panel eight lines tall. Rounded the way the gate's own panel rounds it, and
 * `fireRate` in the percent the player reads rather than in hundredths.
 */
function gateValue(kind: GateKind, value: number): string {
  const scaled = kind === 'fireRate' ? value * 100 : value;
  const rounded = Math.round(scaled);
  // `Math.round` hands back `-0`, which prints as "-0" once a sign is glued on.
  return String(rounded === 0 ? 0 : rounded);
}
