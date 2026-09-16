/**
 * One run, instrumented for the design readout (document 31, section 1): every
 * gate row as greedy prices it when it first reads it, every threat from first
 * sight to its end, the count every row's spacing, and the losses by beat when
 * the level carries beat marks. Not a test file; `designReadout.test.ts` plays
 * the campaign through `playDef` with `DesignTrace.onStep` as the hook and
 * aggregates the `RunTrace`s.
 *
 * A threat is a block (chargers included) or a river. A block's cost is the
 * `unitsLost` its contact emits right after its `enemyKilled`; a river's is its
 * own `leaked`. Everything is read off the events and the state, never off the
 * level's internals, so the readout measures what a run did.
 */

import { WHOLE_BOARD } from '../botPrice';
import { exactRead, lanes, priceLanes } from '../botValue';
import type { LevelDef } from '../level';
import type { Run } from '../Run';
import type { EnemyKind, GateKind, SimEvent } from '../types';
import { balance } from '@/data';

/** How far up the road a threat counts as seen (document 31, 3.2 draw range). */
export const SIGHT = 70;

export interface ThreatTrace {
  kind: EnemyKind | 'river';
  /** Units it took, and that as a share of the squad when it woke or started. */
  cost: number;
  share: number;
  /** Seconds from first sight, and from waking, to its end (death or contact). */
  sightToEnd: number;
  wakeToEnd: number;
  /** Squad-to-threat gap when it ended; 0 for a contact. */
  endGap: number;
  contact: boolean;
  /** The squad the share is taken of. */
  base: number;
}

export interface RowTrace {
  /** Priced best less second, over the squad, when greedy first reads the row. */
  decision: number;
  decisionFace: number;
  /** The face-value best lane is expected to cost nothing. */
  unpriced: boolean;
  hasCurse: boolean;
  hasMul: boolean;
  /** The squad walked a panel that was a curse when the level was built. */
  tookRed: boolean;
  tookMul: boolean;
}

export interface BeatLoss {
  beat: string;
  tier: number;
  share: number;
}

export interface RunTrace {
  threats: ThreatTrace[];
  rows: RowTrace[];
  bodyDeathGaps: number[];
  beats: BeatLoss[];
  /** Times the count fell at least `FALL` between two samples a row apart. */
  falls: number;
}

const FALL = 0.08;

interface BlockNote {
  kind: EnemyKind;
  sight: number;
  wake: number;
  count: number;
}

interface RiverNote {
  sight: number;
  start: number;
  end: number;
  count: number;
}

export class DesignTrace {
  private readonly level: LevelDef;
  private readonly read = exactRead();
  private readonly blocks = new Map<number, BlockNote>();
  private readonly rivers = new Map<number, RiverNote>();
  private readonly firstKind = new Map<number, GateKind>();
  private readonly rowRead = new Map<number, RowTrace>();
  private readonly out: RunTrace = { threats: [], rows: [], bodyDeathGaps: [], beats: [], falls: 0 };
  private primed = false;
  private sampleZ = 0;
  private lastSample = -1;
  private beatIndex = 0;
  private beatStartCount = 0;
  private beatLost = 0;
  private pendingBlock = -1;
  private last: Run | null = null;
  private time = 0;

  constructor(level: LevelDef) {
    this.level = level;
  }

  readonly onStep = (run: Run, events: readonly SimEvent[], step: number): void => {
    const state = run.state;
    const time = step / 60;
    this.last = run;
    this.time = time;
    if (!this.primed) this.prime(run);
    const squadZ = state.squad.z;

    for (const enemy of state.enemies) {
      const note = this.blocks.get(enemy.id);
      if (note !== undefined && note.sight < 0 && enemy.z - squadZ <= SIGHT) note.sight = time;
    }
    for (const stream of state.streams) {
      const note = this.rivers.get(stream.id);
      if (note === undefined || note.sight >= 0) continue;
      const visible = stream.anchorZ !== undefined ? stream.z - squadZ <= SIGHT : stream.started;
      if (visible) note.sight = time;
    }

    for (const event of events) this.onEvent(run, event, time);
    this.readRows(run);
    this.sample(state.squad.count, squadZ);
    this.beatEdge(state.squad.count, squadZ);
  };

  private prime(run: Run): void {
    this.primed = true;
    for (const enemy of run.state.enemies) {
      if (enemy.streamId !== undefined || enemy.kind === 'boss') continue;
      this.blocks.set(enemy.id, { kind: enemy.kind, sight: -1, wake: -1, count: 0 });
    }
    for (const stream of run.state.streams) {
      this.rivers.set(stream.id, { sight: -1, start: -1, end: -1, count: 0 });
    }
    for (const gate of run.state.gates) this.firstKind.set(gate.id, gate.kind);
    this.beatStartCount = run.state.squad.count;
  }

  private onEvent(run: Run, event: SimEvent, time: number): void {
    const state = run.state;
    const pending = this.pendingBlock;
    this.pendingBlock = -1;
    if (event.type === 'enemyActivated') {
      const note = this.blocks.get(event.enemyId);
      if (note !== undefined && note.wake < 0) {
        note.wake = time;
        note.count = state.squad.count;
      }
    } else if (event.type === 'streamStarted') {
      const note = this.rivers.get(event.streamId);
      if (note !== undefined) {
        note.start = time;
        note.count = state.squad.count;
        if (note.sight < 0) note.sight = time;
      }
    } else if (event.type === 'streamCleared') {
      const note = this.rivers.get(event.streamId);
      if (note !== undefined) note.end = time;
    } else if (event.type === 'enemyKilled') {
      if (event.streamId !== undefined) {
        this.out.bodyDeathGaps.push(event.z - state.squad.z);
      } else if (this.blocks.has(event.enemyId)) {
        this.endBlock(event.enemyId, time, event.z - state.squad.z, 0);
        this.pendingBlock = event.enemyId;
      }
    } else if (event.type === 'unitsLost') {
      if (event.reason !== 'stomp' && event.reason !== 'charge') this.beatLost += event.amount;
      if (event.reason === 'contact' && pending >= 0) {
        const threat = this.out.threats[this.out.threats.length - 1];
        if (threat !== undefined) {
          threat.contact = true;
          threat.endGap = 0;
          threat.cost = event.amount;
          threat.share = event.amount / Math.max(1, threat.base);
        }
      }
    } else if (event.type === 'gatePassed') {
      this.notePassed(state.gates.find((gate) => gate.id === event.gateId)?.rowIndex ?? -1, event.gateId);
    }
  }

  private endBlock(id: number, time: number, gap: number, cost: number): void {
    const note = this.blocks.get(id);
    if (note === undefined) return;
    this.out.threats.push({
      kind: note.kind,
      cost,
      share: cost / Math.max(1, note.count),
      sightToEnd: note.sight < 0 ? 0 : time - note.sight,
      wakeToEnd: note.wake < 0 ? 0 : time - note.wake,
      endGap: gap,
      contact: false,
      base: note.wake < 0 ? this.last?.state.squad.count ?? 1 : note.count,
    });
    this.blocks.delete(id);
  }

  private notePassed(row: number, gateId: number): void {
    const trace = this.rowRead.get(row);
    if (trace === undefined) return;
    const kind = this.firstKind.get(gateId);
    trace.tookRed = kind === 'sub';
    trace.tookMul = kind === 'mul';
  }

  /** Prices each gate row once, the first step it is within greedy's read. */
  private readRows(run: Run): void {
    const state = run.state;
    const reach = balance.bots.readDistance;
    for (const gate of state.gates) {
      if (gate.passed || this.rowRead.has(gate.rowIndex)) continue;
      if (gate.z - state.squad.z > reach) continue;
      priceLanes(state, gate.rowIndex, gate.z, WHOLE_BOARD, this.read, balance);
      const count = Math.max(1, lanes.count);
      let faceBest = 0;
      for (let slot = 1; slot < 3; slot++) {
        if ((lanes.face[slot] ?? 0) > (lanes.face[faceBest] ?? 0)) faceBest = slot;
      }
      let hasCurse = false;
      let hasMul = false;
      for (const other of state.gates) {
        if (other.rowIndex !== gate.rowIndex) continue;
        const kind = this.firstKind.get(other.id);
        if (kind === 'sub') hasCurse = true;
        if (kind === 'mul') hasMul = true;
      }
      const trace: RowTrace = {
        decision: spread(lanes.worth) / count,
        decisionFace: spread(lanes.face) / count,
        unpriced: (lanes.cost[faceBest] ?? 0) < 0.5,
        hasCurse,
        hasMul,
        tookRed: false,
        tookMul: false,
      };
      this.rowRead.set(gate.rowIndex, trace);
      this.out.rows.push(trace);
    }
  }

  private sample(count: number, z: number): void {
    if (z < this.sampleZ) return;
    if (this.lastSample >= 0 && count < this.lastSample * (1 - FALL)) this.out.falls++;
    this.lastSample = count;
    this.sampleZ += balance.level.rowSpacing;
  }

  private beatEdge(count: number, z: number): void {
    const marks = this.level.beats;
    if (marks === undefined) return;
    const mark = marks[this.beatIndex];
    if (mark === undefined || z < mark.z) return;
    this.out.beats.push({
      beat: mark.beat,
      tier: mark.tier,
      share: this.beatLost / Math.max(1, this.beatStartCount),
    });
    this.beatIndex++;
    this.beatLost = 0;
    this.beatStartCount = count;
  }

  /** The run's trace, with every river's leak booked as its cost. */
  finish(): RunTrace {
    const run = this.last;
    if (run === null) return this.out;
    for (const stream of run.state.streams) {
      const note = this.rivers.get(stream.id);
      if (note === undefined || note.start < 0) continue;
      const end = note.end < 0 ? this.time : note.end;
      this.out.threats.push({
        kind: 'river',
        cost: stream.leaked,
        share: stream.leaked / Math.max(1, note.count),
        sightToEnd: end - note.sight,
        wakeToEnd: end - note.start,
        endGap: 0,
        contact: stream.leaked > 0,
        base: note.count,
      });
    }
    return this.out;
  }
}

/** The `q` quantile of a list, nearest rank; 0 for an empty one. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[at] ?? 0;
}

/** Best less second of a lane triple. */
export function spread(values: Float64Array): number {
  let best = -Infinity;
  let second = -Infinity;
  for (const value of values) {
    if (value > best) {
      second = best;
      best = value;
    } else if (value > second) {
      second = value;
    }
  }
  return second === -Infinity ? 0 : best - second;
}
