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
 * `./rooms.ts`; the corridor behind the Play card is `./picker.ts`; the streak
 * plaque and the missions board that came with Milestone 8 (D51) are
 * `./board.ts`. This file is the door.
 *
 * Ids are a contract with `scripts/smoke-run.mjs`, which clicks `#academy-play`
 * and then `#play-button`. The screen keeps the old `#title-screen` id so every
 * other reference to "the first screen" still resolves.
 */

import { roomUnlockLevel } from '@/core/player';
import type { RoomId } from '@/core/player';
import type { MissionView } from '@/core/missions';
import type { StreakView } from '@/core/streak';
import { academy, fill } from '@/data/academy-types';
import type { WeaponId } from '@/sim';

import { MetaBoard } from './board';
import type { BoardElements } from './board';
import { icon, roomIcon, setIcon } from './icons';
import { Picker } from './picker';
import type { PickerElements } from './picker';
import { element, replay } from './widgets';

export interface AcademyView {
  coins: number;
  unlockedLevel: number;
  levelCount: number;
  selectedLevel: number;
  /** Rooms that just became available; each plays its reveal once. */
  reveal: readonly RoomId[];
  /**
   * The staff the next run starts with. The backdrop crowd is seen from behind,
   * so the only thing on the home screen that can say which staff is in hand is
   * the Workbench card (Milestone 4 Phase C, carried to D).
   */
  selectedStaff: WeaponId;
  /** The daily streak, for the plaque on the home screen (D51). */
  streak: StreakView;
  /** The three missions on the board (D51). */
  missions: readonly MissionView[];
  /** Metres of the best endless walk, for the picker's card (D52). */
  endlessBest: number;
  /** Campaign levels whose best walk earned the picker's star (D53's sibling). */
  stars: readonly number[];
}

export interface AcademyElements extends PickerElements, BoardElements {
  cards: HTMLElement;
  coinValue: HTMLElement;
}

/** Everything the home and the picker hand back to the app. */
export interface AcademyCallbacks {
  onOpenRoom: (room: RoomId) => void;
  onSelectLevel: (level: number) => void;
  /** The picker's Endless card (D52). */
  onEndless: () => void;
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
  /** The card's glyph, which becomes a padlock while the room is shut. */
  private readonly cardIcons = new Map<RoomId, HTMLElement>();
  /** The Workbench card's staff badge; see `AcademyView.selectedStaff`. */
  private staffBadge: HTMLElement | null = null;

  /** The corridor behind the Play card (`./picker.ts`). */
  private readonly picker: Picker;
  /** The streak plaque and the missions board (`./board.ts`). */
  private readonly board: MetaBoard;

  private shownCoins = -1;

  constructor(elements: AcademyElements, callbacks: AcademyCallbacks, bind: BindButton) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.bind = bind;
    this.picker = new Picker(
      elements,
      { onSelectLevel: callbacks.onSelectLevel, onEndless: callbacks.onEndless },
      bind,
    );
    this.board = new MetaBoard(elements);
    this.buildCards();
  }

  /** Paints the home: coins, the streak, the board, and which cards are open. */
  showHome(view: AcademyView): void {
    this.setCoins(view.coins);
    this.paintStaffBadge(view);
    this.board.showStreak(view.streak);
    this.board.showMissions(view.missions);
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
      // A shut room says so twice: the hint names the level, the glyph is a
      // padlock. The icon is re-pointed rather than rebuilt so the reveal
      // animation below has something stable to play on.
      const glyph = this.cardIcons.get(id);
      if (glyph !== undefined) setIcon(glyph, open ? roomIcon(id) : 'lock');
      if (open && view.reveal.includes(id)) replay(card, 'card--reveal');
    }
  }

  /** Paints the picker, which is `./picker.ts`'s from the chips down. */
  showLevels(view: AcademyView): void {
    this.picker.show(view);
  }

  /**
   * The purse. It bumps whenever the number actually moves — a reward on the
   * way back from a run, a purchase in a room — but never on the first paint of
   * the session, where there is no change to announce.
   */
  setCoins(coins: number): void {
    const value = Math.max(0, Math.round(coins));
    if (value === this.shownCoins) return;
    const first = this.shownCoins < 0;
    this.shownCoins = value;
    this.elements.coinValue.textContent = String(value);
    if (!first) replay(this.elements.coinValue, 'coins__value--bump');
  }

  /**
   * The Workbench card's badge. Hidden while the room is shut: a staff the
   * player cannot change yet is not information, and ember is the only one
   * there is until level 5.
   */
  private paintStaffBadge(view: AcademyView): void {
    const badge = this.staffBadge;
    if (badge === null) return;
    const open = view.unlockedLevel >= roomUnlockLevel('workbench');
    badge.hidden = !open;
    if (!open) return;
    const copy = academy.workbench.staffs.find((staff) => staff.id === view.selectedStaff);
    badge.textContent = copy?.name ?? view.selectedStaff;
    badge.dataset['staff'] = view.selectedStaff;
  }

  private buildCards(): void {
    for (const room of academy.rooms) {
      const id = roomId(room.id);
      if (id === null) continue;

      const card = document.createElement('button');
      card.type = 'button';
      // The frame classes are the UI kit's (`./styles.css`): a card is a gold
      // nine-slice around parchment, and Play wears the ornate one.
      card.className = `card card--room card--${id} frame frame--card`;
      card.id = `academy-${id}`;
      card.dataset['room'] = id;

      const glyph = icon(roomIcon(id), 'card__icon');

      const title = document.createElement('span');
      title.className = 'card__title';
      title.textContent = room.title;

      const hint = document.createElement('span');
      hint.className = 'card__hint';
      hint.textContent = room.blurb;

      const body = element('span', 'card__body');
      body.append(title, hint);
      card.append(glyph, body);
      if (id === 'workbench') {
        // Named by the same copy the Workbench itself uses, and coloured by the
        // same three tokens as the HUD's in-run badge, so the staff reads the
        // same on both screens.
        const badge = document.createElement('span');
        badge.className = 'card__badge';
        badge.id = 'academy-staff';
        body.append(badge);
        this.staffBadge = badge;
      }
      this.bind(card, () => {
        this.callbacks.onOpenRoom(id);
      });

      this.elements.cards.append(card);
      this.cards.set(id, card);
      this.cardHints.set(id, hint);
      this.cardIcons.set(id, glyph);
    }
  }

}

/** Narrows an id written in JSON to the rooms the app knows. */
function roomId(raw: string): RoomId | null {
  const rooms: readonly RoomId[] = [
    'play',
    'yard',
    'workbench',
    'sanctum',
    'bestiary',
    'wardrobe',
  ];
  return rooms.find((id) => id === raw) ?? null;
}
