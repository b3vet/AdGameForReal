/**
 * The Academy's rooms: the Training Yard, the Workbench, the Sanctum (D33), the
 * Bestiary (D33, D53) and the Wardrobe (D53).
 *
 * The two that grew past a list of rows have files of their own —
 * `./bestiary.ts` for the kill ladders and `./wardrobe.ts` for the tint chips —
 * and this file keeps the shell and the three rooms that are still a list of
 * priced rows.
 *
 * All of them share one screen — heading, coin chip, Back — and only the body
 * swaps, so a room is a list that is built on its first visit and re-painted
 * from a `PlayerState` on every later one. Nothing here owns state: `App`
 * makes the purchase, writes the save and calls `show` again with the new
 * player, which is what keeps the price, the coins and the button's enabled
 * state from ever disagreeing.
 *
 * Prices and effects come from `@/core/player` (the plan's `progression.json`
 * once the sim track lands it) and every word comes from
 * `src/data/academy.json`.
 */

import {
  familiarCost,
  familiarUnlocked,
  maxFamiliarTier,
  maxStaffTier,
  maxUpgradeLevel,
  roomUnlockLevel,
  staffCost,
  upgradeCost,
  upgradeEffect,
  upgradeIds,
} from '@/core/player';
import type { PlayerState, RoomId, UpgradeId } from '@/core/player';
import { academy, fill } from '@/data/academy-types';
import { cosmetics } from '@/data';
import { staffTierOf, weaponIds } from '@/sim';
import type { CosmeticSlot } from '@/data';
import type { WeaponId } from '@/sim';

import type { BindButton } from './academy';
import { BestiaryRoom } from './bestiary';
import { icon, staffIcon, upgradeIcon } from './icons';
import { Wardrobe } from './wardrobe';
import { amount, element, priceButton, replay, setPrice, text } from './widgets';

export interface RoomElements {
  title: HTMLElement;
  subtitle: HTMLElement;
  coinValue: HTMLElement;
  yard: HTMLElement;
  workbench: HTMLElement;
  sanctum: HTMLElement;
  bestiary: HTMLElement;
  wardrobe: HTMLElement;
}

export interface RoomCallbacks {
  onBuyUpgrade: (id: UpgradeId) => void;
  /** Unlocks a locked staff, or evolves an unlocked one by one tier (D54). */
  onBuyStaff: (id: WeaponId) => void;
  onSelectStaff: (id: WeaponId) => void;
  /** Binds the wisp, or raises its tier by one. */
  onBuyFamiliar: () => void;
  /** A tint chip in the Wardrobe (D53). */
  onSelectCosmetic: (slot: CosmeticSlot, id: string) => void;
}

/** What just changed, so the row that changed can bump. */
export type RoomBump =
  | { kind: 'upgrade'; id: UpgradeId }
  | { kind: 'staff'; id: WeaponId }
  | { kind: 'familiar' };

interface YardRow {
  root: HTMLElement;
  level: HTMLElement;
  buy: HTMLButtonElement;
  price: HTMLElement;
}

interface StaffRow {
  root: HTMLElement;
  tag: HTMLElement;
  /** One line per evolution rung, greyed until the staff reaches it (D54). */
  tiers: HTMLElement[];
  buy: HTMLButtonElement;
  price: HTMLElement;
  select: HTMLButtonElement;
}

interface FamiliarRow {
  root: HTMLElement;
  buy: HTMLButtonElement;
  price: HTMLElement;
  line: HTMLElement;
}

const BUMP = 'row--bump';

export class Rooms {
  private readonly elements: RoomElements;
  private readonly callbacks: RoomCallbacks;
  private readonly bind: BindButton;

  private readonly yardRows = new Map<UpgradeId, YardRow>();
  private readonly staffRows = new Map<WeaponId, StaffRow>();
  /** The two rooms with bodies of their own (see the file's note). */
  private readonly bestiary: BestiaryRoom;
  private readonly wardrobe: Wardrobe;
  private familiarRow: FamiliarRow | null = null;

  private shownCoins = -1;

  constructor(elements: RoomElements, callbacks: RoomCallbacks, bind: BindButton) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.bind = bind;
    this.bestiary = new BestiaryRoom({ root: elements.bestiary, subtitle: elements.subtitle });
    this.wardrobe = new Wardrobe(
      { root: elements.wardrobe },
      { onSelectCosmetic: callbacks.onSelectCosmetic },
      bind,
    );
  }

  /** Opens a room, building its body the first time it is asked for. */
  show(room: RoomId, player: PlayerState, bump: RoomBump | null = null): void {
    const bodies: readonly [RoomId, HTMLElement][] = [
      ['yard', this.elements.yard],
      ['workbench', this.elements.workbench],
      ['sanctum', this.elements.sanctum],
      ['bestiary', this.elements.bestiary],
      ['wardrobe', this.elements.wardrobe],
    ];
    for (const [id, body] of bodies) body.hidden = id !== room;

    switch (room) {
      case 'yard':
        this.elements.title.textContent = academy.yard.heading;
        this.buildYard();
        this.paintYard(player, bump);
        break;
      case 'workbench':
        this.elements.title.textContent = academy.workbench.heading;
        this.buildWorkbench();
        this.paintWorkbench(player, bump);
        break;
      case 'sanctum':
        this.elements.title.textContent = academy.sanctum.heading;
        this.buildSanctum();
        this.paintSanctum(player, bump);
        break;
      case 'bestiary':
        this.elements.title.textContent = academy.bestiary.heading;
        this.bestiary.show(player);
        break;
      case 'wardrobe':
        this.elements.title.textContent = cosmetics.wardrobe.heading;
        this.elements.subtitle.textContent = '';
        this.wardrobe.show(player);
        break;
      default:
        // `play` is a door to the picker, not a room with a body.
        break;
    }

    this.setCoins(player.coins);
  }

  setCoins(coins: number): void {
    const value = Math.max(0, Math.round(coins));
    if (value === this.shownCoins) return;
    this.shownCoins = value;
    this.elements.coinValue.textContent = String(value);
  }

  // --- Training Yard -------------------------------------------------------

  private buildYard(): void {
    if (this.yardRows.size > 0) return;
    for (const copy of academy.yard.upgrades) {
      const id = upgradeIds.find((known) => known === copy.id);
      if (id === undefined) continue;

      const root = element('div', 'row frame frame--card');
      const head = element('div', 'row__head');
      head.append(icon(upgradeIcon(id), 'row__icon'), text('span', 'row__name', copy.name));
      const level = text('span', 'row__level', '');
      head.append(level);

      const effect = text(
        'p',
        'row__effect',
        fill(copy.effect, { value: amount(upgradeEffect(id), copy.unit) }),
      );

      const { button, price } = priceButton();
      this.bind(button, () => {
        this.callbacks.onBuyUpgrade(id);
      });

      root.append(head, effect, button);
      this.elements.yard.append(root);
      this.yardRows.set(id, { root, level, buy: button, price });
    }
  }

  private paintYard(player: PlayerState, bump: RoomBump | null): void {
    this.elements.subtitle.textContent = '';
    for (const [id, row] of this.yardRows) {
      const cost = upgradeCost(player, id);
      row.level.textContent = fill(academy.yard.levelLabel, {
        level: String(player.upgrades[id]),
        max: String(maxUpgradeLevel),
      });
      setPrice(row.buy, row.price, cost, player.coins);
      if (bump !== null && bump.kind === 'upgrade' && bump.id === id) replay(row.root, BUMP);
    }
  }

  // --- Workbench -----------------------------------------------------------

  private buildWorkbench(): void {
    if (this.staffRows.size > 0) return;
    for (const copy of academy.workbench.staffs) {
      const id = weaponIds.find((known) => known === copy.id);
      if (id === undefined) continue;

      const root = element('div', 'row row--card frame frame--card');
      root.dataset['staff'] = id;
      const head = element('div', 'row__head');
      head.append(icon(staffIcon(id), 'row__icon'), text('span', 'row__name', copy.name));
      const tag = text('span', 'row__level', '');
      head.append(tag);

      const blurb = text('p', 'row__effect', copy.blurb);
      // One line per evolution, so the whole ladder is visible from tier 1:
      // what the next rung buys, and what the two after it will.
      const tiers: HTMLElement[] = [];
      const ladder = element('div', 'row__ladder');
      for (const [index, tier] of copy.tiers.entries()) {
        const line = element('p', 'row__effect row__effect--tier');
        line.append(
          text('span', 'row__tiername', tier.name),
          text('span', 'row__tierline', tier.line),
        );
        // Staff tier 2 is the first evolution, so a rung's index is one behind.
        line.dataset['tier'] = String(index + 2);
        ladder.append(line);
        tiers.push(line);
      }

      const actions = element('div', 'row__actions');
      const { button, price } = priceButton();
      this.bind(button, () => {
        this.callbacks.onBuyStaff(id);
      });
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'button button--ghost button--row';
      this.bind(select, () => {
        this.callbacks.onSelectStaff(id);
      });
      actions.append(button, select);

      root.append(head, blurb, ladder, actions);
      this.elements.workbench.append(root);
      this.staffRows.set(id, { root, tag, tiers, buy: button, price, select });
    }
  }

  private paintWorkbench(player: PlayerState, bump: RoomBump | null): void {
    this.elements.subtitle.textContent = '';
    for (const [id, row] of this.staffRows) {
      const staff = player.staffs[id];
      const cost = staffCost(player, id);
      const selected = player.selectedStaff === id;
      const tier = staffTierOf(player, id);

      row.root.dataset['locked'] = staff.unlocked ? 'false' : 'true';
      // The rung the staff stands on, out of four (D54). A locked staff has no
      // tier to print, and the badge stays what it always was: evolved at all.
      row.tag.textContent = !staff.unlocked
        ? academy.workbench.lockedTier
        : fill(academy.workbench.tierLabel, {
            tier: String(tier),
            max: String(maxStaffTier),
          });
      for (const [index, line] of row.tiers.entries()) {
        // Lit once the staff has reached the rung this line describes; the next
        // one is flagged too, because it is the one the price below buys.
        line.dataset['active'] = tier >= index + 2 ? 'true' : 'false';
        line.dataset['next'] = tier === index + 1 ? 'true' : 'false';
      }

      // Buying is unlocking while it is locked and evolving once it is not;
      // at tier 4 there is nothing left to sell.
      row.buy.hidden = cost === null;
      setPrice(
        row.buy,
        row.price,
        cost,
        player.coins,
        staff.unlocked ? academy.buttons.evolve : academy.buttons.unlock,
      );

      row.select.hidden = !staff.unlocked;
      row.select.disabled = selected;
      row.select.textContent = selected ? academy.buttons.selected : academy.buttons.select;
      row.select.setAttribute('aria-pressed', selected ? 'true' : 'false');

      if (bump !== null && bump.kind === 'staff' && bump.id === id) replay(row.root, BUMP);
    }
  }

  // --- Sanctum -------------------------------------------------------------

  private buildSanctum(): void {
    if (this.familiarRow !== null) return;
    const copy = academy.sanctum;

    const root = element('div', 'row row--card frame frame--card');
    const head = element('div', 'row__head');
    head.append(icon('wisp', 'row__icon'), text('span', 'row__name', copy.name));
    root.append(head, text('p', 'row__effect', copy.blurb));

    const line = text('p', 'row__effect row__effect--tier2', copy.tiers[0] ?? '');
    const { button, price } = priceButton();
    this.bind(button, () => {
      this.callbacks.onBuyFamiliar();
    });
    root.append(line, button);
    this.elements.sanctum.append(root);
    this.familiarRow = { root, buy: button, price, line };
  }

  private paintSanctum(player: PlayerState, bump: RoomBump | null): void {
    const row = this.familiarRow;
    if (row === null) return;
    const copy = academy.sanctum;
    const open = familiarUnlocked(player);
    const tier = player.familiar.tier;

    this.elements.subtitle.textContent = open
      ? fill(copy.tierLabel, {
          tier: String(tier),
          max: String(maxFamiliarTier),
        })
      : fill(academy.home.lockedHint, { level: String(roomUnlockLevel('sanctum')) });

    // The next tier's promise while there is one, the current one's once the
    // wisp is as strong as it gets.
    const lineIndex = Math.min(copy.tiers.length - 1, Math.max(0, tier));
    row.line.textContent = copy.tiers[lineIndex] ?? '';
    row.line.dataset['active'] = player.familiar.unlocked ? 'true' : 'false';
    row.root.dataset['locked'] = open ? 'false' : 'true';

    setPrice(
      row.buy,
      row.price,
      familiarCost(player),
      player.coins,
      player.familiar.unlocked ? academy.buttons.empower : academy.buttons.bind,
    );
    // A shut Sanctum still shows its card and the wisp's price, greyed: the
    // player should be able to see what level 8 is for, and what it will cost.
    if (!open) row.buy.disabled = true;

    if (bump !== null && bump.kind === 'familiar') replay(row.root, BUMP);
  }
}
