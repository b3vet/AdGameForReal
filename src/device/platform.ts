/**
 * Which shell the game is running in.
 *
 * `@capacitor/core` is safe to import in a browser: with no native bridge on
 * `globalThis`, it builds a web `Capacitor` whose `getPlatform()` is `'web'` and
 * whose `isNativePlatform()` is false. Nothing here talks to a plugin, so a
 * page that never runs inside the app pays for this module and stops.
 *
 * Every other file in `src/device` asks here first and returns early on the
 * web, which is what keeps the three browser builds (`build`, `build:hosted`,
 * `build:artifact`) free of native calls.
 */

import { Capacitor } from '@capacitor/core';

export type DevicePlatform = 'ios' | 'android' | 'web';

/**
 * `'ios' | 'android' | 'web'`. Capacitor types this as a bare string because a
 * community platform can register its own name; anything we do not ship is
 * treated as the browser, since that is the code path that assumes nothing.
 */
export function platformName(): DevicePlatform {
  const name = Capacitor.getPlatform();
  return name === 'ios' || name === 'android' ? name : 'web';
}

/** True inside the Capacitor app (iOS or Android), false in any browser. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** True inside the iOS app specifically. */
export function isIOS(): boolean {
  return platformName() === 'ios';
}
