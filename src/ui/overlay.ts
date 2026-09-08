/**
 * The HTML overlay. Markup lives in `index.html`; this module binds to it and
 * owns nothing else — the `App` state machine decides *when* each screen shows,
 * the overlay only knows *how*.
 *
 * Element ids are a contract with `scripts/smoke.mjs`, which clicks
 * `#play-button` — do not rename it without updating the smoke test.
 */

import './styles.css';

import type { RunState, SimEvent } from '@/sim';

import { DebugPanel } from './debug';
import { Hud } from './hud';

export interface OverlayCallbacks {
  onPlay: () => void;
  onRetry: () => void;
  onNext: () => void;
  /** A level picker chip was tapped. The app decides whether to accept it. */
  onSelectLevel: (level: number) => void;
}

export interface TitleView {
  levelCount: number;
  unlockedLevel: number;
  selectedLevel: number;
}

export interface ResultView {
  levelIndex: number;
  won: boolean;
  survivors: number;
  peakCount: number;
  /** False on the last level, where there is nothing left to unlock. */
  canAdvance: boolean;
}

export class Overlay {
  private readonly title: HTMLElement;
  private readonly hudRoot: HTMLElement;
  private readonly result: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly resultTitle: HTMLElement;
  private readonly resultKicker: HTMLElement;
  private readonly resultSurvivors: HTMLElement;
  private readonly resultPeak: HTMLElement;
  private readonly nextButton: HTMLButtonElement;

  private readonly hud: Hud;
  private readonly debugPanel: DebugPanel;

  private readonly levelChips: HTMLButtonElement[] = [];
  private readonly onSelectLevel: (level: number) => void;

  constructor(root: ParentNode, callbacks: OverlayCallbacks) {
    this.title = requireElement(root, '#title-screen');
    this.hudRoot = requireElement(root, '#hud');
    this.result = requireElement(root, '#result-screen');
    this.picker = requireElement(root, '#level-picker');
    this.resultTitle = requireElement(root, '#result-title');
    this.resultKicker = requireElement(root, '#result-kicker');
    this.resultSurvivors = requireElement(root, '#result-survivors');
    this.resultPeak = requireElement(root, '#result-peak');
    this.nextButton = requireElement<HTMLButtonElement>(root, '#next-button');
    this.onSelectLevel = callbacks.onSelectLevel;

    this.hud = new Hud({
      levelLabel: requireElement(root, '#hud-level'),
      count: requireElement(root, '#hud-count'),
      bossBar: requireElement(root, '#boss-bar'),
      bossFill: requireElement(root, '#boss-bar-fill'),
      bossValue: requireElement(root, '#boss-bar-value'),
      legend: requireElement(root, '#gate-legend'),
    });
    this.debugPanel = new DebugPanel(requireElement(root, '#debug-panel'));

    requireElement<HTMLButtonElement>(root, '#play-button').addEventListener('click', () => {
      callbacks.onPlay();
    });
    requireElement<HTMLButtonElement>(root, '#retry-button').addEventListener('click', () => {
      callbacks.onRetry();
    });
    this.nextButton.addEventListener('click', () => {
      callbacks.onNext();
    });
  }

  showTitle(view: TitleView): void {
    this.buildPicker(view.levelCount);
    for (const chip of this.levelChips) {
      const level = Number(chip.dataset['level']);
      const unlocked = level <= view.unlockedLevel;
      chip.disabled = !unlocked;
      chip.setAttribute('aria-pressed', level === view.selectedLevel ? 'true' : 'false');
    }

    this.title.hidden = false;
    this.hudRoot.hidden = true;
    this.result.hidden = true;
  }

  showPlaying(levelIndex: number): void {
    this.hud.begin(levelIndex);
    this.title.hidden = true;
    this.hudRoot.hidden = false;
    this.result.hidden = true;
  }

  showResult(view: ResultView): void {
    this.resultKicker.textContent = view.won ? 'Victory' : 'Run over';
    this.resultTitle.textContent = view.won ? `Level ${String(view.levelIndex)} cleared` : 'Defeated';
    this.resultSurvivors.textContent = String(Math.max(0, Math.round(view.survivors)));
    this.resultPeak.textContent = String(Math.max(0, Math.round(view.peakCount)));
    this.nextButton.hidden = !(view.won && view.canAdvance);

    this.title.hidden = true;
    // The HUD would collide with the result panel's own numbers, and its job is
    // done: the final count is on this screen as "Survivors".
    this.hudRoot.hidden = true;
    this.result.hidden = false;
  }

  /** `?scene=render-test` shows the raw scene with no overlay at all. */
  hideAll(): void {
    this.title.hidden = true;
    this.hudRoot.hidden = true;
    this.result.hidden = true;
  }

  updateHud(state: Readonly<RunState>, events: readonly SimEvent[]): void {
    this.hud.update(state, events);
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugPanel.setEnabled(enabled);
  }

  updateDebug(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
    phase: string,
  ): void {
    this.debugPanel.update(state, events, dt, phase);
  }

  /** Chips are created once; later `showTitle` calls only re-flag them. */
  private buildPicker(levelCount: number): void {
    if (this.levelChips.length === levelCount) return;

    this.picker.textContent = '';
    this.levelChips.length = 0;

    for (let level = 1; level <= levelCount; level++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'picker__level';
      chip.textContent = String(level);
      chip.dataset['level'] = String(level);
      chip.setAttribute('aria-label', `Level ${String(level)}`);
      chip.addEventListener('click', () => {
        this.onSelectLevel(level);
      });
      this.picker.append(chip);
      this.levelChips.push(chip);
    }
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
