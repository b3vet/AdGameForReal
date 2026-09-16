/**
 * The pause menu, on the app's side of the overlay (docs/27, section B).
 *
 * A run can be stopped four ways — the round button beside the sound, P or
 * Escape on a keyboard, the debug handle, and the phone taking the app away —
 * and all four land here, because the menu is one fact with three consequences
 * that must never disagree: the menu is up, the frame loop and the sound are
 * held (`./appLifecycle.ts`), and a finger on the canvas steers nothing
 * (`App`'s `steerable`).
 *
 * Its own module rather than a flag on `App` for the file-size rule and because
 * the rules are worth testing on their own:
 *
 *   - only a run that is actually being played can pause. The Academy, the
 *     result sheet and a run's end sequence (the beat between the last body
 *     falling and the sheet) cannot, and on those screens every way in is a
 *     no-op rather than an error;
 *   - backgrounding pauses, so a phone call ends on the menu rather than back
 *     in the fight. Nothing else pauses on its own — a bot run (`?bot=`,
 *     `?perf`, the smoke) plays straight through unless it is asked to stop;
 *   - Restart and Home *abandon* the run. Nothing here pays, unlocks or counts
 *     anything: a run is only ever paid by `RunStage.finish`, which a run that
 *     never finished never reaches, so dropping the session is the whole of it
 *     (`src/core/__tests__/abandon.test.ts` holds that line);
 *   - any change of phase takes the menu down (`release`). A run started from
 *     the debug handle behind the menu must not inherit a held loop with no
 *     menu to release it.
 *
 * Nothing here touches the DOM beyond the one keyboard listener at the bottom,
 * so the rules run under Node.
 */

export interface RunPauseDeps {
  /**
   * True while a run is on the road and still running: the `playing` phase,
   * before the run's status has left `running`.
   */
  pausable: () => boolean;
  /** Whether the run on the road is the endless one (D52), for the menu's copy. */
  endless: () => boolean;
  /** Puts the menu up; `endless` picks the Restart button's words. */
  showMenu: (endless: boolean) => void;
  hideMenu: () => void;
  /** Holds the frame loop and the sound, or lets them go (`AppLifecycle.setRunPaused`). */
  hold: (paused: boolean) => void;
  /** The frozen frame behind the menu has to be drawn again (`./heldFrame.ts`). */
  redraw: () => void;
  /** The road just walked, from the top, on the seed it was walked on. */
  restart: () => void;
  /** The Academy's home screen. */
  home: () => void;
}

export class RunPause {
  private readonly deps: RunPauseDeps;
  private open = false;

  constructor(deps: RunPauseDeps) {
    this.deps = deps;
  }

  /** True while the menu is up and the run is held. */
  get paused(): boolean {
    return this.open;
  }

  /**
   * Stops the run and puts the menu up. Answers whether the run is paused now,
   * which is false on every screen that is not a run being played.
   */
  pause(): boolean {
    if (this.open) return true;
    if (!this.deps.pausable()) return false;
    this.open = true;
    // The hold first: the menu's own work (focus, layout) is a task away from
    // the next frame, and no frame of the run may land in between.
    this.deps.hold(true);
    this.deps.showMenu(this.deps.endless());
    return true;
  }

  /** Resume: the menu goes and the run carries on from the frame it stopped on. */
  resume(): void {
    if (!this.open) return;
    this.close();
  }

  /**
   * P and Escape. Answers whether anything happened, so a key pressed on the
   * Academy is left to the page.
   */
  toggle(): boolean {
    if (!this.open) return this.pause();
    this.resume();
    return true;
  }

  /**
   * Restart: the run is dropped unpaid and the same road starts again.
   *
   * The hold is let go before the new run exists, which is safe because the
   * loop only asks for its next frame here: the frame that answers it is a task
   * away, and by then the session it reads is the new one.
   */
  restart(): void {
    if (!this.open) return;
    this.close();
    this.deps.restart();
  }

  /** Home: the run is dropped unpaid and the Academy comes back. */
  home(): void {
    if (!this.open) return;
    this.close();
    this.deps.home();
  }

  /**
   * The phase moved — a new run, a result sheet, the Academy — so whatever the
   * menu was holding is over. A no-op when it is not up.
   */
  release(): void {
    if (this.open) this.close();
  }

  /**
   * The phone took the app away, or gave it back (`./appLifecycle.ts`).
   *
   * Away pauses, so the player comes back to the menu rather than to a fight
   * already in progress; a run that was already paused simply stays so. Back
   * leaves the menu where it is and asks for the frozen frame again, because a
   * web view that was away may have dropped what it last showed.
   */
  onVisibility(background: boolean): void {
    if (background) this.pause();
    else this.redraw();
  }

  /**
   * The canvas lost what was on it — a resize, a restored GPU context — so the
   * frozen frame is drawn again. Nothing to do while the run is moving: the
   * next frame draws it anyway.
   */
  redraw(): void {
    if (this.open) this.deps.redraw();
  }

  private close(): void {
    this.open = false;
    this.deps.hideMenu();
    this.deps.hold(false);
  }
}

/** The fields of a `KeyboardEvent` the pause keys are decided on. */
export interface PauseKeyEvent {
  readonly code: string;
  readonly key: string;
  readonly repeat: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * P and Escape toggle the menu on a keyboard. A held key repeats, and a repeat
 * would open and close the menu at the keyboard's repeat rate, so only the
 * first press counts; a chord belongs to the browser (Cmd-P is print).
 */
export function isPauseKey(event: PauseKeyEvent): boolean {
  if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false;
  return event.code === 'KeyP' || event.key === 'Escape';
}

/**
 * Listens for the pause keys on `target` and answers the function that stops
 * listening. What a press does on a screen with no run is `RunPause`'s
 * business (nothing), so the listener itself is always on; `onPress` answers
 * whether it acted, and only a press that did is kept from the page.
 */
export function watchPauseKeys(target: Window, onPress: () => boolean): () => void {
  const listeners = new AbortController();
  target.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (isPauseKey(event) && onPress()) event.preventDefault();
    },
    { signal: listeners.signal },
  );
  return () => {
    listeners.abort();
  };
}
