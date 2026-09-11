/**
 * The HTML overlay. Markup lives in `index.html`; this module binds to it and
 * owns nothing else — the `App` state machine decides *when* each screen shows,
 * the overlay only knows *how*.
 *
 * Element ids are a contract with `scripts/smoke.mjs`, which clicks
 * `#play-button` — do not rename it without updating the smoke test.
 *
 * Every listener this class adds goes through one `AbortController`, so
 * `dispose` takes them all off in one call and a re-created app never ends up
 * with two overlays fighting over the same buttons.
 */

import './styles.css';
// Imported for the effect, not the value: it starts the display faces loading
// at boot (see `./fonts`), which the overlay itself only benefits from.
import './fonts';

import type { RunState, SimEvent, WeaponId } from '@/sim';

import { Confetti } from './confetti';
import { DebugPanel } from './debug';
import type { DebugStats } from './debug';
import { Hud } from './hud';
import { watchTripleTap } from './taps';

export interface OverlayCallbacks {
  onPlay: () => void;
  onRetry: () => void;
  onNext: () => void;
  /** A level picker chip was tapped. The app decides whether to accept it. */
  onSelectLevel: (level: number) => void;
  /** "Levels" on the result screen: back to the title and its level picker. */
  onLevels: () => void;
  /** Any button at all, for the tap sound. Fires before the button's own call. */
  onTap: () => void;
  /** The mute control was used. The app owns the flag and calls `setMuted`. */
  onToggleMute: () => void;
  /**
   * The wordmark or the level chip was triple-tapped. The app flips the debug
   * panel and writes the choice to the save.
   */
  onToggleDebug: () => void;
  /** One step of the result screen's count-up, for its tick sound. */
  onCountTick: () => void;
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

/** How long the result numbers take to roll up, and the gap between ticks. */
const COUNT_UP_SECONDS = 0.7;
const COUNT_TICK_MS = 55;

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
  private readonly retryButton: HTMLButtonElement;
  private readonly levelsButton: HTMLButtonElement;
  private readonly muteButtons: HTMLButtonElement[];

  private readonly hud: Hud;
  private readonly debugPanel: DebugPanel;
  private readonly confetti: Confetti;

  private readonly levelChips: HTMLButtonElement[] = [];
  private readonly callbacks: OverlayCallbacks;
  private readonly listeners = new AbortController();

  private countUpRaf: number | null = null;

  constructor(root: ParentNode, callbacks: OverlayCallbacks) {
    this.callbacks = callbacks;
    this.title = requireElement(root, '#title-screen');
    this.hudRoot = requireElement(root, '#hud');
    this.result = requireElement(root, '#result-screen');
    this.picker = requireElement(root, '#level-picker');
    this.resultTitle = requireElement(root, '#result-title');
    this.resultKicker = requireElement(root, '#result-kicker');
    this.resultSurvivors = requireElement(root, '#result-survivors');
    this.resultPeak = requireElement(root, '#result-peak');
    this.nextButton = requireElement<HTMLButtonElement>(root, '#next-button');
    this.retryButton = requireElement<HTMLButtonElement>(root, '#retry-button');
    this.levelsButton = requireElement<HTMLButtonElement>(root, '#levels-button');
    this.muteButtons = [
      requireElement<HTMLButtonElement>(root, '#mute-title'),
      requireElement<HTMLButtonElement>(root, '#mute-hud'),
    ];

    this.hud = new Hud({
      levelLabel: requireElement(root, '#hud-level'),
      count: requireElement(root, '#hud-count'),
      staffBadge: requireElement(root, '#hud-staff'),
      bossBar: requireElement(root, '#boss-bar'),
      bossFill: requireElement(root, '#boss-bar-fill'),
      bossValue: requireElement(root, '#boss-bar-value'),
      bossLabel: requireElement(root, '#boss-bar-label'),
    });
    this.debugPanel = new DebugPanel(
      {
        root: requireElement(root, '#debug-panel'),
        text: requireElement(root, '#debug-text'),
        summary: requireElement(root, '#debug-capture'),
        button: requireElement<HTMLButtonElement>(root, '#debug-capture-button'),
      },
      this.listeners.signal,
    );
    this.confetti = new Confetti(requireElement<HTMLCanvasElement>(root, '#confetti'));

    // The hosted playtest wrapper may not pass `?debug` through, so the panel
    // needs a way in from inside the game. Hit-tested rather than bound to the
    // elements, so a drag that starts on the chip still steers (`./taps.ts`).
    watchTripleTap(
      [requireElement(root, '#title-wordmark'), requireElement(root, '#hud-level')],
      () => {
        callbacks.onToggleDebug();
      },
      this.listeners.signal,
    );

    this.onTap(requireElement<HTMLButtonElement>(root, '#play-button'), callbacks.onPlay);
    this.onTap(this.retryButton, callbacks.onRetry);
    this.onTap(this.nextButton, callbacks.onNext);
    this.onTap(this.levelsButton, callbacks.onLevels);
    for (const button of this.muteButtons) this.onTap(button, callbacks.onToggleMute);
  }

  showTitle(view: TitleView): void {
    this.buildPicker(view.levelCount);
    for (const chip of this.levelChips) {
      const level = Number(chip.dataset['level']);
      const unlocked = level <= view.unlockedLevel;
      chip.disabled = !unlocked;
      chip.setAttribute('aria-pressed', level === view.selectedLevel ? 'true' : 'false');
    }

    this.stopCountUp();
    this.confetti.stop();
    this.title.hidden = false;
    this.hudRoot.hidden = true;
    this.result.hidden = true;
  }

  showPlaying(levelIndex: number, staff: WeaponId): void {
    this.stopCountUp();
    this.confetti.stop();
    this.hud.begin(levelIndex, staff);
    this.title.hidden = true;
    this.hudRoot.hidden = false;
    this.result.hidden = true;
  }

  /**
   * Copy is in the epic register (docs/06-milestone-2-plan.md) and cut to the
   * shortest phrase that still says it (plan, "UI text, font"): a win is a
   * slaughter, a loss is being overwhelmed, and the next level is an ascent.
   */
  showResult(view: ResultView): void {
    const survivors = Math.max(0, Math.round(view.survivors));
    const peak = Math.max(0, Math.round(view.peakCount));

    this.resultKicker.textContent = view.won ? 'Horde slain' : 'Overwhelmed';
    this.resultTitle.textContent = `Level ${String(view.levelIndex)}`;
    this.nextButton.hidden = !(view.won && view.canAdvance);
    // "Levels" is the way out when there is no next level to ascend to; on a
    // won level with one waiting it would only compete with "Ascend".
    this.levelsButton.hidden = view.won && view.canAdvance;

    this.title.hidden = true;
    // The HUD would collide with the result panel's own numbers, and its job is
    // done: the final count is on this screen as "Survivors".
    this.hudRoot.hidden = true;
    this.result.hidden = false;

    if (view.won) {
      this.confetti.burst();
      this.countUp(survivors, peak);
    } else {
      this.stopCountUp();
      this.confetti.stop();
      this.resultSurvivors.textContent = String(survivors);
      this.resultPeak.textContent = String(peak);
    }
  }

  /** `?scene=render-test` and `?scene=stress` show the raw scene, no overlay. */
  hideAll(): void {
    this.stopCountUp();
    this.confetti.stop();
    this.title.hidden = true;
    this.hudRoot.hidden = true;
    this.result.hidden = true;
  }

  updateHud(state: Readonly<RunState>, events: readonly SimEvent[]): void {
    this.hud.update(state, events);
  }

  /** Both mute buttons show the same state; the app owns the flag. */
  setMuted(muted: boolean): void {
    for (const button of this.muteButtons) {
      button.setAttribute('aria-pressed', muted ? 'true' : 'false');
      button.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
    }
  }

  setDebugEnabled(enabled: boolean): void {
    this.debugPanel.setEnabled(enabled);
  }

  /** False lets the app skip gathering numbers only the panel would read. */
  get debugEnabled(): boolean {
    return this.debugPanel.isEnabled;
  }

  updateDebug(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
    phase: string,
    stats: DebugStats,
  ): void {
    this.debugPanel.update(state, events, dt, phase, stats);
  }

  dispose(): void {
    this.stopCountUp();
    this.confetti.dispose();
    this.listeners.abort();
  }

  /** Wires a button: tap sound first, then what the button is for. */
  private onTap(button: HTMLButtonElement, action: () => void): void {
    button.addEventListener(
      'click',
      () => {
        this.callbacks.onTap();
        action();
      },
      { signal: this.listeners.signal },
    );
  }

  /**
   * Rolls both result numbers up from zero. Ticks are throttled to the ear
   * rather than to the frame: a 400-unit peak counting up at 60 fps would be a
   * buzz, not a count.
   */
  private countUp(survivors: number, peak: number): void {
    this.stopCountUp();
    const start = typeof performance === 'undefined' ? 0 : performance.now();
    let lastTick = start;
    let shownSurvivors = -1;
    let shownPeak = -1;

    const step = (time: number): void => {
      const t = Math.min(1, (time - start) / (COUNT_UP_SECONDS * 1000));
      // Ease out: fast at the start, so the last few numbers are readable.
      const eased = 1 - Math.pow(1 - t, 3);
      const nextSurvivors = Math.round(survivors * eased);
      const nextPeak = Math.round(peak * eased);

      if (nextSurvivors !== shownSurvivors) {
        shownSurvivors = nextSurvivors;
        this.resultSurvivors.textContent = String(nextSurvivors);
      }
      if (nextPeak !== shownPeak) {
        shownPeak = nextPeak;
        this.resultPeak.textContent = String(nextPeak);
        if (time - lastTick >= COUNT_TICK_MS) {
          lastTick = time;
          this.callbacks.onCountTick();
        }
      }

      if (t >= 1) {
        this.countUpRaf = null;
        return;
      }
      this.countUpRaf = requestAnimationFrame(step);
    };

    this.resultSurvivors.textContent = '0';
    this.resultPeak.textContent = '0';
    this.countUpRaf = requestAnimationFrame(step);
  }

  private stopCountUp(): void {
    if (this.countUpRaf === null) return;
    cancelAnimationFrame(this.countUpRaf);
    this.countUpRaf = null;
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
      this.onTap(chip, () => {
        this.callbacks.onSelectLevel(level);
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
