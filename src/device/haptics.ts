/**
 * Sim events to Taptic Engine (decision D34; `docs/12-milestone-4-plan.md`,
 * "Device build").
 *
 * Three moments buzz and nothing else: the boss's stomp, the boss's death and
 * winning the level. A shot, a kill or a gate must not — a run fires hundreds of
 * projectiles a second, and a phone that vibrates on each of them is a phone
 * with a dead battery and a numb hand.
 *
 * `onSimEvents` is the whole interface, and it is deliberately callable from
 * anywhere: on the web it returns on the first line, so `src/core` can wire it
 * unconditionally. On the device it is fed by `./simTap` until something else
 * starts calling it (see `hasExternalFeed`).
 *
 * The numbers here are not in `src/data`: they are the feel of one phone's
 * haptics, not game tuning, and nothing in the sim may read them.
 */

import type { SimEvent } from '@/sim';

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

import { isNative } from './platform';

/**
 * Shortest gap between two buzzes. A boss stomps on a cadence far slower than
 * this; the gap is here so that a fast-forwarded run (`?turbo`) or two events in
 * one tick cannot machine-gun the Taptic Engine, which on iOS silently drops
 * the extra calls anyway.
 */
const MIN_GAP_MS = 90;

/** Read once: the platform cannot change while the page is alive. */
const enabled = isNative();

let lastPulseMs = -Infinity;
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

/** The three buzzes this game has. */
type Pulse = 'stomp' | 'bossDown' | 'won';

/**
 * One event, one buzz, subject to the gap. A `won` pulse ignores the gap: it
 * happens once a run and must not be swallowed because the boss died in the
 * same tick that ended it.
 *
 * No closures and no options objects are built on the way in — this is called
 * from inside the frame loop, where nothing allocates (CLAUDE.md).
 */
function pulse(kind: Pulse): void {
  const at = nowMs();
  if (kind !== 'won' && at - lastPulseMs < MIN_GAP_MS) return;
  lastPulseMs = at;

  switch (kind) {
    case 'stomp':
      // A heavy thing landing a few metres away, not on you.
      ignore(Haptics.impact({ style: ImpactStyle.Medium }));
      break;
    case 'bossDown':
      ignore(Haptics.impact({ style: ImpactStyle.Heavy }));
      break;
    case 'won':
      ignore(Haptics.notification({ type: NotificationType.Success }));
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
      case 'bossStomp':
        pulse('stomp');
        break;

      case 'bossKilled':
        pulse('bossDown');
        break;

      case 'runEnded':
        // Only on a win: losing already costs the player the run, and a defeat
        // buzz reads as the phone blaming them.
        if (event.status === 'won') pulse('won');
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
