/**
 * The two ways the game stops being on screen, and what has to happen at each.
 *
 * Milestone 9, section B. Split out of `App` rather than written into it for
 * the file-size rule (CLAUDE.md) and because it is one subject: *the app is not
 * drawing right now*. Two unrelated things cause it and they overlap almost
 * every time on a phone —
 *
 *   background   the player took a call, pulled down a notification, locked the
 *                screen, or switched apps (`src/device/lifecycle.ts`);
 *   context lost the GPU took the WebGL context away, which iOS does to a
 *                backgrounded web view under memory pressure
 *                (`src/render/contextLoss.ts`).
 *
 * — so they are counted separately and the frame loop is halted while *either*
 * is true. The order they arrive in is not ours to choose: a lock screen is
 * usually background, then loss, then foreground, then restore, and a restore
 * that arrived while the app was still away must not start the loop.
 *
 * What each one costs:
 *
 *   background   the loop stops (and drops the elapsed time rather than
 *                catching up — `FrameDriver.pause`), the sound goes quiet
 *                without touching the player's mute, and the save is written.
 *   context lost the loop stops. Nothing else: the run is numbers in `src/sim`
 *                and has no opinion about the GPU.
 *
 * Nothing here knows which screen is up, and nothing here touches the session.
 * A run interrupted by a phone call is the same run when the player comes back.
 */

import type { GameAudio } from '@/audio';
import { stopWatchingAppVisibility, watchAppVisibility } from '@/device';
import type { AppVisibility } from '@/device';

import type { FrameDriver } from './frame';
import { loadSave, saveSave } from './save';

export interface AppLifecycleDeps {
  driver: FrameDriver;
  audio: GameAudio;
  /**
   * The scene has to be drawn again from scratch. The title backdrop is drawn
   * once and then held (`FrameDriver.markPreviewDirty`), so without this a
   * context restored on the Academy leaves a screen nothing ever repaints.
   */
  markDirty: () => void;
}

export class AppLifecycle {
  private readonly deps: AppLifecycleDeps;

  private background = false;
  private contextLost = false;

  constructor(deps: AppLifecycleDeps) {
    this.deps = deps;
  }

  /** Starts listening. Called once the app is up and drawing. */
  start(): void {
    watchAppVisibility(this.onVisibility);
  }

  /** `App.dispose`. */
  stop(): void {
    stopWatchingAppVisibility();
  }

  /** True while the app is off screen. The device report prints it. */
  get isBackground(): boolean {
    return this.background;
  }

  /** The renderer lost the GPU context (`Renderer`'s `onContextLost`). */
  onContextLost(): void {
    if (this.contextLost) return;
    this.contextLost = true;
    this.apply();
  }

  /** Babylon has finished rebuilding the scene's GPU resources. */
  onContextRestored(): void {
    if (!this.contextLost) return;
    this.contextLost = false;
    // Before the loop is allowed to run again, so the first frame back is the
    // one that repaints the backdrop.
    this.deps.markDirty();
    this.apply();
  }

  private readonly onVisibility = (visibility: AppVisibility): void => {
    const background = visibility === 'background';
    if (background === this.background) return;
    this.background = background;

    this.deps.audio.setSuspended(background);
    if (background) this.flushSave();
    this.apply();
  };

  /** Halted while either reason holds; both `pause` and `resume` are idempotent. */
  private apply(): void {
    const driver = this.deps.driver;
    if (this.background || this.contextLost) driver.pause();
    else driver.resume();
  }

  /**
   * Writes the save back as it stands.
   *
   * Every change already writes synchronously (`./save.ts`), so on a desktop
   * browser this is a no-op that costs one `JSON.stringify`. It is here for the
   * device: backgrounding is the last moment iOS guarantees the app, and it may
   * terminate a suspended app without another frame or another event. A save
   * that was written five minutes ago is fine; one that a `localStorage`
   * implementation has buffered is not, and this is the call that settles it.
   */
  private flushSave(): void {
    saveSave(loadSave());
  }
}
