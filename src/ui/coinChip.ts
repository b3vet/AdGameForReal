/**
 * The coin chip: one purse for every screen that is not a run (docs/28).
 *
 * It used to be three. The Academy home had a chip that bumped, each room had
 * a copy of it that did not, and the result sheet had a "Purse" line of its
 * own — so the same number sat in three places at three sizes, and the one the
 * player was looking at after a purchase was the one that never moved. Now it
 * is one element outside the screens (`#purse-bar` in `index.html`), pinned
 * under the safe area in the top-left corner, and the overlay shows it on the
 * home, the picker, the rooms and the result sheet. It is not on the run's HUD,
 * where the level chip has that corner, nor under the pause menu that covers
 * the HUD.
 *
 * Being one element is what keeps it from jumping between screens: there is no
 * second copy whose place or size could drift from the first. The screens make
 * room for it rather than the other way round (`./coinChip.css`).
 *
 * Two ways to write the number. `set` is a change the player caused — a
 * purchase, a reward arriving on the home — and bumps. `roll` is one frame of
 * the result sheet's count-up (`./result.ts`) and never does: a bump is a
 * forced layout (`replay`), and forty of those in a row is a buzz rather than
 * a beat. The sheet asks for one `bump` when its roll lands instead.
 */

import { replay } from './widgets';

import './coinChip.css';

export interface CoinChipElements {
  /** The bar the chip stands in; hidden on the HUD. */
  bar: HTMLElement;
  /** The number, which is what bumps. */
  value: HTMLElement;
}

const BUMP = 'coins__value--bump';

export class CoinChip {
  private readonly elements: CoinChipElements;
  /** What the chip reads now; -1 before the first paint. */
  private shown = -1;

  constructor(elements: CoinChipElements) {
    this.elements = elements;
  }

  /** On every screen switch: the chip is up unless a run is. */
  setVisible(visible: boolean): void {
    if (this.elements.bar.hidden === !visible) return;
    this.elements.bar.hidden = !visible;
  }

  /**
   * The purse. It bumps whenever the number actually moves, but never on the
   * first paint of the session, where there is no change to announce.
   */
  set(coins: number): void {
    const first = this.shown < 0;
    if (!this.write(coins)) return;
    if (!first) this.bump();
  }

  /**
   * One frame of a count-up. Called every frame the sheet's number moves, so it
   * writes only when the figure changes and never animates.
   */
  roll(coins: number): void {
    this.write(coins);
  }

  bump(): void {
    replay(this.elements.value, BUMP);
  }

  /** Writes the figure if it changed; answers whether it did. */
  private write(coins: number): boolean {
    const value = Math.max(0, Math.round(coins));
    if (value === this.shown) return false;
    this.shown = value;
    this.elements.value.textContent = String(value);
    return true;
  }
}
