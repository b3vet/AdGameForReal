/**
 * The pause menu (docs/27, section B): "Paused", Resume, Restart and Home.
 *
 * The overlay's half only. Whether the run *can* pause, what holds the loop and
 * what Restart and Home throw away are `src/core/pause.ts`; this puts the
 * menu up and takes it down, with the words from `academy.json` and the focus
 * where a keyboard or a screen reader expects it:
 *
 *   - opening moves focus to Resume, so Enter or Space answers the question
 *     the menu is asking, and remembers where focus was;
 *   - while the menu is up everything behind it is `inert`, so Tab cannot walk
 *     out of the dialog into the HUD it is covering and a screen reader does
 *     not read the count through the dim;
 *   - closing hands focus back to where it was — the pause button, normally —
 *     unless that element has gone with the screen it was on.
 */

import { academy } from '@/data/academy-types';

import { requireElement } from './dom';

import './pause.css';

export interface PauseElements {
  screen: HTMLElement;
  title: HTMLElement;
  resume: HTMLButtonElement;
  restart: HTMLButtonElement;
  home: HTMLButtonElement;
  /** The HUD's pause button, which the words in `academy.json` also name. */
  button: HTMLButtonElement;
  /** The screens the menu covers, made inert while it is up. */
  behind: readonly HTMLElement[];
}

/**
 * The menu's elements in `index.html`, and the HUD's pause button that opens
 * it. `behind` is what the menu covers.
 */
export function pauseElements(root: ParentNode, behind: readonly HTMLElement[]): PauseElements {
  return {
    screen: requireElement(root, '#pause-screen'),
    title: requireElement(root, '#pause-title'),
    resume: requireElement<HTMLButtonElement>(root, '#pause-resume'),
    restart: requireElement<HTMLButtonElement>(root, '#pause-restart'),
    home: requireElement<HTMLButtonElement>(root, '#pause-home'),
    button: requireElement<HTMLButtonElement>(root, '#pause-hud'),
    behind,
  };
}

export interface PauseCallbacks {
  onResume: () => void;
  onRestart: () => void;
  onHome: () => void;
}

/** Wires a button through the overlay, so every tap makes the same sound. */
type Bind = (button: HTMLButtonElement, action: () => void) => void;

export class PauseMenu {
  private readonly elements: PauseElements;
  /** Where focus was when the menu opened, to hand it back on close. */
  private returnFocus: HTMLElement | null = null;

  constructor(elements: PauseElements, callbacks: PauseCallbacks, bind: Bind) {
    this.elements = elements;
    const copy = academy.pause;
    elements.title.textContent = copy.title;
    elements.resume.textContent = copy.resume;
    elements.restart.textContent = copy.restart;
    elements.home.textContent = copy.home;
    elements.button.setAttribute('aria-label', copy.button);

    bind(elements.resume, callbacks.onResume);
    bind(elements.restart, callbacks.onRestart);
    bind(elements.home, callbacks.onHome);
  }

  get isOpen(): boolean {
    return !this.elements.screen.hidden;
  }

  /** `endless` names the Restart button for a road with no level (D52). */
  open(endless: boolean): void {
    const { screen, restart, resume } = this.elements;
    const copy = academy.pause;
    restart.textContent = endless ? copy.restartEndless : copy.restart;
    if (this.isOpen) return;

    const active = document.activeElement;
    this.returnFocus = active instanceof HTMLElement ? active : null;
    screen.hidden = false;
    this.setBehindInert(true);
    resume.focus({ preventScroll: true });
  }

  /** Takes the menu down. A no-op when it is not up. */
  close(): void {
    if (!this.isOpen) return;
    this.elements.screen.hidden = true;
    this.setBehindInert(false);

    const back = this.returnFocus;
    this.returnFocus = null;
    // Only somewhere the player can still see: after Home the HUD is gone, and
    // focusing a button inside a hidden screen does nothing useful.
    if (back !== null && back.isConnected && back.closest('[hidden]') === null) {
      back.focus({ preventScroll: true });
    }
  }

  private setBehindInert(inert: boolean): void {
    for (const screen of this.elements.behind) screen.inert = inert;
  }
}
