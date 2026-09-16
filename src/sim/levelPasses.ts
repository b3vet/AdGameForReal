/**
 * The passes that run once a level is laid out: staff gates and the
 * gate-bonus upgrade.
 *
 * Split out of `level.ts` for the level-design plan (document 31): the dealt
 * road and the composed one both finish with them, and the composer cannot
 * import the module that imports it. `level.ts` re-exports both, so the
 * endless road and every caller still read them from there.
 */

import { gateCap } from './gates';
import { emptyLane, shuffle, staffLane, weaponGate } from './gateGen';
import { mulberry32 } from './rng';
import type { RowDef } from './rows';
import type { GateDef, Lane } from './types';
import { balance } from '@/data';

type Rng = () => number;

/** Mixed into the seed for the staff-gate stream, so it is not the level's. */
const WEAPON_STREAM_SALT = 0x57_af_f0_0d;

/** How many staff gates this level may carry, and whether they are on at all. */
export function weaponBudget(index: number): number {
  const gen = balance.gen;
  if (!gen.weaponGatesEnabled || index < gen.weaponFromLevel) return 0;
  return index >= gen.weaponGateManyFromLevel ? gen.weaponGatesLate : gen.weaponGatesEarly;
}

/** One lane of one row a staff gate could take over. */
interface StaffSlot {
  row: number;
  lane: number;
}

/**
 * Lanes of rows past the first that `pick` says a staff may take, shuffled.
 * Never the first row: the plan's rule, and the player has not seen a staff
 * work yet when they are asked to trade for another one.
 */
function staffCandidates(
  rows: readonly RowDef[],
  rng: Rng,
  pick: (gates: ReadonlyArray<GateDef | null>) => number,
): StaffSlot[] {
  const candidates: StaffSlot[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    const lane = pick(row.gates);
    if (lane >= 0) candidates.push({ row: i, lane });
  }
  shuffle(rng, candidates);
  return candidates;
}

/** Converts lanes to staff gates until the budget is spent. Returns how many. */
function convert(
  rows: RowDef[],
  candidates: readonly StaffSlot[],
  rng: Rng,
  budget: number,
): number {
  let placed = 0;
  for (const candidate of candidates) {
    if (placed >= budget) break;
    const row = rows[candidate.row];
    // One staff per row (plan, "Weapons"): the second tier may offer a row the
    // first tier has already taken.
    if (row === undefined || row.gates.some((gate) => gate?.kind === 'weapon')) continue;
    row.gates[candidate.lane] = weaponGate(rng);
    placed++;
  }
  return placed;
}

/**
 * Turns up to `weaponBudget` spare lanes into staff gates, on a stream of its
 * own, after the level is laid out — so turning staff gates on moves only the
 * lanes it converts and cannot re-roll the campaign (Phase C, Milestone 2).
 *
 * Two tiers, in order. First a lane the row can give up — a `fireRate` bonus, a
 * second grower, a second curse (`staffLane`). Then, only if the budget is not
 * spent, a lane that is already empty (`emptyLane`), which costs the row
 * nothing at all.
 */
export function placeWeaponGates(
  rows: RowDef[],
  index: number,
  seed: number,
  // Named by the endless road, which is one road of 160 rows rather than a
  // level and would otherwise be offered the one or two staff gates a *level*
  // carries (`weaponBudget`).
  wanted?: number,
): void {
  const budget = wanted ?? weaponBudget(index);
  if (budget <= 0) return;

  // A separate stream, salted, so the level's own sequence is untouched.
  const rng = mulberry32((seed ^ WEAPON_STREAM_SALT) >>> 0);

  const placed = convert(rows, staffCandidates(rows, rng, staffLane), rng, budget);
  if (placed >= budget) return;
  convert(rows, staffCandidates(rows, rng, emptyLane), rng, budget - placed);
}

/**
 * One beat of a composed level that may take a staff gate: its gate row and
 * its two lanes beside the prize (document 31, 3.5, as amended for Phase 1).
 */
export interface StaffOffer {
  row: number;
  lanes: readonly Lane[];
}

/** A lane that hands the squad something: a plus, a multiplier or a rate. */
function isPlus(gate: GateDef | null | undefined): boolean {
  return gate?.kind === 'add' || gate?.kind === 'mul' || gate?.kind === 'fireRate';
}

/**
 * The lane of an offer a staff takes, or -1: a fire-rate bonus first, then an
 * empty lane, then the smaller plus — and a plus only while the other offered
 * lane is a plus too, so the prize is never left without one beside it.
 */
function offeredLane(gates: ReadonlyArray<GateDef | null>, lanes: readonly Lane[]): number {
  let fireRate = -1;
  let empty = -1;
  let plus = -1;
  let pluses = 0;
  for (const lane of lanes) {
    const slot = lane + 1;
    const gate = gates[slot];
    if (gate === null || gate === undefined) {
      if (empty < 0) empty = slot;
      continue;
    }
    if (!isPlus(gate)) continue;
    pluses++;
    if (gate.kind === 'fireRate') {
      if (fireRate < 0) fireRate = slot;
      continue;
    }
    if (plus < 0 || gate.value < (gates[plus]?.value ?? Infinity)) plus = slot;
  }
  if (fireRate >= 0 && pluses >= 2) return fireRate;
  if (empty >= 0) return empty;
  return pluses >= 2 ? plus : -1;
}

/**
 * Staff gates on a composed level: up to `count` of the offered beats, one
 * each, chosen on the same salted stream the dealt pass uses. The composer
 * offers only the beats a staff may stand on (`STAFF_HOST_BEATS`), and never
 * the first, which the player meets before a staff has been seen to work.
 * Returns how many it placed.
 */
export function placeScriptStaffs(
  rows: RowDef[],
  offers: readonly StaffOffer[],
  count: number,
  seed: number,
): number {
  if (count <= 0) return 0;
  const rng = mulberry32((seed ^ WEAPON_STREAM_SALT) >>> 0);
  const candidates: StaffSlot[] = [];
  for (const offer of offers) {
    const row = rows[offer.row];
    if (row === undefined) continue;
    const lane = offeredLane(row.gates, offer.lanes);
    if (lane >= 0) candidates.push({ row: offer.row, lane });
  }
  shuffle(rng, candidates);
  return convert(rows, candidates, rng, count);
}

/**
 * The gate-bonus upgrade (D35), applied after the level is laid out.
 *
 * Only `add` gates and only their printed value, so the level itself — its
 * rows, its curses, its streams and every random draw behind them — is the one
 * the campaign was tuned as, whatever the player has bought. A player with the
 * upgrade at zero multiplies by exactly one and this returns without touching a
 * thing, which is what keeps a no-upgrade run byte-identical.
 */
export function applyGateBonus(rows: readonly RowDef[], bonus: number): void {
  if (bonus === 1) return;
  for (const row of rows) {
    for (let slot = 0; slot < row.gates.length; slot++) {
      const gate = row.gates[slot];
      if (gate === null || gate === undefined || gate.kind !== 'add') continue;
      gate.value = Math.max(1, Math.round(gate.value * bonus));
      gate.cap = gateCap('add', gate.value, balance);
    }
  }
}
