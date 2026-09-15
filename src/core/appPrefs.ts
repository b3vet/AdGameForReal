/**
 * The two preferences the player sets from inside the game, and the save that
 * remembers them: the sound, and the debug panel.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md), on a
 * seam the file already had: neither is part of `title -> playing -> result`,
 * both are a flag that has to reach three places at once — the overlay's two
 * buttons, the thing the flag actually controls, and `./save.ts` — and getting
 * one of those three wrong is the only way either can go wrong.
 *
 * The panel is a toggle rather than only a query parameter because the hosted
 * playtest wrapper may not pass one through; the save is what makes the choice
 * survive the reload that wrapper does on its own.
 */

import type { GameAudio } from '@/audio';
import type { Overlay } from '@/ui';

import { loadSave, setDebug, setMuted } from './save';

export interface AppPrefsDeps {
  overlay: Overlay;
  audio: GameAudio;
  /** What the save said at boot, read through `./query.ts` with the rest. */
  muted: boolean;
}

export class AppPrefs {
  private readonly deps: AppPrefsDeps;
  private mutedNow: boolean;

  constructor(deps: AppPrefsDeps) {
    this.deps = deps;
    this.mutedNow = deps.muted;
  }

  /**
   * Puts both preferences on screen. Called once the overlay exists, which is
   * why it is not the constructor: `?debug` is a request to keep the panel on
   * rather than to borrow it for one load, so it *writes* the save the
   * triple-tap gesture writes.
   */
  restore(debugRequested: boolean): void {
    this.deps.overlay.setDebugEnabled(debugRequested ? setDebug(true).debug : loadSave().debug);
    this.deps.overlay.setMuted(this.mutedNow);
  }

  get muted(): boolean {
    return this.mutedNow;
  }

  /** The mute control on the Academy or the HUD. */
  toggleMute(): void {
    this.mutedNow = !this.mutedNow;
    setMuted(this.mutedNow);
    this.deps.audio.setMuted(this.mutedNow);
    this.deps.overlay.setMuted(this.mutedNow);
  }

  /** The triple-tap gesture, or `?debug`. */
  toggleDebug(): void {
    const debug = !this.deps.overlay.debugEnabled;
    this.deps.overlay.setDebugEnabled(debug);
    setDebug(debug);
  }
}
