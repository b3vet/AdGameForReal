/**
 * Sizing a beat against the squad it expects (document 31, 3.4).
 *
 * Every number on a beat is a share of E, the squad the reference player is
 * expected to hold when the column arrives at it: gate values from the
 * library's ranges, blocks from the seconds of fire they take, rivers from
 * their pressure over the fire window their portal leaves. The measured fire
 * per unit (`beats.dps`) is what turns seconds and pressure into hit points.
 */

import { FIRE_RATE_GATE_WORTH, gateCap, isShootable } from '../gates';
import { portalOpen, portalWindow } from '../pressure';
import type { RowEnemyDef } from '../rows';
import type { GateDef, Lane, StreamDef } from '../types';
import { balance as shipped } from '@/data';
import type { Balance, BeatEnemy, BeatLibrary, BeatRiver, GateSlot, RiverBunch } from '@/data/types';
import { beatValues, within } from './library';

/**
 * A printed value, rounded the way a player reads a sign: to the nearest ten
 * above `gates.print.tenAbove`, five above `fiveAbove`, else a whole unit, and
 * never below one.
 */
export function printRound(value: number, balance: Balance = shipped): number {
  const print = balance.gates.print;
  const step = value > print.tenAbove ? 10 : value > print.fiveAbove ? 5 : 1;
  return Math.max(1, Math.round(value / step) * step);
}

/**
 * The panel a slot prints for a squad of `e`. `u` is the slot's own draw
 * inside its size's range; `scale` is the curve's (`beatCurve.ts`) and moves
 * every plus panel together. Curses are not scaled: a flip is sized to be shot
 * green by the column that stands in it, whatever the curve needed.
 */
export function gateFor(
  slot: GateSlot,
  e: number,
  u: number,
  scale: number,
  library: BeatLibrary,
  balance: Balance = shipped,
): GateDef | null {
  switch (slot.kind) {
    case 'none':
      return null;
    case 'mul':
      // Not shootable, so nothing can raise it: its cap is its value.
      return { kind: 'mul', value: slot.value, cap: slot.value };
    case 'add': {
      const value = printRound(e * within(beatValues(library, slot.size), u) * scale, balance);
      return { kind: 'add', value, cap: gateCap('add', value, balance) };
    }
    case 'sub': {
      const value = printRound(e * within(beatValues(library, slot.size), u), balance);
      // The cap is what the curse pays once it has been shot green.
      const cap = gateCap('sub', value, balance);
      if (slot.size !== 'flip') return { kind: 'sub', value, cap };
      // Document 32: the flip pays `gates.flip.payout` times its print, in
      // `gates.flip.seconds` of the column's fire, so the red lane is sometimes
      // the right one. A price curse keeps the road's cap: it is a price.
      const flip = balance.gates.flip;
      const payout = Math.max(cap, flip.payout * value);
      return { kind: 'sub', value, cap: payout, flipGrowth: payout / Math.max(1e-6, flip.seconds) };
    }
    case 'fireRate': {
      // Priced as a mid plus: a bonus worth that share of the squad, in the
      // currency the bots rank it in (`FIRE_RATE_GATE_WORTH`).
      const worth = within(beatValues(library, 'mid'), u) * scale;
      const raw = Math.min(balance.gates.caps.fireRate, worth / FIRE_RATE_GATE_WORTH);
      const value = Math.max(0.01, Math.round(raw * 100) / 100);
      return { kind: 'fireRate', value, cap: gateCap('fireRate', value, balance) };
    }
  }
}

/** True when a panel of this kind swallows the lane's fire (3.2, rule 2). */
export function stopsShots(gate: GateDef | null): boolean {
  return gate !== null && isShootable(gate.kind);
}

/**
 * One block a beat stands, sized by the seconds of the reference squad's fire
 * it takes to clear.
 *
 * `hp = killSeconds * e * dps`, and a shielded brute spends part of that on
 * its shield, which is hit at `shield.damageMul` (D49), so its body is the
 * rest. The printed number is what the block takes on contact (unchanged
 * rule), and a scripted brute prints it at `enemies.beat.bruteHpPerUnit`, so
 * a block that is hard to kill is also a block that hurts. `dz` is from the
 * row the block is filed under; `screened` holds an ambush to its own lane.
 *
 * `holdDz`, from the same row, is the hold line of a block that holds the
 * gateway (`BeatEnemy.hold`). A holding block is held to its own lane too:
 * it is the price of its lane's panel, so the lanes beside it stay clear of
 * it and only its own lane's fire can take it down.
 */
export function blockFor(
  enemy: BeatEnemy,
  lane: Lane,
  dz: number,
  e: number,
  dps: number,
  screened: boolean,
  balance: Balance = shipped,
  holdDz?: number,
): RowEnemyDef {
  const enemies = balance.enemies;
  let hp = Math.max(0, enemy.killSeconds) * Math.max(1, e) * dps;
  if (enemy.kind === 'shieldBrute') {
    const shield = enemies.shield;
    hp /= 1 + shield.share / Math.max(1e-6, shield.damageMul);
  }
  const brute = enemy.kind === 'brute' || enemy.kind === 'shieldBrute';
  const perUnit = brute
    ? enemies.beat.bruteHpPerUnit
    : enemy.kind === 'charger'
      ? enemies.charger.hpPerUnit
      : enemies.grunt.hpPerUnit;
  const def: RowEnemyDef = {
    kind: enemy.kind,
    lane,
    units: Math.max(1, Math.round(hp / perUnit)),
    dz,
    wake: enemy.wake,
  };
  if (brute) def.hpPerUnit = perUnit;
  if (enemy.kind === 'charger') def.killShare = enemies.beat.chargerKillShare;
  // Shot plus radius exactly on the lane line files the block in its own lane
  // only (`targeting.ts`), so the panel in front of it is the nearest target
  // for every shot that could reach it.
  if (screened || holdDz !== undefined) def.maxHalf = balance.road.laneWidth / 2 - balance.projectiles.radius;
  if (holdDz !== undefined) def.holdDz = holdDz;
  return def;
}

/**
 * Where a holding block's line stands, in metres from its gate row: the gap
 * `enemies.beat.holdGap` in front of the panels. Null for a block that walks
 * all the way.
 */
export function holdAt(enemy: BeatEnemy, balance: Balance = shipped): number | null {
  return enemy.hold === true ? -Math.max(0, balance.enemies.beat.holdGap) : null;
}

/**
 * How much more a lane clears of a river whose bodies walk `rho` to the metre
 * than of one whose bodies walk alone (`RiverBunch`): a splash takes whatever
 * stands inside its radius, and a portal's bodies all leave one place. Never
 * below one.
 */
export function bunchFactor(rho: number, bunch: RiverBunch | undefined): number {
  if (bunch === undefined || !(rho > 0)) return 1;
  return Math.max(1, bunch.gain * Math.pow(rho, bunch.power));
}

/** Bodies per metre of lane a portal's river walks at: its pour over the road it covers. */
export function riverDensity(def: StreamDef): number {
  return def.count / Math.max(1e-6, Math.max(0.1, def.durationSeconds) * Math.max(0.1, def.speed));
}

/**
 * A beat's river before its bodies are given their hit points: the def, and
 * the hit points the whole river carries at a bunching factor of one. The
 * count is still free to move (`capBodies`, `capLive`); `settleRiver` turns
 * the budget into hit points per body at whatever count it ends on, so the
 * pressure holds however the ceilings split it.
 */
export interface SizedRiver {
  def: StreamDef;
  budget: number;
  bunch: RiverBunch | undefined;
}

/** Writes the per-body hit points a sized river's count and bunching leave. */
export function settleRiver(river: SizedRiver, balance: Balance = shipped): void {
  const def = river.def;
  const total = river.budget * bunchFactor(riverDensity(def), river.bunch);
  def.hpPerEnemy = clampHp(total / Math.max(1, def.count), balance);
}

/**
 * One lane of a beat's river, poured from `anchorZ` (the beat's gate row plus
 * `river.at`).
 *
 * `density * e` bodies, poured over the seconds the portal actually gets
 * before the squad is on top of it, carrying between them `pressure` times
 * what the lane's fire clears in the window the geometry leaves. What the
 * lane clears is `dps` per unit for bodies walking alone, times the bunching
 * factor for how close these walk (`bunchFactor`), so a pressure of one is the
 * river a column standing in the lane just clears, at any squad size: a
 * portal's bodies leave one place and walk bunched, and a splash staff takes
 * several at a time (measured, Phase 1 wave two).
 *
 * The portal opens at `river.open`, or where its `tail` says (`portalOpen`).
 */
export function riverFor(
  river: BeatRiver,
  lane: Lane,
  anchorZ: number,
  e: number,
  dps: number,
  screened: boolean,
  balance: Balance = shipped,
  bunch?: RiverBunch,
): StreamDef {
  const sized = sizeRiver(river, lane, anchorZ, e, dps, screened, bunch, balance);
  settleRiver(sized, balance);
  return sized.def;
}

/** `riverFor` with the hit points left to `settleRiver`, for the ceilings to move the count first. */
export function sizeRiver(
  river: BeatRiver,
  lane: Lane,
  anchorZ: number,
  e: number,
  dps: number,
  screened: boolean,
  bunch: RiverBunch | undefined,
  balance: Balance = shipped,
): SizedRiver {
  const streams = balance.streams;
  const speed = streams.speed;
  const open = portalOpen(river, speed, balance);
  const shape = portalWindow({ at: river.at, open, seconds: river.seconds, screened, speed }, balance);
  const count = Math.max(balance.enemies.portal.minBodies, Math.round(river.density * e));
  const laneDps = Math.max(1, e) * dps * streams.laneShare;
  const def: StreamDef = {
    lane,
    kind: 'grunt',
    count,
    durationSeconds: Math.max(0.1, shape.pour),
    hpPerEnemy: 0,
    speed,
    jitter: streams.jitter,
    anchorZ,
    openAt: open,
  };
  return { def, budget: river.pressure * laneDps * shape.window, bunch };
}

function clampHp(hp: number, balance: Balance): number {
  const range = balance.streams.hpPerEnemy;
  return Math.min(range.max, Math.max(range.min, hp));
}

/**
 * Holds one beat's rivers to `enemies.portal.maxBodiesPerBeat` bodies between
 * them. Fewer, tougher bodies: each river keeps the pressure it was sized for
 * (`settleRiver` re-reads its bunching at the new count), so only the peak of
 * live bodies (and what a leak costs) comes down (4.7).
 */
export function capBodies(rivers: readonly SizedRiver[], balance: Balance = shipped): void {
  let total = 0;
  for (const river of rivers) total += river.def.count;
  const most = balance.enemies.portal.maxBodiesPerBeat;
  if (total > most) {
    const factor = most / total;
    for (const river of rivers) river.def.count = Math.max(1, Math.floor(river.def.count * factor));
  }
  for (const river of rivers) settleRiver(river, balance);
}

/**
 * Holds a whole road's rivers to `enemies.portal.maxLiveBodies` at once.
 *
 * A portal's bodies are on the road from the moment it opens until the squad
 * is past it, so in squad distance a river lives over `[anchorZ - openAt,
 * anchorZ + streams.despawnBehind]`. Counted as if nothing were shot, because
 * a river the column dodges is exactly that.
 *
 * The busiest point is found and every river live there is scaled down in
 * proportion, never below `portal.minBodies`, until no point is over the
 * ceiling: two beats that pour into the same stretch share it rather than the
 * later one losing its river. Like `capBodies`, each keeps its pressure.
 */
export function capLive(rivers: readonly SizedRiver[], balance: Balance = shipped): void {
  const portal = balance.enemies.portal;
  const spans = rivers
    .filter((river) => river.def.anchorZ !== undefined)
    .map((river) => {
      const at = river.def.anchorZ ?? 0;
      // A body is retired `streams.despawnBehind` past the squad, so the last
      // of a river is still on the road a few metres after the portal.
      return { river, start: at - (river.def.openAt ?? 0), end: at + balance.streams.despawnBehind };
    });

  // Coverage only rises where a span starts, so those are the points to test.
  const coverage = (at: number): number => {
    let live = 0;
    for (const span of spans) if (span.start <= at && span.end >= at) live += span.river.def.count;
    return live;
  };
  // Each round lowers a point to the ceiling or leaves it at the floor, so a
  // round per span is enough.
  for (let round = 0; round <= spans.length; round++) {
    let at = 0;
    let busiest = 0;
    for (const span of spans) {
      const live = coverage(span.start);
      if (live > busiest) {
        busiest = live;
        at = span.start;
      }
    }
    if (busiest <= portal.maxLiveBodies) break;
    const factor = portal.maxLiveBodies / busiest;
    let moved = false;
    for (const span of spans) {
      if (span.start > at || span.end < at) continue;
      const def = span.river.def;
      const count = Math.max(portal.minBodies, Math.floor(def.count * factor));
      if (count >= def.count) continue;
      def.count = count;
      moved = true;
    }
    if (!moved) break;
  }
  for (const river of rivers) settleRiver(river, balance);
}
