/**
 * The result sheet: what the run paid, what survived, and the way out.
 *
 * Milestone 4 puts coins on it (D33), which is the screen's new headline: the
 * run's whole point on the meta layer is the purse it fills, so the coins roll
 * up first — with their own bright tick — and only then does the total settle
 * underneath them. A first clear says so with a badge, because the bonus it
 * carries is four times the ordinary one and that should be visible.
 *
 * Split out of `./overlay.ts` when the Academy arrived: the overlay is about
 * which screen is up, and this is one screen's numbers.
 */

import { academy } from '@/data/academy-types';

import { replay } from './widgets';

export interface ResultView {
  levelIndex: number;
  won: boolean;
  survivors: number;
  peakCount: number;
  /** Coins this run paid, from `runRewards`. */
  coins: number;
  /** The purse afterwards. */
  totalCoins: number;
  /** True when this run was the first clear of the level. */
  firstClear: boolean;
  /** False on the last level, where there is nothing left to unlock. */
  canAdvance: boolean;
}

export interface ResultElements {
  kicker: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  survivors: HTMLElement;
  peak: HTMLElement;
  coins: HTMLElement;
  total: HTMLElement;
  next: HTMLButtonElement;
  levels: HTMLButtonElement;
}

export interface ResultCallbacks {
  /** One step of the survivors and peak roll-up. */
  onCountTick: () => void;
  /** One step of the coin roll-up; a brighter click. */
  onCoinTick: () => void;
}

/** How long each roll takes, and the gap between two ticks of it. */
const COUNT_UP_SECONDS = 0.7;
const COINS_UP_SECONDS = 0.6;
const COUNT_TICK_MS = 55;
const COIN_TICK_MS = 45;

export class ResultPanel {
  private readonly elements: ResultElements;
  private readonly callbacks: ResultCallbacks;

  private raf: number | null = null;

  constructor(elements: ResultElements, callbacks: ResultCallbacks) {
    this.elements = elements;
    this.callbacks = callbacks;
  }

  /**
   * Copy is in the epic register (docs/06-milestone-2-plan.md) and cut to the
   * shortest phrase that still says it: a win is a slaughter, a loss is being
   * overwhelmed, and the next level is an ascent.
   */
  show(view: ResultView): void {
    const survivors = Math.max(0, Math.round(view.survivors));
    const peak = Math.max(0, Math.round(view.peakCount));
    const coins = Math.max(0, Math.round(view.coins));
    const total = Math.max(0, Math.round(view.totalCoins));

    this.elements.kicker.textContent = view.won ? 'Horde slain' : 'Overwhelmed';
    this.elements.title.textContent = `Level ${String(view.levelIndex)}`;
    this.elements.badge.textContent = academy.result.firstClear;
    this.elements.badge.hidden = !(view.won && view.firstClear);
    this.elements.next.hidden = !(view.won && view.canAdvance);
    // Always offered, unlike Milestone 3's "Levels": the Academy is where the
    // coins this run just paid are spent, so a won run must not be able to
    // funnel the player straight into the next level with no way to the shop.
    this.elements.levels.hidden = false;

    this.stop();
    if (!view.won) {
      // A lost run is not a moment for a fanfare of numbers.
      this.elements.survivors.textContent = String(survivors);
      this.elements.peak.textContent = String(peak);
      this.elements.coins.textContent = String(coins);
      this.elements.total.textContent = String(total);
      return;
    }

    this.elements.total.textContent = String(Math.max(0, total - coins));
    this.countUp(survivors, peak, coins, total);
    if (view.firstClear) replay(this.elements.badge, 'result__badge--pop');
  }

  stop(): void {
    if (this.raf === null) return;
    cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  /**
   * Two rolls, one after the other: the run's numbers, then its pay. Ticks are
   * throttled to the ear rather than to the frame — a 400-unit peak counting up
   * at 60 fps would be a buzz, not a count — and the second roll's tick is the
   * same gate click pitched up, which is what makes coins sound like coins.
   */
  private countUp(survivors: number, peak: number, coins: number, total: number): void {
    const start = typeof performance === 'undefined' ? 0 : performance.now();
    const countMs = COUNT_UP_SECONDS * 1000;
    const coinsMs = COINS_UP_SECONDS * 1000;

    let lastCountTick = start;
    let lastCoinTick = start;
    let shownSurvivors = -1;
    let shownPeak = -1;
    let shownCoins = -1;

    const step = (time: number): void => {
      const elapsed = time - start;
      // Ease out: fast at the start, so the last few numbers are readable.
      const t = Math.min(1, elapsed / countMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextSurvivors = Math.round(survivors * eased);
      const nextPeak = Math.round(peak * eased);

      if (nextSurvivors !== shownSurvivors) {
        shownSurvivors = nextSurvivors;
        this.elements.survivors.textContent = String(nextSurvivors);
      }
      if (nextPeak !== shownPeak) {
        shownPeak = nextPeak;
        this.elements.peak.textContent = String(nextPeak);
        if (time - lastCountTick >= COUNT_TICK_MS) {
          lastCountTick = time;
          this.callbacks.onCountTick();
        }
      }

      const coinT = Math.min(1, Math.max(0, (elapsed - countMs) / coinsMs));
      const coinEased = 1 - Math.pow(1 - coinT, 3);
      const nextCoins = Math.round(coins * coinEased);
      if (nextCoins !== shownCoins) {
        shownCoins = nextCoins;
        this.elements.coins.textContent = String(nextCoins);
        // The purse follows the coins up, so the two numbers agree the whole
        // way rather than only at the end.
        this.elements.total.textContent = String(total - coins + nextCoins);
        if (time - lastCoinTick >= COIN_TICK_MS) {
          lastCoinTick = time;
          this.callbacks.onCoinTick();
        }
      }

      if (t >= 1 && coinT >= 1) {
        this.raf = null;
        return;
      }
      this.raf = requestAnimationFrame(step);
    };

    this.elements.survivors.textContent = '0';
    this.elements.peak.textContent = '0';
    this.elements.coins.textContent = '0';
    this.raf = requestAnimationFrame(step);
  }
}
