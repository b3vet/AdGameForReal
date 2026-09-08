/**
 * The HTML overlay. Markup lives in `index.html`; this module only binds to it,
 * so Phase B3 can restyle freely without touching the app state machine.
 *
 * Element ids are a contract with `scripts/smoke.mjs`, which clicks
 * `#play-button` — do not rename it without updating the smoke test.
 */

import './styles.css';

export interface OverlayCallbacks {
  onPlay: () => void;
  onRetry: () => void;
  onNext: () => void;
}

export class Overlay {
  private readonly title: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly result: HTMLElement;
  private readonly playButton: HTMLButtonElement;

  constructor(root: ParentNode, callbacks: OverlayCallbacks) {
    this.title = requireElement(root, '#title-screen');
    this.hud = requireElement(root, '#hud');
    this.result = requireElement(root, '#result-screen');
    this.playButton = requireElement<HTMLButtonElement>(root, '#play-button');

    this.playButton.addEventListener('click', () => {
      callbacks.onPlay();
    });

    // Phase B3 adds Retry / Next buttons to the result screen and binds them
    // through these callbacks.
    void callbacks.onRetry;
    void callbacks.onNext;
  }

  showTitle(): void {
    this.title.hidden = false;
    this.hud.hidden = true;
    this.result.hidden = true;
  }

  showPlaying(): void {
    this.title.hidden = true;
    this.hud.hidden = false;
    this.result.hidden = true;
  }

  showResult(): void {
    this.title.hidden = true;
    this.hud.hidden = false;
    this.result.hidden = false;
  }

  /** Phase B3: squad count, level label, boss HP bar. */
  updateHud(): void {
    // Intentionally empty in Phase A.
  }
}

function requireElement<T extends HTMLElement = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Overlay is missing required element "${selector}" (see index.html)`);
  }
  return element;
}
