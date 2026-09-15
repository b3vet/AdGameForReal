/**
 * Sim events to Taptic Engine (decision D34; `docs/12-milestone-4-plan.md`,
 * "Device build"; extended by `docs/25-milestone-9-plan.md`, section B).
 *
 * The rule has not changed since Milestone 4: a buzz marks a *moment*, never a
 * mechanic. A run fires hundreds of projectiles a second and kills dozens of
 * bodies, and a phone that vibrates on each of them is a phone with a dead
 * battery and a numb hand. So nothing here fires on a shot, a hit, an ordinary
 * kill, or on any of the evolution effects that go off several times a second
 * once a staff is upgraded — `overcharge`, `freezePulse` and `glacier` are
 * deliberately absent for exactly that reason (D54).
 *
 * What is left is nine things that happen once, or once in a while:
 *
 *   light    a gate row passed — the one thing the player *chose* this second
 *   medium   a shielded brute's shield going (D49), a charger setting off,
 *            the boss's stomp landing
 *   heavy    a meteor crater (D54), the Rime Fiend starting a charge (D49),
 *            the boss dying
 *   success  the level won, and the meta layer paying out at the sheet — a
 *            mission finished or a bestiary tier crossed (D51, D53)
 *   warning  the wipe
 *
 * `onSimEvents` is the whole interface for the first three, and it is
 * deliberately callable from anywhere: on the web it returns on the first line,
 * so `src/core` can wire it unconditionally. On the device it is fed by
 * `./simTap` until something else starts calling it (see `hasExternalFeed`).
 * The two notifications the sim cannot describe — what a finished run *paid* —
 * come in through `onRunAwards`, which `src/core/appRun.ts` calls with two
 * counts rather than a payout, so the device layer still knows nothing about
 * the meta layer's shapes.
 *
 * The numbers here are not in `src/data`: they are the feel of one phone's
 * haptics, not game tuning, and nothing in the sim may read them.
 */

import type { SimEvent } from '@/sim';

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

import { isNative } from './platform';

/**
 * Shortest gap between two impacts, over the whole game rather than per kind.
 *
 * Milestone 4 had 90 ms for three rare events. Milestone 9 adds a gate pass and
 * a charger, which arrive in clusters — a gate row is several gates wide and a
 * Frostfell wave sets off two chargers within a stride — so the floor is raised
 * to the 120 ms the plan asks for. iOS silently drops the extra calls anyway;
 * what the gap buys is that a fast-forwarded run (`?turbo`, sixty sim seconds a
 * second) cannot machine-gun the engine.
 *
 * Notifications are exempt: each of the three is once a run at most, and a
 * success swallowed because the boss died in the same tick that ended the level
 * is the one buzz the player was waiting for.
 */
const MIN_IMPACT_GAP_MS = 120;

/** Read once: the platform cannot change while the page is alive. */
const enabled = isNative();

let lastImpactMs = -Infinity;
let externalFeed = false;

/** Wall clock, never the sim's; `performance` is absent in a bare Node import. */
function nowMs(): number {
  return typeof performance === 'undefined' ? 0 : performance.now();
}

/**
 * A plugin call is a promise across the native bridge. Nothing waits for it and
 * a device that cannot buzz (older hardware, haptics switched off in Settings)
 * rejects it, so the rejection is swallowed rather than left unhandled.
 */
function ignore(result: Promise<void>): void {
  void result.catch(() => {
    /* a phone that will not buzz is not an error worth a console line */
  });
}

/** The taps, from lightest to heaviest. Throttled as a group. */
type Impact = 'gate' | 'shield' | 'charger' | 'stomp' | 'meteor' | 'bossCharge' | 'bossDown';

/** The three end-of-run verdicts. Not throttled; see `MIN_IMPACT_GAP_MS`. */
type Notice = 'won' | 'reward' | 'wipe';

/**
 * One event, one tap, subject to the gap.
 *
 * No closures and no options objects are built on the way in — this is called
 * from inside the frame loop, where nothing allocates (CLAUDE.md).
 */
function impact(kind: Impact): void {
  const at = nowMs();
  if (at - lastImpactMs < MIN_IMPACT_GAP_MS) return;
  lastImpactMs = at;

  switch (kind) {
    case 'gate':
      // The lightest thing the engine can do: a row passed under you, not a hit.
      ignore(Haptics.impact({ style: ImpactStyle.Light }));
      break;
    case 'shield':
    case 'charger':
    case 'stomp':
      // Something breaking, or a heavy thing landing a few metres away.
      ignore(Haptics.impact({ style: ImpactStyle.Medium }));
      break;
    case 'meteor':
    case 'bossCharge':
    case 'bossDown':
      ignore(Haptics.impact({ style: ImpactStyle.Heavy }));
      break;
  }
}

/**
 * The end of a run, or the reward for it. Ignores the gap on purpose, and still
 * stamps the clock, so an impact arriving just behind one of these waits.
 */
function notice(kind: Notice): void {
  lastImpactMs = nowMs();
  switch (kind) {
    case 'won':
    case 'reward':
      ignore(Haptics.notification({ type: NotificationType.Success }));
      break;
    case 'wipe':
      ignore(Haptics.notification({ type: NotificationType.Warning }));
      break;
  }
}

/** The mapping. Split out so `./simTap` can feed it without setting `externalFeed`. */
export function feedSimEvents(events: readonly SimEvent[]): void {
  if (!enabled) return;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event === undefined) continue;

    switch (event.type) {
      case 'gatePassed':
        impact('gate');
        break;

      case 'shieldBreak':
        impact('shield');
        break;

      case 'charge':
        // One event, two creatures (D49): the Rime Fiend winding up to cross
        // the arena is the biggest thing that happens in a boss fight, and a
        // charger in the crowd is a shove.
        impact(event.kind === 'boss' ? 'bossCharge' : 'charger');
        break;

      case 'meteor':
        impact('meteor');
        break;

      case 'bossStomp':
        impact('stomp');
        break;

      case 'bossKilled':
        impact('bossDown');
        break;

      case 'runEnded':
        // A win is a fanfare and a wipe is a warning. Milestone 4 left a loss
        // silent because a defeat buzz reads as the phone blaming the player;
        // the plan asks for it, and `Warning` is the one notification that says
        // "that went wrong" rather than "you did wrong".
        notice(event.status === 'won' ? 'won' : 'wipe');
        break;

      default:
        break;
    }
  }
}

/**
 * The public hook: hand it every `tick`'s events.
 *
 * Safe on the web (returns immediately), safe to call every frame, and safe to
 * call with the pooled array the sim returns — nothing here keeps a reference
 * past the call.
 */
export function onSimEvents(events: readonly SimEvent[]): void {
  externalFeed = true;
  feedSimEvents(events);
}

/**
 * What the finished run paid, as two counts: missions completed and bestiary
 * tiers crossed (`RunPayout` in `src/core/academy.ts`). One success buzz if
 * either happened, on the frame the result sheet goes up.
 *
 * Counts rather than the payout itself, so `src/device` never imports a type
 * from `src/core` — the dependency runs one way, and this file would otherwise
 * be the only thing pointing back. It deliberately does *not* set
 * `externalFeed`: that flag means "the app feeds me sim events now", and this
 * is not a sim event.
 */
export function onRunAwards(missionsCompleted: number, tiersUnlocked: number): void {
  if (!enabled) return;
  if (missionsCompleted <= 0 && tiersUnlocked <= 0) return;
  notice('reward');
}

/**
 * True once something outside `src/device` has called `onSimEvents`. `./simTap`
 * watches this and takes its own hook back out, so wiring the call into the app
 * later cannot end up buzzing twice per stomp.
 */
export function hasExternalFeed(): boolean {
  return externalFeed;
}

/** True when a buzz would actually reach hardware; the debug panel may want it. */
export function hapticsActive(): boolean {
  return enabled;
}
