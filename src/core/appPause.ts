/**
 * The pause menu, wired into the app (docs/27, section B).
 *
 * `./pause.ts` is the rules and `./heldFrame.ts` is the picture; this is the one
 * place that says what each of their switches is connected to, so `App` keeps
 * reading as a state machine. Split out for the file-size rule (CLAUDE.md) and
 * because every line here is wiring: which screen the menu goes on, what holds
 * the loop, what Restart and Home call, and the two keys.
 *
 * Restart is "same road again" (`RunStage.replay`) rather than "again": the
 * player asked for the run they were on, from the top, and on a replayed or an
 * endless road that is the seed it was walked on, not a fresh one.
 */

import type { Overlay } from '@/ui';
import type { Renderer } from '@/render/Renderer';

import type { AppLifecycle } from './appLifecycle';
import type { RunStage } from './appRun';
import { HeldFrame } from './heldFrame';
import { RunPause, watchPauseKeys } from './pause';

/**
 * The app, as the menu sees it. Structural, so this file imports no `App`, and
 * read lazily: `App` hands itself over from inside its own constructor.
 */
export interface PauseHost {
  readonly renderer: Renderer;
  readonly overlay: Overlay;
  /** The state machine's node; a run's end sequence is still `playing`. */
  status: () => string;
  /** The Academy's home. */
  showHome: () => void;
}

export interface AppPause {
  pause: RunPause;
  /** Takes the keys off and drops a redraw still waiting for its frame. */
  dispose: () => void;
}

export function createAppPause(app: PauseHost, runs: RunStage, lifecycle: AppLifecycle): AppPause {
  const overlay = app.overlay;
  const held = new HeldFrame({
    renderer: app.renderer,
    // Only ever asked with a run on the road, which is after `Renderer.init`
    // (the getter throws before it).
    sceneReady: () => app.renderer.scene.isReady(),
    session: () => runs.current,
    held: () => pause.paused,
  });
  const pause = new RunPause({
    // Not the end sequence: a finished run is still `playing` until its sheet.
    pausable: () => app.status() === 'playing' && runs.current?.finished === false,
    endless: () => runs.current?.isEndless === true,
    showMenu: (endless) => {
      overlay.showPause(endless);
    },
    hideMenu: () => {
      overlay.hidePause();
    },
    hold: (paused) => {
      lifecycle.setRunPaused(paused);
    },
    redraw: () => {
      held.request();
    },
    restart: () => {
      runs.replay();
    },
    home: () => {
      app.showHome();
    },
  });
  // Away mid-run comes back on the menu, and a restored context redraws it.
  lifecycle.listen(pause);
  const detachKeys = watchPauseKeys(window, () => pause.toggle());
  return {
    pause,
    dispose: () => {
      detachKeys();
      held.cancel();
    },
  };
}
