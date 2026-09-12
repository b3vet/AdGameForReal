/**
 * The Academy home and the level picker behind its Play card (decision D33).
 *
 * The home is the game's front door: the coin purse, the wordmark, and five
 * cards over the dressed road. A card the player has not earned yet shows the
 * level that opens it instead of its blurb, and the first time it *does* open
 * it plays a one-shot reveal — once ever, because `App` writes the reveal to
 * the save as soon as it has been asked for.
 *
 * Copy, card order and unlock levels are `src/data/academy.json`; nothing in
 * here says a word of English or knows a price. The rooms themselves are
 * `./rooms.ts`; this file is the door and the corridor.
 *
 * Ids are a contract with `scripts/smoke-run.mjs`, which clicks `#academy-play`
 * and then `#play-button`. The screen keeps the old `#title-screen` id so every
 * other reference to "the first screen" still resolves.
 */

import type { RoomId } from '@/core/player';
import { academy, fill } from '@/data/academy-types';

import { replay } from './widgets';

/** How many level chips a page of the picker holds (plan: two pages of ten). */
const PAGE_SIZE = 10;

export interface AcademyView {
  coins: number;
  unlockedLevel: number;
  levelCount: number;
  selectedLevel: number;
  /** Rooms that just became available; each plays its reveal once. */
  reveal: readonly RoomId[];
}

export interface AcademyElements {
  cards: HTMLElement;
  coinValue: HTMLElement;
  picker: HTMLElement;
  caption: HTMLElement;
  pager: HTMLElement;
}

/** Everything the home and the picker hand back to the app. */
export interface AcademyCallbacks {
  onOpenRoom: (room: RoomId) => void;
  onSelectLevel: (level: number) => void;
}

/** Wires a button so the tap sound plays before the button's own action. */
export type BindButton = (button: HTMLButtonElement, action: () => void) => void;

export class Academy {
  private readonly elements: AcademyElements;
  private readonly callbacks: AcademyCallbacks;
  private readonly bind: BindButton;

  /** One card per room, in `academy.json` order, built once. */
  private readonly cards = new Map<RoomId, HTMLButtonElement>();
  private readonly cardHints = new Map<RoomId, HTMLElement>();

  private readonly chips: HTMLButtonElement[] = [];
  private readonly pageButtons: HTMLButtonElement[] = [];

  private page = 0;
  private shownCoins = -1;
  /** The last view the picker was painted with, so a page tap can repaint. */
  private view: AcademyView | null = null;

  constructor(elements: AcademyElements, callbacks: AcademyCallbacks, bind: BindButton) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.bind = bind;
    this.buildCards();
  }

  /** Paints the home: coins, which cards are open, and any reveal owed. */
  showHome(view: AcademyView): void {
    this.setCoins(view.coins);
    for (const room of academy.rooms) {
      const id = roomId(room.id);
      const card = id === null ? undefined : this.cards.get(id);
      if (id === null || card === undefined) continue;

      const open = view.unlockedLevel >= room.unlockLevel;
      card.disabled = !open;
      card.dataset['locked'] = open ? 'false' : 'true';
      const hint = this.cardHints.get(id);
      if (hint !== undefined) {
        hint.textContent = open
          ? room.blurb
          : fill(academy.home.lockedHint, { level: String(room.unlockLevel) });
      }
      if (open && view.reveal.includes(id)) replay(card, 'card--reveal');
    }
  }

  /** Paints the picker: the page the selected level is on, chips flagged. */
  showLevels(view: AcademyView): void {
    this.elements.caption.textContent = academy.home.levelsCaption;
    this.buildPicker(view.levelCount);
    this.view = view;
    this.page = Math.min(this.pageButtons.length - 1, pageOf(view.selectedLevel));
    this.paintChips();
  }

  setCoins(coins: number): void {
    const value = Math.max(0, Math.round(coins));
    if (value === this.shownCoins) return;
    this.shownCoins = value;
    this.elements.coinValue.textContent = String(value);
  }

  /** The coin chip bumps when a purchase or a reward changes the purse. */
  bumpCoins(): void {
    replay(this.elements.coinValue, 'coins__value--bump');
  }

  private buildCards(): void {
    for (const room of academy.rooms) {
      const id = roomId(room.id);
      if (id === null) continue;

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `card card--room card--${id}`;
      card.id = `academy-${id}`;
      card.dataset['room'] = id;

      const title = document.createElement('span');
      title.className = 'card__title';
      title.textContent = room.title;

      const hint = document.createElement('span');
      hint.className = 'card__hint';
      hint.textContent = room.blurb;

      card.append(title, hint);
      this.bind(card, () => {
        this.callbacks.onOpenRoom(id);
      });

      this.elements.cards.append(card);
      this.cards.set(id, card);
      this.cardHints.set(id, hint);
    }
  }

  /**
   * Chips and page tabs are created once for a given level count and only
   * re-flagged afterwards; the list only changes when `levels.json` does.
   */
  private buildPicker(levelCount: number): void {
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
    // A single page of ten needs no tabs at all; twenty levels give two.
    this.elements.pager.hidden = pages < 2;
  }

  private paintChips(): void {
    const view = this.view;
    if (view === null) return;

    for (const [slot, chip] of this.chips.entries()) {
      const level = this.page * PAGE_SIZE + slot + 1;
      const exists = level <= view.levelCount;
      chip.hidden = !exists;
      if (!exists) continue;
      chip.dataset['level'] = String(level);
      chip.textContent = String(level);
      chip.setAttribute('aria-label', `Level ${String(level)}`);
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

/** Narrows an id written in JSON to the rooms the app knows. */
function roomId(raw: string): RoomId | null {
  const rooms: readonly RoomId[] = ['play', 'yard', 'workbench', 'sanctum', 'bestiary'];
  return rooms.find((id) => id === raw) ?? null;
}
