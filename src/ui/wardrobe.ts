/**
 * The Wardrobe (D53): four rows of tints, one per slot, each starting with the
 * bare chip.
 *
 * The room is a *view* of the save and nothing else — what the player owns, and
 * which one of each slot they are wearing — so the whole of it is built once
 * and re-painted from a `PlayerState` on every visit, exactly as the other
 * rooms are (`./rooms.ts`). Tapping a chip goes straight out to the app, which
 * writes the save and calls back in with the new player; nothing here decides
 * whether a selection is allowed (`src/core/cosmetics.ts` does).
 *
 * A locked tint is shown rather than hidden, and says what it wants. That is
 * the room's whole job on top of dressing: the Bestiary counts the kills and
 * this is where the player finds out what they are counting *for*.
 *
 * ## Colour
 *
 * A swatch may not carry a literal colour (D36), and a tint is written one of
 * two ways (`src/data/cosmetics-types.ts`). A palette role becomes a
 * `--c-<role>` variable, which is exactly what the generated `palette.css`
 * declares. A multiplier triple becomes three *numbers* on the element, which
 * `rooms.css` multiplies into a palette colour with relative colour syntax —
 * the same arithmetic the renderer does to the material, done by the browser.
 * A browser too old for that syntax drops the declaration and keeps the base
 * swatch, which is a plain chip rather than a wrong colour.
 */

import { wardrobeView } from '@/core/cosmetics';
import type { CosmeticChoiceView } from '@/core/cosmetics';
import type { PlayerState } from '@/core/player';
import type { CosmeticSlot } from '@/data';

import type { BindButton } from './academy';
import { element, text } from './widgets';

export interface WardrobeElements {
  /** The room body the rows are built into. */
  root: HTMLElement;
}

export interface WardrobeCallbacks {
  onSelectCosmetic: (slot: CosmeticSlot, id: string) => void;
}

/** One chip: the swatch, its name, and what it says while it is locked. */
interface ChipParts {
  button: HTMLButtonElement;
  swatch: HTMLElement;
  name: HTMLElement;
  hint: HTMLElement;
}

export class Wardrobe {
  private readonly elements: WardrobeElements;
  private readonly callbacks: WardrobeCallbacks;
  private readonly bind: BindButton;

  /** Every chip, by slot then manifest order; built on the first visit. */
  private readonly chips = new Map<string, ChipParts>();
  private built = false;

  constructor(elements: WardrobeElements, callbacks: WardrobeCallbacks, bind: BindButton) {
    this.elements = elements;
    this.callbacks = callbacks;
    this.bind = bind;
  }

  /** Opens the room, building its rows the first time it is asked for. */
  show(player: PlayerState): void {
    const view = wardrobeView(player);
    if (!this.built) {
      this.built = true;
      for (const slot of view.slots) this.buildRow(slot.id, slot.name, slot.choices);
    }
    for (const slot of view.slots) {
      for (const choice of slot.choices) this.paintChip(slot.id, choice);
    }
  }

  private buildRow(slot: CosmeticSlot, name: string, choices: readonly CosmeticChoiceView[]): void {
    const row = element('div', 'tints frame frame--card');
    row.dataset['slot'] = slot;
    row.append(text('h3', 'tints__name', name));

    const strip = element('div', 'tints__strip');
    for (const choice of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tint';
      button.dataset['cosmetic'] = choice.id;

      const swatch = element('span', 'tint__swatch');
      const label = text('span', 'tint__name', choice.name);
      const hint = text('span', 'tint__hint', '');
      button.append(swatch, label, hint);
      this.bind(button, () => {
        this.callbacks.onSelectCosmetic(slot, choice.id);
      });
      strip.append(button);
      this.chips.set(key(slot, choice.id), { button, swatch, name: label, hint });
    }
    row.append(strip);
    this.elements.root.append(row);
  }

  private paintChip(slot: CosmeticSlot, choice: CosmeticChoiceView): void {
    const parts = this.chips.get(key(slot, choice.id));
    if (parts === undefined) return;

    parts.button.dataset['owned'] = choice.owned ? 'true' : 'false';
    parts.button.setAttribute('aria-pressed', choice.selected ? 'true' : 'false');
    // A locked chip is dead rather than hidden: the hint under it is the whole
    // reason it is on screen.
    parts.button.disabled = !choice.owned;
    parts.name.textContent = choice.name;
    parts.hint.textContent = choice.hint;
    parts.hint.hidden = choice.hint === '';
    paintSwatch(parts.swatch, choice.tint);
  }
}

/** `hat:hatBone` — a chip is only unique within its slot. */
function key(slot: string, id: string): string {
  return `${slot}:${id}`;
}

/**
 * Dresses a swatch in a tint: a palette variable for a role, three multipliers
 * for a triple, and neither for the bare chip (see the file's note on colour).
 */
function paintSwatch(swatch: HTMLElement, tint: string | readonly number[] | null): void {
  swatch.style.removeProperty('--tint-role');
  swatch.style.removeProperty('--tint-r');
  swatch.style.removeProperty('--tint-g');
  swatch.style.removeProperty('--tint-b');

  if (typeof tint === 'string') {
    swatch.dataset['kind'] = 'role';
    // `spell.ember.body` is `--c-spell-ember-body` in the generated palette.
    swatch.style.setProperty('--tint-role', `var(--c-${tint.split('.').join('-')})`);
    return;
  }
  if (tint === null) {
    swatch.dataset['kind'] = 'none';
    return;
  }
  swatch.dataset['kind'] = 'triple';
  swatch.style.setProperty('--tint-r', String(tint[0] ?? 1));
  swatch.style.setProperty('--tint-g', String(tint[1] ?? 1));
  swatch.style.setProperty('--tint-b', String(tint[2] ?? 1));
}
