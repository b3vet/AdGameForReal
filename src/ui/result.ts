/**
 * The result sheet: what the run paid, what survived, and the way out.
 *
 * Milestone 4 puts coins on it (D33), which is the screen's new headline: the
 * run's whole point on the meta layer is the purse it fills, so the coins roll
 * up — with their own bright tick — and the purse climbs with them. The purse
 * is the coin chip in the corner now (`./coinChip.ts`, docs/28) rather than a
 * line of the sheet's own, so the number the player watches fill here is the
 * one they will spend from on the next screen. A first clear says so with a
 * badge, because the bonus it carries is four times the ordinary one and that
 * should be visible.
 *
 * Three ways out (docs/28): Continue after a clear, Retry, and Home. Retry is
 * one button on an endless sheet as well — the "same road" and "again" pair it
 * replaced never walked different roads (`RunStage.replay`).
 *
 * Split out of `./overlay.ts` when the Academy arrived: the overlay is about
 * which screen is up, and this is one screen's numbers.
 */

import { academy, fill } from '@/data/academy-types';

import type { CoinChip } from './coinChip';
import { requireElement } from './dom';
import { ResultMeta } from './resultMeta';
import type { ResultMetaElements } from './resultMeta';
import { replay } from './widgets';

import './result.css';
import './resultLayout.css';

/** One coin line under the count-up: where it came from and what it paid. */
export interface ResultBonus {
  text: string;
  coins: number;
  /** A second line under it — the tint a bestiary rung handed over (D53). */
  note?: string;
}

export interface ResultView {
  levelIndex: number;
  won: boolean;
  survivors: number;
  peakCount: number;
  /** Coins the road itself paid, from `runRewards`. */
  coins: number;
  /**
   * Coins this run paid altogether: the road plus every bonus under it. This
   * is what the count-up rolls, because it is exactly what the purse gained.
   */
  earnedCoins: number;
  /** The purse afterwards, which the coin chip climbs to. */
  totalCoins: number;
  /** True when this run was the first clear of the level. */
  firstClear: boolean;
  /** False on the last level, and on the endless road, which has no next. */
  canAdvance: boolean;
  /** True for a walk of the endless road (D52): metres instead of a level. */
  endless: boolean;
  metres: number;
  bestMetres: number;
  endlessBest: boolean;
  /** The coin lines under the count-up (D51 to D53). */
  bonuses: readonly ResultBonus[];
  /** Missions this run finished, for the ticks among those lines. */
  missions: readonly { text: string; reward: number }[];
  /** This level's best walk after the run, or null for an endless one. */
  best: { survivors: number; peak: number } | null;
  bestImproved: boolean;
  /** Whether that best walk earns the picker's star. */
  star: boolean;
}

export interface ResultElements extends ResultMetaElements {
  /** The banner the verdict rides in on; `data-won` picks its colour. */
  ribbon: HTMLElement;
  kicker: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  survivors: HTMLElement;
  peak: HTMLElement;
  coins: HTMLElement;
  /** Continue, Retry and Home; the ids are a contract with the smoke. */
  advance: HTMLButtonElement;
  retry: HTMLButtonElement;
  home: HTMLButtonElement;
}

/** The sheet's elements in `index.html`, by the ids the markup gives them. */
export function resultElements(root: ParentNode): ResultElements {
  return {
    ribbon: requireElement(root, '#result-ribbon'),
    kicker: requireElement(root, '#result-kicker'),
    title: requireElement(root, '#result-title'),
    badge: requireElement(root, '#result-first-clear'),
    survivors: requireElement(root, '#result-survivors'),
    peak: requireElement(root, '#result-peak'),
    coins: requireElement(root, '#result-coins'),
    advance: requireElement<HTMLButtonElement>(root, '#next-button'),
    retry: requireElement<HTMLButtonElement>(root, '#retry-button'),
    home: requireElement<HTMLButtonElement>(root, '#home-button'),
    metresRow: requireElement(root, '#result-metres-row'),
    metres: requireElement(root, '#result-metres'),
    bestMetres: requireElement(root, '#result-best-metres'),
    bonuses: requireElement(root, '#result-bonuses'),
    best: requireElement(root, '#result-best'),
  };
}

export interface ResultCallbacks {
  /** One step of the survivors and peak roll-up. */
  onCountTick: () => void;
  /** One step of the coin roll-up; a brighter click. */
  onCoinTick: () => void;
}

/**
 * Whether the player has asked their system for less movement. Read per result
 * rather than once: a preference can change while the game is open, and this is
 * one call on a screen that appears at most once a minute.
 */
function reducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** How long each roll takes, and the gap between two ticks of it. */
const COUNT_UP_SECONDS = 0.7;
const COINS_UP_SECONDS = 0.6;
const COUNT_TICK_MS = 55;
const COIN_TICK_MS = 45;

/** What the sheet asks of the coin chip: a frame of the roll, and the landing. */
export type ResultPurse = Pick<CoinChip, 'roll' | 'bump'>;

export class ResultPanel {
  private readonly elements: ResultElements;
  private readonly callbacks: ResultCallbacks;
  private readonly purse: ResultPurse;
  /** The lists under the numbers (`./resultMeta.ts`). */
  private readonly meta: ResultMeta;

  private raf: number | null = null;

  constructor(elements: ResultElements, callbacks: ResultCallbacks, purse: ResultPurse) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.purse = purse;
    this.meta = new ResultMeta(elements);
    // The markup carries placeholders; the words are the data's. Plain words
    // rather than the epic register: "Ascend" read as a mechanic the player
    // had not met yet rather than as the next level (docs/28).
    elements.advance.textContent = academy.result.continue;
    elements.retry.textContent = academy.result.retry;
    elements.home.textContent = academy.result.home;
  }

  /**
   * The verdict is in the epic register (docs/06-milestone-2-plan.md) and cut
   * to the shortest phrase that still says it: a win is a slaughter and a loss
   * is being overwhelmed.
   */
  show(view: ResultView): void {
    const survivors = Math.max(0, Math.round(view.survivors));
    const peak = Math.max(0, Math.round(view.peakCount));
    const coins = Math.max(0, Math.round(view.earnedCoins));
    const total = Math.max(0, Math.round(view.totalCoins));

    this.meta.show(view);
    this.elements.kicker.textContent = view.won ? 'Horde slain' : 'Overwhelmed';
    // Gold for a clear, crimson for a loss, and the slide replayed either way:
    // the screen is otherwise a still image, and the banner is what says the
    // run is over before a single number has been read.
    this.elements.ribbon.dataset['won'] = view.won ? 'true' : 'false';
    replay(this.elements.ribbon, 'ribbon--in');
    // An endless run has no level number to print (D52), and its verdict is
    // always the wipe or the road's end rather than a horde slain.
    this.elements.title.textContent = view.endless
      ? academy.meta.result.endlessTitle
      : `Level ${String(view.levelIndex)}`;
    if (view.endless) {
      this.elements.kicker.textContent = fill(academy.meta.endless.hudLabel, {
        metres: String(view.metres),
      });
    }
    this.elements.badge.textContent = academy.result.firstClear;
    this.elements.badge.hidden = !(view.won && view.firstClear);
    this.elements.advance.hidden = !(view.won && view.canAdvance);
    // Always offered, unlike Milestone 3's "Levels": the Academy is where the
    // coins this run just paid are spent, so a won run must not be able to
    // funnel the player straight into the next level with no way to the shop.
    this.elements.home.hidden = false;

    this.stop();
    // A count-up is motion, and a player who has asked for less of it gets the
    // numbers rather than the roll — the ticks and the bump that go with it too.
    if (reducedMotion()) {
      this.elements.survivors.textContent = String(survivors);
      this.elements.peak.textContent = String(peak);
      this.elements.coins.textContent = String(coins);
      this.purse.roll(total);
      return;
    }

    // The purse starts where the run found it and climbs with the coins.
    this.purse.roll(total - coins);
    // A lost run is still not a moment for a fanfare of numbers — the survivors
    // and the peak are simply there — but it *pays* now (D46, 30 percent of the
    // road walked), and the purse filling is the one thing on this screen a
    // player who has just been overwhelmed is owed a beat for. So the loss
    // skips the first roll and keeps the second.
    this.countUp(survivors, peak, coins, total, view.won);
    if (view.won && view.firstClear) replay(this.elements.badge, 'result__badge--pop');
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
   *
   * `rollCounts` false is the loss: the survivors and the peak are written once
   * and the coins still roll, straight away rather than after a roll that is
   * not happening.
   */
  private countUp(
    survivors: number,
    peak: number,
    coins: number,
    total: number,
    rollCounts: boolean,
  ): void {
    const start = typeof performance === 'undefined' ? 0 : performance.now();
    const countMs = rollCounts ? COUNT_UP_SECONDS * 1000 : 0;
    const coinsMs = COINS_UP_SECONDS * 1000;

    let lastCountTick = start;
    let lastCoinTick = start;
    // Already shown when there is no roll, so the first frame neither rewrites
    // them nor clicks for a count nobody watched.
    let shownSurvivors = rollCounts ? -1 : survivors;
    let shownPeak = rollCounts ? -1 : peak;
    let shownCoins = -1;

    const step = (time: number): void => {
      const elapsed = time - start;
      // Ease out: fast at the start, so the last few numbers are readable.
      const t = countMs === 0 ? 1 : Math.min(1, elapsed / countMs);
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
        this.purse.roll(total - coins + nextCoins);
        if (time - lastCoinTick >= COIN_TICK_MS) {
          lastCoinTick = time;
          this.callbacks.onCoinTick();
        }
      }

      if (t >= 1 && coinT >= 1) {
        this.raf = null;
        // One bump when the coins land, the beat a roll of silent frames owes
        // the purse; a run that paid nothing has nothing to announce.
        if (coins > 0) this.purse.bump();
        return;
      }
      this.raf = requestAnimationFrame(step);
    };

    this.elements.survivors.textContent = String(rollCounts ? 0 : survivors);
    this.elements.peak.textContent = String(rollCounts ? 0 : peak);
    this.elements.coins.textContent = '0';
    this.raf = requestAnimationFrame(step);
  }
}
