/**
 * The few DOM helpers the Academy screens share: building an element, a buy
 * button with a coin and a price, and restarting a CSS animation.
 *
 * Split out of `./rooms.ts` to keep that file about rooms and this one about
 * markup — and because `./academy.ts` needs the animation restart too. Nothing
 * here knows a price, a room or a player.
 */

import { academy } from '@/data/academy-types';

export function element(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

export function text(tag: string, className: string, content: string): HTMLElement {
  const node = element(tag, className);
  node.textContent = content;
  return node;
}

/** A buy button: a label, a coin and a price, all three re-written per paint. */
export function priceButton(): { button: HTMLButtonElement; price: HTMLElement } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--row';
  const label = text('span', 'button__label', academy.buttons.buy);
  const coin = element('span', 'coins__icon coins__icon--inline');
  coin.setAttribute('aria-hidden', 'true');
  const price = text('span', 'button__price', '0');
  button.append(label, coin, price);
  return { button, price };
}

/**
 * The one rule every buy button follows: a price it can pay is a live button,
 * a price it cannot is a dead one, and no price at all is "Max" — never a
 * button that looks buyable and does nothing.
 */
export function setPrice(
  button: HTMLButtonElement,
  price: HTMLElement,
  cost: number | null,
  coins: number,
  label: string = academy.buttons.buy,
): void {
  const labelNode = button.firstElementChild;
  const coin = price.previousElementSibling;
  if (cost === null) {
    if (labelNode !== null) labelNode.textContent = academy.buttons.max;
    price.textContent = '';
    if (coin instanceof HTMLElement) coin.hidden = true;
    button.disabled = true;
    return;
  }
  if (labelNode !== null) labelNode.textContent = label;
  price.textContent = String(cost);
  if (coin instanceof HTMLElement) coin.hidden = false;
  button.disabled = coins < cost;
}

/** `0.08` as "8%" or `1` as "1", so no copy repeats a tuning number. */
export function amount(value: number, unit: string): string {
  return unit === 'percent' ? `${String(Math.round(value * 100))}%` : String(value);
}

/** Restarts a CSS animation that may already be running on the element. */
export function replay(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  // Reading a layout property flushes the removal, so re-adding restarts it.
  void node.offsetWidth;
  node.classList.add(className);
}
