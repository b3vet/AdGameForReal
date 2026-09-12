/**
 * Capacitor shell configuration (decision D34; `docs/12-milestone-4-plan.md`,
 * "Device build"). `docs/DEVICE.md` is the Mac guide that uses this file.
 *
 * The wrapper adds nothing to the game: it serves the unchanged `dist/` build
 * inside a WKWebView and gives it a full-screen shell plus haptics
 * (`src/device/`). Every field below is here because the default is wrong for a
 * portrait, full-screen, never-scrolling game, or because the product owner has
 * to be able to find and change it — nothing is decorative.
 *
 * Not set on purpose:
 *   - `server`. Leaving it out keeps the default `capacitor://localhost` scheme
 *     on iOS. The scheme is the save data's origin, so changing it later throws
 *     away every `localStorage` save on the device (`src/core/save.ts`).
 *   - `android`. No Android package is installed yet (`docs/DEVICE.md`, "Android
 *     later"); the platform gets its own block when it is added.
 */

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The colour the native shell paints where the web view has not drawn yet: the
 * launch splash, the frame before Babylon's first render, and the strip behind
 * a rotation.
 *
 * The page's own background, character for character (`src/ui/styles.css`, the
 * `html, body` rule: "a daylight sky, not a black flash"). The milestone plan
 * gave the old dark indigo of Milestone 2, and against D28's daylight art that
 * made launch go deep purple -> sky -> scene — two colour changes before the
 * game appears. With this one they are the same colour and the only thing that
 * ever fades in is the scene. Keep the two in step: if `styles.css` changes,
 * change this and re-run `npm run cap:sync`.
 */
const APP_BACKGROUND = '#bfe4f5';

/** Matches the splash fade in `src/device/shell.ts`; short, because the web
 * build is already drawing by the time it starts. */
const SPLASH_FADE_MS = 250;

const config: CapacitorConfig = {
  /**
   * The bundle identifier Xcode signs. A placeholder the product owner may
   * change before the first build — it must be unique per Apple ID, and
   * changing it later means a new app on the phone, not an update.
   */
  appId: 'com.arcanerush.app',

  /** Shown under the icon on the home screen and in Xcode's target name. */
  appName: 'Arcane Rush',

  /**
   * What `npx cap sync` copies into the app bundle: the normal `npm run build`
   * output, assets and all. The single-file builds (`build:artifact`,
   * `build:hosted`) are for playtest links and are never shipped to a device.
   */
  webDir: 'dist',

  /** Fallback for every platform; `ios.backgroundColor` below overrides it. */
  backgroundColor: APP_BACKGROUND,

  ios: {
    /**
     * `contentInsetAdjustmentBehavior = .never`: the web view keeps the full
     * screen and iOS never pads it for the status bar or the home indicator.
     * The layout handles the notch itself with `env(safe-area-inset-*)`
     * (`src/ui/styles.css`). Already the Capacitor 8 default; set explicitly so
     * a future default change cannot move the road.
     */
    contentInset: 'never',

    /** The shell colour described above. */
    backgroundColor: APP_BACKGROUND,

    /**
     * The game is one fixed screen and every gesture belongs to the squad, so
     * the web view's scroll view must not rubber-band under a drag.
     */
    scrollEnabled: false,

    /** No pinch zoom on a game canvas. Capacitor's default, set explicitly. */
    zoomEnabled: false,

    /** A phone-sized page, never the desktop content mode an iPad would pick. */
    preferredContentMode: 'mobile',

    /**
     * Lets Safari's Web Inspector (Develop > iPhone) attach to the running app
     * on iOS 16.4+ even when Xcode builds Release. That is how the product
     * owner reads the debug panel's numbers off the phone and how we get a
     * console for a crash; there is nothing to protect in this build yet.
     */
    webContentsDebuggingEnabled: true,
  },

  plugins: {
    SplashScreen: {
      /**
       * The splash stays up until `src/device/shell.ts` hides it, one frame
       * after the game has actually drawn something, rather than after a fixed
       * time. Booting Babylon, the fonts and the level takes a second or two on
       * a phone and a timed splash would either flash or lie.
       *
       * The trade is that a boot that never finishes would leave the splash up,
       * so `shell.ts` also hides it on a hard timeout.
       */
      launchAutoHide: false,
      launchFadeOutDuration: SPLASH_FADE_MS,
      backgroundColor: APP_BACKGROUND,
      /** A spinner on a two-second launch reads as "stuck", not as "loading". */
      showSpinner: false,
    },

    StatusBar: {
      /**
       * `src/device/shell.ts` hides the status bar at boot, so this style is
       * only ever seen in the instant before that call lands. `LIGHT` is the
       * plugin's name for *dark glyphs on a light background*, which is what
       * `APP_BACKGROUND` now needs — it was `DARK` while the shell was indigo.
       */
      style: 'LIGHT',
    },
  },
};

export default config;
