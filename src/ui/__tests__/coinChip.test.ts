/**
 * The coin chip's two ways of writing the purse (`src/ui/coinChip.ts`,
 * docs/28).
 *
 * The rules are small and easy to break without noticing on screen: a purchase
 * bumps, the first paint of a session does not, a frame of the result sheet's
 * count-up never does (a bump is a forced layout), and the home that follows a
 * sheet whose roll has landed has nothing new to announce. The Vitest
 * environment is `node` with no DOM, so the two elements are fakes that count
 * what was done to them.
 */

import { describe, expect, it } from 'vitest';

import { CoinChip } from '../coinChip';

interface FakeValue {
  textContent: string;
  writes: number;
  bumps: number;
}

function fakeChip(): { chip: CoinChip; bar: { hidden: boolean }; value: FakeValue } {
  const bar = { hidden: true };
  const state: FakeValue = { textContent: '', writes: 0, bumps: 0 };
  const value = {
    get textContent(): string {
      return state.textContent;
    },
    set textContent(next: string) {
      state.textContent = next;
      state.writes++;
    },
    // `replay` takes the class off, reads a layout property, and puts it back;
    // the add is what a bump is.
    classList: {
      remove: (): void => undefined,
      add: (): void => {
        state.bumps++;
      },
    },
    offsetWidth: 0,
  };
  const chip = new CoinChip({
    bar: bar as unknown as HTMLElement,
    value: value as unknown as HTMLElement,
  });
  return { chip, bar, value: state };
}

describe('CoinChip', () => {
  it('paints the first purse without a bump', () => {
    const { chip, value } = fakeChip();
    chip.set(6000);
    expect(value.textContent).toBe('6000');
    expect(value.bumps).toBe(0);
  });

  it('bumps when a purchase moves the purse, and not when it stays', () => {
    const { chip, value } = fakeChip();
    chip.set(6000);
    chip.set(6000);
    expect(value.writes).toBe(1);
    chip.set(4160);
    expect(value.textContent).toBe('4160');
    expect(value.bumps).toBe(1);
  });

  it('rolls without bumping and writes only when the figure changes', () => {
    const { chip, value } = fakeChip();
    chip.set(3335);
    for (const frame of [3335, 3335, 3400.4, 3400, 5000, 6000]) chip.roll(frame);
    expect(value.textContent).toBe('6000');
    expect(value.writes).toBe(4);
    expect(value.bumps).toBe(0);
    chip.bump();
    expect(value.bumps).toBe(1);
  });

  it('has nothing to announce on the home after a roll has landed', () => {
    const { chip, value } = fakeChip();
    chip.set(3335);
    chip.roll(6000);
    chip.set(6000);
    expect(value.bumps).toBe(0);
  });

  it('never shows a negative purse', () => {
    const { chip, value } = fakeChip();
    chip.roll(-40);
    expect(value.textContent).toBe('0');
  });

  it('is shown and hidden by the overlay', () => {
    const { chip, bar } = fakeChip();
    chip.setVisible(true);
    expect(bar.hidden).toBe(false);
    chip.setVisible(false);
    expect(bar.hidden).toBe(true);
  });
});
