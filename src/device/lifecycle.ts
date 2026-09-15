/**
 * Foreground and background, from whichever shell the game is running in
 * (decision D34; `docs/25-milestone-9-plan.md`, section B).
 *
 * A phone takes the app away mid-run all the time — a call, a notification
 * pulled down, the app switcher, the screen locking — and three things have to
 * happen the instant it does:
 *
 *   1. the sim clock stops, and the seconds spent away are *dropped* rather
 *      than caught up (`src/core/frame.ts`). A clock that catches up teleports
 *      the squad through a gate row it never touched;
 *   2. the sound stops, because iOS keeps a WebAudio context alive under a
 *      lock screen and a game that sings in your pocket is a bug report;
 *   3. the save is written, because backgrounding is the last moment the app
 *      is guaranteed to get — iOS may kill it without another frame.
 *
 * What is *here* is only the signal. Which of those three happens, and in what
 * order, is `src/core/App.ts`: the device layer knows about platforms, not
 * about the game.
 *
 * Two sources for one signal, because the two shells report it differently:
 * `@capacitor/app`'s `appStateChange` on a device, `visibilitychange` in a
 * browser. Both are de-duplicated against the last state delivered, so a shell
 * that fires both (a WKWebView does) still hands the app one transition.
 */

import { App as CapacitorApp } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';

import { isNative } from './platform';

export type AppVisibility = 'foreground' | 'background';

export type VisibilityListener = (visibility: AppVisibility) => void;

let listener: VisibilityListener | null = null;
let current: AppVisibility = 'foreground';
/** The native subscription, kept only so `stopWatchingAppVisibility` can undo it. */
let pluginHandle: PluginListenerHandle | null = null;
/** Takes the `visibilitychange` listener off in one call, as `Overlay` does. */
let webListeners: AbortController | null = null;

/**
 * Hands one transition to the app. The guard is the whole point: iOS delivers
 * `appStateChange` and `visibilitychange` for the same lock, and pausing an
 * already-paused clock twice would be harmless but resuming one twice would
 * mean two frame loops.
 */
function deliver(next: AppVisibility): void {
  if (next === current) return;
  current = next;
  listener?.(next);
}

/**
 * Starts watching. Idempotent: a second call replaces the listener rather than
 * subscribing twice, so a re-created `App` cannot leave the old one wired.
 */
export function watchAppVisibility(onChange: VisibilityListener): void {
  listener = onChange;
  // Whatever the shell thinks now, the app is on screen: `start` is called from
  // a frame the player is looking at.
  current = 'foreground';
  if (webListeners !== null || pluginHandle !== null) return;

  if (isNative()) {
    // A promise across the native bridge. A plugin that fails to attach leaves
    // the web listener below unattached too, which is a game that keeps running
    // in the background — annoying, never broken — so it is logged and dropped
    // rather than thrown into a boot.
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      deliver(isActive ? 'foreground' : 'background');
    })
      .then((handle) => {
        pluginHandle = handle;
      })
      .catch((error: unknown) => {
        console.warn('[arcane-rush] device lifecycle: appStateChange failed', error);
      });
    return;
  }

  const listeners = new AbortController();
  webListeners = listeners;
  document.addEventListener(
    'visibilitychange',
    () => {
      deliver(document.visibilityState === 'visible' ? 'foreground' : 'background');
    },
    { signal: listeners.signal },
  );
}

/** Stops watching and forgets the listener. `App.dispose` calls it. */
export function stopWatchingAppVisibility(): void {
  listener = null;
  current = 'foreground';
  webListeners?.abort();
  webListeners = null;
  const handle = pluginHandle;
  pluginHandle = null;
  if (handle !== null) void handle.remove().catch(() => undefined);
}

/** Where the app currently is. The debug report prints it. */
export function appVisibility(): AppVisibility {
  return current;
}
