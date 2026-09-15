/**
 * The device layer (decision D34; `docs/12-milestone-4-plan.md`, "Device build";
 * `docs/DEVICE.md` for the Mac steps).
 *
 * Public surface of `src/device`, and the module `src/main.ts` imports for its
 * side effect — that one import line is the whole integration. Importing this
 * from a browser costs a platform check and nothing else: every native call
 * lives behind `isNative()`.
 *
 *   platform.ts   which shell we are in
 *   shell.ts      status bar, splash, wake lock, portrait lock
 *   lifecycle.ts  foreground and background, from the plugin or the browser
 *   haptics.ts    sim events to the Taptic Engine, and `onSimEvents` for the app
 *   simTap.ts     how haptics get fed today, without an edit to `src/core`
 *
 * The wrapper adds nothing the browser build lacks except these (plan, "Device
 * build"): the game is the same `dist/` build either way.
 *
 * `./lifecycle.ts` is the one module here that is *not* native-only — a browser
 * tab is backgrounded exactly as an app is, and the sim clock has to stop
 * either way — so it is exported for `src/core/App.ts` to wire on every build
 * rather than started by `initDevice` below.
 */

import { initShell } from './shell';
import { isNative } from './platform';
import { startSimTap } from './simTap';

export { onRunAwards, onSimEvents, hapticsActive } from './haptics';
export { appVisibility, stopWatchingAppVisibility, watchAppVisibility } from './lifecycle';
export type { AppVisibility } from './lifecycle';
export { isIOS, isNative, platformName } from './platform';
export type { DevicePlatform } from './platform';

let started = false;

/**
 * Brings up the native shell and the haptics feed. Idempotent, so the side
 * effect below and an explicit call from the app cannot start two of anything.
 */
export function initDevice(): void {
  if (started || !isNative()) return;
  started = true;

  initShell();
  startSimTap();
}

initDevice();
