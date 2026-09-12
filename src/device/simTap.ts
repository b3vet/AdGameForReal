/**
 * How the device layer sees sim events without anyone editing `src/core`.
 *
 * The frame loop hands each tick's events to the renderer, the HUD, the audio
 * and the physics layer, and those are all fields of `App`. Rather than add a
 * fifth consumer to files another engineer is editing this milestone, this
 * module borrows the one seam that is already public: `window.__arcane.run()`,
 * the debug handle the smoke test drives (`src/core/App.ts`). It wraps that
 * `Run` *instance's* `tick` — never the prototype, so no other run, no test and
 * no second app is touched — and forwards the events it returns.
 *
 * It only ever runs on the device (`./index` starts it behind `isNative`), and
 * it removes itself the moment the app starts calling `onSimEvents` directly,
 * which is the wiring Phase C is expected to do. So the two paths can land in
 * either order and the player still gets exactly one buzz per stomp.
 */

import type { Run, SimEvent } from '@/sim';

import { feedSimEvents, hasExternalFeed } from './haptics';

type Tick = (dt: number) => SimEvent[];

let started = false;
let frame = 0;
/** The run whose `tick` currently carries our wrapper, if any. */
let tapped: Run | null = null;

function wrap(run: Run): void {
  const inner: Tick = run.tick.bind(run);
  run.tick = (dt: number): SimEvent[] => {
    const events = inner(dt);
    feedSimEvents(events);
    return events;
  };
}

/** Deletes our own property so the class's method shows through again. */
function unwrap(run: Run): void {
  Reflect.deleteProperty(run, 'tick');
}

const poll = (): void => {
  // Something else feeds the haptics now: give the run its own method back and
  // stop the loop for good.
  if (hasExternalFeed()) {
    if (tapped !== null) unwrap(tapped);
    tapped = null;
    frame = 0;
    return;
  }

  frame = requestAnimationFrame(poll);

  // A new session builds a new `Run` (`src/core/session.ts`), so identity is
  // what says "this one is not tapped yet". One property read per frame.
  const run = globalThis.__arcane?.run() ?? null;
  if (run === null || run === tapped) return;
  wrap(run);
  tapped = run;
};

/** Starts watching for the active run. Idempotent; native only by convention. */
export function startSimTap(): void {
  if (started) return;
  started = true;
  frame = requestAnimationFrame(poll);
}

/** Stops watching and restores the tapped run. Here so a test can undo itself. */
export function stopSimTap(): void {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
  started = false;
  if (tapped !== null) unwrap(tapped);
  tapped = null;
}
