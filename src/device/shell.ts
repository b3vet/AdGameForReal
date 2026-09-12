/**
 * The native shell around the web build (decision D34): full screen, no status
 * bar, no launch flash, no screen dimming mid-run.
 *
 * All of it is iOS-facing but none of it is iOS-only: the same three calls are
 * what Android will want when that platform is added. Everything is guarded by
 * `isNative`, so calling `initShell` in a browser does nothing at all.
 */

import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar } from '@capacitor/status-bar';

import { isNative } from './platform';

/** Matches `SPLASH_FADE_MS` in `capacitor.config.ts`. */
const SPLASH_FADE_MS = 250;

/**
 * How long the splash may stay up waiting for the game's first frame. A boot
 * that fails — a Havok fetch that never lands, a shader that wedges the driver
 * — must not leave the product owner staring at a purple rectangle with no way
 * to see the error, so the splash comes down regardless after this.
 */
const SPLASH_TIMEOUT_MS = 8000;

let started = false;

/**
 * A plugin call is a promise across the native bridge; none of these three is
 * worth failing a boot over, so a rejection is logged once and dropped.
 */
function ignore(what: string, result: Promise<unknown>): void {
  void result.catch((error: unknown) => {
    console.warn(`[arcane-rush] device shell: ${what} failed`, error);
  });
}

/**
 * Runs `then` on the first frame after the app says it is ready
 * (`window.__arcane.ready`, published by `src/core/App.ts` once the renderer has
 * booted and the title screen has been drawn), or after `SPLASH_TIMEOUT_MS`.
 *
 * One `requestAnimationFrame` past `ready` rather than `ready` itself: the flag
 * is set inside `start()`, and the frame that paints the title is the next one.
 */
function afterFirstFrame(then: () => void): void {
  const deadline = performance.now() + SPLASH_TIMEOUT_MS;

  const wait = (): void => {
    if (globalThis.__arcane?.ready === true) {
      requestAnimationFrame(then);
      return;
    }
    if (performance.now() >= deadline) {
      then();
      return;
    }
    requestAnimationFrame(wait);
  };

  requestAnimationFrame(wait);
}

/**
 * Keeps the screen lit during a run.
 *
 * Capacitor 8 ships no keep-awake plugin in core — the only one is the
 * community `@capacitor-community/keep-awake`, which we deliberately have not
 * added — so this is the web API, which WKWebView has supported since iOS 16.4.
 * The lock is dropped by the system whenever the page is hidden (a call, the app
 * switcher), so it is taken again on every return to the foreground.
 *
 * On an older iOS this silently does nothing and the phone dims on its own
 * idle timer, which is a cosmetic loss, not a broken build.
 */
function keepScreenAwake(): void {
  const wakeLock: WakeLock | undefined = navigator.wakeLock;
  if (wakeLock === undefined) return;

  let sentinel: WakeLockSentinel | null = null;

  const acquire = (): void => {
    if (sentinel !== null && !sentinel.released) return;
    try {
      void wakeLock
        .request('screen')
        .then((held) => {
          sentinel = held;
        })
        .catch(() => {
          // Denied (low battery, or the user's setting). Nothing to do.
        });
    } catch {
      // Some WebViews throw synchronously rather than rejecting — from a
      // `visibilitychange` handler that would be an uncaught error on every
      // return to the foreground, for a lock that is only ever polish.
    }
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquire();
  });
  acquire();
}

/**
 * Hides the status bar, holds the launch splash until the game has drawn, and
 * asks for a wake lock. Idempotent, and a no-op outside the Capacitor app.
 */
export function initShell(): void {
  if (started || !isNative()) return;
  started = true;

  // The status bar is dead space over a portrait game, and the level chip and
  // the count sit right under it.
  ignore('hiding the status bar', StatusBar.hide());

  // `launchAutoHide: false` in `capacitor.config.ts` means the splash is ours
  // to take down — this is the call that does it.
  afterFirstFrame(() => {
    ignore('hiding the splash screen', SplashScreen.hide({ fadeOutDuration: SPLASH_FADE_MS }));
  });

  keepScreenAwake();
}
