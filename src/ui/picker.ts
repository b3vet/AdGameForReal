/**
 * The level picker behind the Academy's Play card: the chips, Play under
 * them, and the Endless card under that (D52).
 *
 * Split out of `./academy.ts` in Milestone 8 for the file-size rule (CLAUDE.md),
 * on the seam that file already had: the Academy is the *door* — the cards and
 * the board — and this is the corridor, which has two ends. A chip is a
 * campaign level; the Endless card is the road with no level number.
 *
 * The order is the owner's second playtest (docs/28): a first-time player
 * walked straight past the campaign into Endless, which sat above the chips in
 * a gold frame with a gold button of its own. So Play leads now, the loudest
 * thing on the screen, directly under the chips and naming the level it will
 * start; Endless is a quiet card below it, and stays shut until the player has
 * reached the level `academy.json` names — the same rule, and the same drained
 * padlocked look, as a home card that is not open yet.
 *
 * Two marks on a chip, and both are read off the save rather than the level:
 * a **badge** on a milestone level (D45: the ones the upgrades are meant to be
 * bought for), and a **star** on one whose best walk arrived with most of the
 * crowd it ever held. The badge says "this one is meant to be hard" before the
 * level is walked; the star says "and you walked it well" after.
 *
 * Ids are a contract with `scripts/smoke-run.mjs`, which clicks `#play-button`,
 * and with `scripts/probe-safe-area.mjs`, which measures `#picker-endless`.
 */

import './picker.css';

import { endlessUnlockLevel } from '@/core/player';
import { academy, fill } from '@/data/academy-types';
import { levelConfig } from '@/data';

import type { BindButton } from './academy';
import { setIcon } from './icons';
import { element, text } from './widgets';

/** How many level chips a page of the picker holds (plan: two pages of ten). */
const PAGE_SIZE = 10;

export interface PickerElements {
  picker: HTMLElement;
  caption: HTMLElement;
  pager: HTMLElement;
  /** Play's name and the level it starts; the button is bound by the overlay. */
  playTitle: HTMLElement;
  playLevel: HTMLElement;
  /** The Endless card, which is its own button, and what it says. */
  endless: HTMLButtonElement;
  endlessIcon: HTMLElement;
  endlessTitle: HTMLElement;
  endlessBlurb: HTMLElement;
  endlessBest: HTMLElement;
}

/** What the picker needs of the save, filled by `AcademyView`. */
export interface PickerView {
  unlockedLevel: number;
  levelCount: number;
  selectedLevel: number;
  /** Metres of the best endless walk; 0 for a road never taken. */
  endlessBest: number;
  /** Whether this player has reached the level that opens Endless (docs/28). */
  endlessOpen: boolean;
  /** Campaign levels whose best walk earned a star. */
  stars: readonly number[];
}

export interface PickerCallbacks {
  onSelectLevel: (level: number) => void;
  onEndless: () => void;
}

export class Picker {
  private readonly elements: PickerElements;
  private readonly callbacks: PickerCallbacks;
  private readonly bind: BindButton;

  private readonly chips: HTMLButtonElement[] = [];
  private readonly pageButtons: HTMLButtonElement[] = [];

  private page = 0;
  /** The last view painted, so a page tap can repaint without one. */
  private view: PickerView | null = null;

  constructor(elements: PickerElements, callbacks: PickerCallbacks, bind: BindButton) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.bind = bind;
    this.elements.playTitle.textContent = academy.meta.picker.playTitle;
    this.buildEndless();
  }

  /** Paints the picker: the page the selected level is on, chips flagged. */
  show(view: PickerView): void {
    this.elements.caption.textContent = academy.home.levelsCaption;
    this.build(view.levelCount);
    this.view = view;
    this.page = Math.min(this.pageButtons.length - 1, pageOf(view.selectedLevel));
    this.paintChips();
    this.elements.playLevel.textContent = fill(academy.meta.picker.playHint, {
      level: String(view.selectedLevel),
    });
    this.paintEndless(view);
  }

  private buildEndless(): void {
    this.elements.endlessTitle.textContent = academy.meta.endless.title;
    this.bind(this.elements.endless, () => {
      this.callbacks.onEndless();
    });
  }

  /**
   * Open, the card says what the road is and how far the player has walked it.
   * Shut, it says what opens it, as a home card does: the level in the blurb's
   * place and a padlock in the glyph's, drained, and dead to a tap.
   */
  private paintEndless(view: PickerView): void {
    const copy = academy.meta.endless;
    const open = view.endlessOpen;
    const card = this.elements.endless;
    card.disabled = !open;
    card.dataset['locked'] = open ? 'false' : 'true';
    setIcon(this.elements.endlessIcon, open ? 'endless' : 'lock');
    this.elements.endlessBlurb.textContent = open
      ? copy.blurb
      : fill(academy.home.lockedHint, { level: String(endlessUnlockLevel()) });
    let best = '';
    if (open) {
      best =
        view.endlessBest > 0
          ? fill(copy.bestLabel, { metres: String(view.endlessBest) })
          : copy.noBestLabel;
    }
    this.elements.endlessBest.textContent = best;
  }

  /**
   * Chips and page tabs are created once for a given level count and only
   * re-flagged afterwards; the list only changes when `levels.json` does.
   */
  private build(levelCount: number): void {
    const pages = Math.max(1, Math.ceil(levelCount / PAGE_SIZE));
    const slots = Math.min(levelCount, PAGE_SIZE);
    if (this.chips.length === slots && this.pageButtons.length === pages) return;

    this.elements.picker.textContent = '';
    this.elements.pager.textContent = '';
    this.chips.length = 0;
    this.pageButtons.length = 0;

    for (let slot = 0; slot < slots; slot++) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'picker__level';
      // The number, then the two marks. Both are spans rather than pseudo
      // elements so a screen reader can be told what they mean.
      chip.append(text('span', 'picker__number', ''), element('span', 'picker__marks'));
      // The level a chip stands for depends on the page, so the click reads
      // the dataset rather than closing over a number that goes stale.
      this.bind(chip, () => {
        const level = Number(chip.dataset['level']);
        if (Number.isFinite(level)) this.callbacks.onSelectLevel(level);
      });
      this.elements.picker.append(chip);
      this.chips.push(chip);
    }

    for (let page = 0; page < pages; page++) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'pager__tab';
      const first = page * PAGE_SIZE + 1;
      const last = Math.min(levelCount, (page + 1) * PAGE_SIZE);
      tab.textContent = `${String(first)}–${String(last)}`;
      this.bind(tab, () => {
        this.page = page;
        this.paintChips();
      });
      this.elements.pager.append(tab);
      this.pageButtons.push(tab);
    }
    // A single page of ten needs no tabs at all; the forty levels of two
    // biomes (D49) give four.
    this.elements.pager.hidden = pages < 2;
  }

  private paintChips(): void {
    const view = this.view;
    if (view === null) return;
    const copy = academy.meta.picker;

    for (const [slot, chip] of this.chips.entries()) {
      const level = this.page * PAGE_SIZE + slot + 1;
      const exists = level <= view.levelCount;
      chip.hidden = !exists;
      if (!exists) continue;
      const config = levelConfig(level);
      const milestone = config.milestone === true;
      const star = view.stars.includes(level);

      chip.dataset['level'] = String(level);
      // Which biome the level is set in (D49), so the chips for 21 to 40 wear a
      // cold wash and the picker says where the road goes before it is walked.
      // The level recipe is the authority, exactly as it is for the renderer.
      chip.dataset['biome'] = config.biome ?? 'meadow';
      chip.dataset['milestone'] = milestone ? 'true' : 'false';
      chip.dataset['star'] = star ? 'true' : 'false';
      const number = chip.firstElementChild;
      if (number !== null) number.textContent = String(level);
      chip.setAttribute(
        'aria-label',
        fill(star ? copy.starLabel : milestone ? copy.milestoneLabel : copy.levelLabel, {
          level: String(level),
        }),
      );
      chip.disabled = level > view.unlockedLevel;
      chip.setAttribute('aria-pressed', level === view.selectedLevel ? 'true' : 'false');
    }

    for (const [index, tab] of this.pageButtons.entries()) {
      tab.setAttribute('aria-pressed', index === this.page ? 'true' : 'false');
    }
  }
}

/** Which page a level lives on, counting from zero. */
function pageOf(level: number): number {
  return Math.max(0, Math.floor((level - 1) / PAGE_SIZE));
}
