/**
 * The overlay's icon set: which glyph belongs to which room, drill, staff and
 * beast, and how one is put on the page.
 *
 * The glyphs themselves are an SVG sprite at the top of `index.html`, so every
 * icon on every screen is one `<use>` of a shape the document already has —
 * no request, no second copy, and exact at any pixel ratio. This module is the
 * other half: the names, the id-to-icon maps, and the one function that builds
 * a reference.
 *
 * The element is a `<span>` wrapping the `<svg>` rather than a bare `<svg>`.
 * That is deliberate: an `SVGElement` is not an `HTMLElement`, so a bare one
 * fails every `instanceof HTMLElement` guard in `./widgets.ts` and cannot be
 * hidden with `.hidden`. The span also carries the size and the colour, which
 * is what lets a coin be gold in a purse and ink on a button.
 *
 * Ids come from the sim and from `@/core/player`; an id with no icon falls back
 * rather than throwing, because `src/data/academy.json` is allowed to name a
 * room or a beast that the code does not know yet.
 */

export type IconName =
  | 'coin'
  | 'staff-ember'
  | 'staff-storm'
  | 'staff-frost'
  | 'drill-damage'
  | 'drill-fire-rate'
  | 'drill-recruits'
  | 'drill-sigil'
  | 'drill-slayer'
  | 'wisp'
  | 'room-play'
  | 'room-yard'
  | 'room-workbench'
  | 'room-sanctum'
  | 'room-bestiary'
  | 'lock';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The Academy's five doors. */
const ROOM_ICONS: Readonly<Record<string, IconName>> = {
  play: 'room-play',
  yard: 'room-yard',
  workbench: 'room-workbench',
  sanctum: 'room-sanctum',
  bestiary: 'room-bestiary',
};

/** The Training Yard's five drills, by `UpgradeId`. */
const UPGRADE_ICONS: Readonly<Record<string, IconName>> = {
  damage: 'drill-damage',
  fireRate: 'drill-fire-rate',
  startCount: 'drill-recruits',
  gateBonus: 'drill-sigil',
  bossDamage: 'drill-slayer',
};

/** The three staffs, by `WeaponId`. */
const STAFF_ICONS: Readonly<Record<string, IconName>> = {
  ember: 'staff-ember',
  storm: 'staff-storm',
  frost: 'staff-frost',
};

/**
 * The bestiary. A grunt is a skeleton and a brute is a bigger one, so both take
 * the slayer's skull; the bosses take it too, at the size the row draws it.
 *
 * The Frostfell three (D49) are named here rather than left to the fallback so
 * that a future glyph of their own is a one-line change — and so that the map
 * says out loud which ids the bestiary can hold.
 */
const BEAST_ICONS: Readonly<Record<string, IconName>> = {
  grunt: 'drill-slayer',
  brute: 'drill-slayer',
  demon: 'drill-slayer',
  charger: 'drill-slayer',
  shieldBrute: 'drill-slayer',
  rime: 'drill-slayer',
};

export const roomIcon = (id: string): IconName => ROOM_ICONS[id] ?? 'room-play';
export const upgradeIcon = (id: string): IconName => UPGRADE_ICONS[id] ?? 'drill-damage';
export const staffIcon = (id: string): IconName => STAFF_ICONS[id] ?? 'staff-ember';
export const beastIcon = (id: string): IconName => BEAST_ICONS[id] ?? 'drill-slayer';

/**
 * One icon, ready to append. `className` is added beside `icon`, which is the
 * class that carries the layout; the caller's class carries the size and the
 * colour.
 */
export function icon(name: IconName, className = ''): HTMLSpanElement {
  const host = document.createElement('span');
  host.className = className.length > 0 ? `icon ${className}` : 'icon';
  host.setAttribute('aria-hidden', 'true');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  host.append(svg);
  return host;
}

/**
 * Points an icon that is already on the page at a different glyph. Used by the
 * HUD, where the staff changes mid-run and rebuilding the plaque would restart
 * its animation.
 */
export function setIcon(host: Element, name: IconName): void {
  const use = host.querySelector('use');
  if (use !== null) use.setAttribute('href', `#i-${name}`);
}
