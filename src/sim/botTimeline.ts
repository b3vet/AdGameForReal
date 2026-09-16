/**
 * The per-lane timeline a price is settled on (`./botPrice.ts`): the threats
 * the collectors in `./botThreats.ts` put on it, and the arithmetic that spends
 * the lane's fire on them nearest-arrival first, the way `TargetList` does.
 *
 * Split from `./botPrice.ts` for the size rule (CLAUDE.md). Everything is a
 * module-level typed array overwritten per call: a bot prices three lanes on
 * every step, and the sim must not allocate in hot loops.
 */

import type { BotPriceBalance, WeaponDef } from '@/data/types';

export const BLOCK = 0;
export const RIVER = 1;
export const CHARGER = 2;

const MAX_ITEMS = 64;
const MAX_PANELS = 12;

/** What the last settle found, per lane (index `lane + 1`). */
export const path = {
  /** Soldiers standing in the lane is expected to cost before the row. */
  cost: new Float64Array(3),
  /**
   * Soldiers it is expected to cost in the first `price.afterRow` metres past
   * the row, where the column is still standing in the lane it chose: a toll
   * poured from behind the panels, an ambush that walked through it late.
   * Taken after the gate, so a multiplier does not double it.
   */
  after: new Float64Array(3),
  /** Seconds of the column's fire the lane's own panel gets before the row. */
  panel: new Float64Array(3),
  /** Seconds before the column is standing in the lane. */
  shift: new Float64Array(3),
};

/** The per-call constants every collector reads; overwritten, never allocated. */
export const ctx = {
  /** The squad's `z`, run speed, projectile range and contact distance. */
  s: 0,
  run: 5,
  range: 34,
  contact: 1.2,
  /** The row being priced, and where the stretch the price covers ends. */
  rowZ: 0,
  toZ: 0,
  horizon: 16,
  /** `price.trailing`: how far behind the head a passed threat still counts. */
  trailing: 1.5,
  /** The lane being priced: its centre, and how far off it a body still hits. */
  x: 0,
  half: 0.8,
  reach: 1,
  count: 0,
};

const due = new Float64Array(MAX_ITEMS);
const open = new Float64Array(MAX_ITEMS);
const hp = new Float64Array(MAX_ITEMS);
const shield = new Float64Array(MAX_ITEMS);
const units = new Float64Array(MAX_ITEMS);
const perUnit = new Float64Array(MAX_ITEMS);
const share = new Float64Array(MAX_ITEMS);
const aim = new Float64Array(MAX_ITEMS);
const dense = new Float64Array(MAX_ITEMS);
const mode = new Uint8Array(MAX_ITEMS);
const order = new Int32Array(MAX_ITEMS);
let items = 0;

const panels = new Float64Array(MAX_PANELS);
let panelCount = 0;

export function clearItems(): void {
  items = 0;
}

export function clearPanels(): void {
  panelCount = 0;
}

/** A shot-stopping panel still standing in the lane, ahead of the squad. */
export function addPanel(z: number): void {
  if (panelCount < MAX_PANELS) panels[panelCount++] = z;
}

/**
 * When the lane's fire can first reach something at `z`, born `bornAt`
 * seconds from now and walking at `speed` from `wakeAt` on: the latest of the
 * moments every panel between it and the squad stops screening it — it walks
 * through, or the squad reaches the row and the panel is gone. `bornAt` when
 * nothing screens it; -1 when something does and `seen` is false, which the
 * caller takes as "not on this player's screen".
 */
export function unscreened(z: number, speed: number, bornAt: number, wakeAt: number, seen: boolean): number {
  const squadThen = ctx.s + ctx.run * bornAt;
  let lift = bornAt;
  for (let i = 0; i < panelCount; i++) {
    const g = panels[i] ?? 0;
    if (g >= z || g <= squadThen) continue;
    if (!seen) return -1;
    const through = speed > 0 ? Math.max(bornAt, wakeAt) + (z - g) / speed : Infinity;
    lift = Math.max(lift, Math.min(through, (g - ctx.s) / ctx.run));
  }
  return lift;
}

/** Puts one threat on the timeline and returns its slot, or -1 when full. */
export function push(kind: number, dueAt: number, openAt: number, hitPoints: number, arriving: number): number {
  if (items >= MAX_ITEMS) return -1;
  const i = items++;
  mode[i] = kind;
  due[i] = dueAt;
  open[i] = openAt;
  hp[i] = hitPoints;
  shield[i] = 0;
  units[i] = arriving;
  perUnit[i] = 1;
  share[i] = 1;
  aim[i] = 1;
  dense[i] = 0;
  return i;
}

/** The extra a block carries: its shield, its hit points per unit, its overlap and aim. */
export function setBlock(i: number, shieldHp: number, hpPerUnit: number, meets: number, blockAim: number): void {
  shield[i] = shieldHp;
  hp[i] = (hp[i] ?? 0) + shieldHp;
  perUnit[i] = hpPerUnit;
  share[i] = meets;
  aim[i] = blockAim;
}

/** Bodies per metre of road a river arrives at. */
export function setDensity(i: number, perMetre: number): void {
  dense[i] = perMetre;
}

export function setAim(i: number, value: number): void {
  aim[i] = value;
}

/**
 * The river pressure (hit points over raw output times the fire window) a
 * column clears without a leak, for a river `perMetre` dense. Fitted to probes
 * of a column holding a lane against rivers from the moving spawner and from
 * portals, 30 to 450 units: a splash staff's blast takes every body within its
 * radius, so a portal's river — bodies released at one place, walking away from
 * it — is several times easier per hit point than one that keeps pace with the
 * squad. A chaining staff gets its hops; a slowing one the time it buys.
 */
export function riverClean(perMetre: number, weapon: WeaponDef, price: BotPriceBalance, slowWorth: number): number {
  let gain = 1;
  if (weapon.splash !== undefined) gain += price.splashGain * Math.pow(Math.max(0, perMetre), price.splashPower);
  const chain = weapon.chain;
  if (chain !== undefined) gain += chain.damageMul * chain.count;
  if (weapon.slow !== undefined) gain += slowWorth;
  return Math.max(price.riverFloor, price.riverBase * gain);
}

/**
 * Spends the lane's fire on its threats nearest-arrival first, books what gets
 * through before and after the row, and the fire left over for the panel,
 * whose window is `[panelFrom, panelTo]` (both zero when there is no panel).
 */
export function settle(
  slot: number,
  raw: number,
  delay: number,
  panelFrom: number,
  panelTo: number,
  weapon: WeaponDef,
  price: BotPriceBalance,
  slowWorth: number,
): void {
  for (let i = 0; i < items; i++) order[i] = i;
  for (let i = 1; i < items; i++) {
    const item = order[i] ?? 0;
    const key = due[item] ?? 0;
    let j = i - 1;
    while (j >= 0 && (due[order[j] ?? 0] ?? 0) > key) {
      order[j + 1] = order[j] ?? 0;
      j--;
    }
    order[j + 1] = item;
  }

  const from = Math.max(delay, panelFrom);
  let busyInPanel = 0;
  let busy = delay;
  let cost = 0;
  let after = 0;

  for (let k = 0; k < items; k++) {
    const i = order[k] ?? 0;
    const at = due[i] ?? 0;
    const start = Math.max(open[i] ?? 0, busy);
    const window = at - start;
    const kind = mode[i] ?? BLOCK;
    const rate = raw * (kind === RIVER ? riverClean(dense[i] ?? 0, weapon, price, slowWorth) : (aim[i] ?? 1));
    const need = rate > 0 ? (hp[i] ?? 0) / rate : Infinity;
    let end = start;
    let taken = 0;
    if (window <= 0 || rate <= 0) {
      taken = arriving(i, kind, 0, price.riverSteepness);
    } else if (need <= window) {
      end = start + need;
    } else {
      taken = arriving(i, kind, rate * window, price.riverSteepness);
      end = at;
    }
    if (ctx.s + ctx.run * at > ctx.rowZ + 0.5) after += taken;
    else cost += taken;
    if (end > start) {
      busy = end;
      busyInPanel += Math.max(0, Math.min(end, panelTo) - Math.max(start, from));
    }
  }

  path.cost[slot] = cost;
  path.after[slot] = after;
  path.panel[slot] = panelTo > from ? Math.max(0, panelTo - from - busyInPanel) : 0;
}

/** What an item that took `removed` hit points of fire costs when it arrives. */
function arriving(i: number, kind: number, removed: number, steep: number): number {
  const whole = hp[i] ?? 0;
  if (kind === RIVER) {
    const bodies = units[i] ?? 0;
    if (removed <= 0 || whole <= 0) return bodies;
    return bodies * (1 - Math.pow(Math.min(1, removed / whole), steep));
  }
  if (kind === CHARGER) return removed >= whole ? 0 : (units[i] ?? 0);
  const armour = shield[i] ?? 0;
  const left = Math.max(0, whole - armour - Math.max(0, removed - armour));
  if (left <= 0) return 0;
  const leftUnits = Math.min(units[i] ?? 0, Math.ceil(left / Math.max(1e-6, perUnit[i] ?? 1)));
  return Math.max(1, Math.ceil(leftUnits * (share[i] ?? 1)));
}
