/**
 * The result sheet's Milestone 8 rows: what the run paid on top of the road,
 * what it finished, how it compares with the player's best walk of this level,
 * and what the purse is now within reach of.
 *
 * Split out of `./result.ts` for the file-size rule (CLAUDE.md), on the seam
 * the sheet has: `result.ts` owns the verdict and the two count-ups — the
 * moving parts — and this owns the lists under them, which are written once
 * per run and then sit still.
 *
 * Every line is dropped rather than zeroed when it has nothing to say: a sheet
 * that always shows an empty bonus list teaches the player that the list means
 * nothing.
 */

import { academy, fill } from '@/data/academy-types';

import { icon } from './icons';
import { nextUnlock } from './nextUnlock';
import type { ResultView } from './result';
import { element, text } from './widgets';

import './resultMeta.css';

export interface ResultMetaElements {
  /** The metres row, shown for an endless run in place of the level (D52). */
  metresRow: HTMLElement;
  metres: HTMLElement;
  bestMetres: HTMLElement;
  /** The coin lines under the count-up: the streak, missions, bestiary rungs. */
  bonuses: HTMLElement;
  /** This level's best walk, and the star it earned. */
  best: HTMLElement;
  /** The next thing the Academy sells, against the purse. */
  next: HTMLElement;
  nextHeading: HTMLElement;
  nextName: HTMLElement;
  nextPrice: HTMLElement;
  nextShort: HTMLElement;
}

export class ResultMeta {
  private readonly elements: ResultMetaElements;

  constructor(elements: ResultMetaElements) {
    this.elements = elements;
    // The markup carries a placeholder; the words are the data's.
    elements.nextHeading.textContent = academy.meta.result.nextHeading;
  }

  show(view: ResultView): void {
    this.paintMetres(view);
    this.paintBonuses(view);
    this.paintBest(view);
    this.paintNext(view);
  }

  /** Metres and the record, for an endless run; hidden on a campaign one. */
  private paintMetres(view: ResultView): void {
    this.elements.metresRow.hidden = !view.endless;
    if (!view.endless) return;
    const copy = academy.meta.result;
    this.elements.metres.textContent = String(view.metres);
    this.elements.bestMetres.textContent = view.endlessBest
      ? copy.newBestLabel
      : fill(copy.bestMetresLabel, { metres: String(view.bestMetres) });
    this.elements.bestMetres.dataset['new'] = view.endlessBest ? 'true' : 'false';
  }

  /**
   * One line per source of bonus coins, and the mission ticks among them: a
   * finished mission *is* a bonus line, and reading its reward twice — once as
   * a tick and once as a coin line — would be the same fact in two places.
   */
  private paintBonuses(view: ResultView): void {
    const list = this.elements.bonuses;
    list.textContent = '';
    list.hidden = view.bonuses.length === 0;
    if (view.bonuses.length === 0) return;

    list.append(text('h3', 'bonus__heading', academy.meta.result.bonusHeading));
    const missions = new Set(view.missions.map((mission) => mission.text));
    for (const bonus of view.bonuses) {
      const row = element('div', 'bonus');
      // A mission line is ticked: it is the one kind of bonus the player was
      // working towards rather than one that simply happened to them.
      row.dataset['mission'] = missions.has(bonus.text) ? 'true' : 'false';
      const label = text('span', 'bonus__text', bonus.text);
      const coins = element('span', 'bonus__coins');
      coins.append(icon('coin', 'bonus__coin'), text('span', 'bonus__value', String(bonus.coins)));
      row.append(label, coins);
      if (bonus.note !== undefined && bonus.note !== '') {
        row.append(text('p', 'bonus__note', bonus.note));
      }
      list.append(row);
    }
  }

  /** This level's best walk, with the star the picker will show for it. */
  private paintBest(view: ResultView): void {
    const best = view.best;
    const show = !view.endless && best !== null;
    this.elements.best.hidden = !show;
    if (!show || best === null) return;
    const copy = academy.meta.result;
    this.elements.best.textContent = '';
    this.elements.best.append(
      text(
        'span',
        'best__text',
        fill(copy.bestLabel, {
          survivors: String(best.survivors),
          peak: String(best.peak),
        }),
      ),
    );
    if (view.star) this.elements.best.append(icon('star', 'best__star'));
    if (view.bestImproved) {
      this.elements.best.append(text('span', 'best__new', copy.newBestLabel));
    }
    this.elements.best.dataset['improved'] = view.bestImproved ? 'true' : 'false';
  }

  /** The nearest thing the Academy still sells, measured against the purse. */
  private paintNext(view: ResultView): void {
    const next = nextUnlock(view.player);
    this.elements.next.hidden = next === null;
    if (next === null) return;
    this.elements.nextName.textContent = next.name;
    this.elements.nextPrice.textContent = String(next.price);
    this.elements.nextShort.textContent =
      next.missing === 0
        ? academy.buttons.buy
        : fill(academy.meta.result.nextShort, { coins: String(next.missing) });
    this.elements.next.dataset['afford'] = next.missing === 0 ? 'true' : 'false';
  }
}
