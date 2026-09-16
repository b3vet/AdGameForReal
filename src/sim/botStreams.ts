/**
 * What a bot knows about a river that has not finished pouring: how tough its
 * bodies are, how fast it pours, and where from (document 31, 4.4).
 *
 * `StreamState` is the live half of a river and carries its count, its portal
 * and its progress, but not the two numbers a price needs for the bodies still
 * to come — their hit points and the pour's length — nor the distance a portal
 * opens at. Until the sim writes them onto the state, this module reads them
 * where they may already be (an optional field of the same name as on
 * `StreamDef`) and otherwise off the river itself: a live body's hit points,
 * and the shared duration. A river with nothing on the road yet and no hit
 * points on its state is not priced, which is also what a player standing in
 * front of a portal with no bodies out of it knows.
 *
 * Read once per `pricePath` call, so the per-lane passes do not walk the
 * enemy list once per river.
 */

import type { RunState, StreamState } from './types';
import type { Balance } from '@/data/types';

export interface StreamFacts {
  /** Hit points of one body still to come. */
  hp: number;
  /** How long the whole pour lasts, in seconds. */
  seconds: number;
  /** How fast its bodies walk. */
  speed: number;
  /** Squad-to-portal distance the pour starts at. */
  openAt: number;
  /** The portal, or undefined for a river that keeps pace with the squad. */
  anchorZ: number | undefined;
}

/** The last `streamFacts` answer; overwritten, never allocated. */
export const facts: StreamFacts = { hp: 0, seconds: 0, speed: 0, openAt: 0, anchorZ: undefined };

let bodyHp = new Float64Array(32);
let bodySpeed = new Float64Array(32);

/** One pass over the road: a live body's hit points and speed per river. */
export function gatherStreams(state: RunState): void {
  const n = state.streams.length;
  if (n > bodyHp.length) {
    // Grown rather than capped: a longer road is a new level, not a new step.
    bodyHp = new Float64Array(n * 2);
    bodySpeed = new Float64Array(n * 2);
  }
  bodyHp.fill(0, 0, n);
  for (const enemy of state.enemies) {
    const id = enemy.streamId;
    if (id === undefined || !enemy.alive || id >= n) continue;
    if ((bodyHp[id] ?? 0) > 0) continue;
    bodyHp[id] = enemy.maxHp;
    bodySpeed[id] = enemy.speed;
  }
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Fills `facts` for one river and says whether it can be priced. `gatherStreams`
 * must have run for this state.
 */
export function streamFacts(state: RunState, stream: StreamState, balance: Balance): boolean {
  const id = stream.id;
  const live = id < state.streams.length ? (bodyHp[id] ?? 0) : 0;
  const onState = 'hpPerEnemy' in stream ? optionalNumber(stream.hpPerEnemy) : undefined;
  const hp = onState ?? (live > 0 ? live : undefined);
  if (hp === undefined) return false;
  const duration = balance.streams.duration;
  const seconds = 'durationSeconds' in stream ? optionalNumber(stream.durationSeconds) : undefined;
  const openAt = 'openAt' in stream ? optionalNumber(stream.openAt) : undefined;
  facts.hp = hp;
  facts.seconds = seconds ?? (duration.min + duration.max) / 2;
  facts.speed = live > 0 ? (bodySpeed[id] ?? balance.streams.speed) : balance.streams.speed;
  facts.anchorZ = stream.anchorZ;
  facts.openAt = openAt ?? balance.streams.spawnAhead;
  return true;
}
