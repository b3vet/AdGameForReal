/**
 * The design trace's gate rows (document 31, section 1 and 5): each row priced
 * once, the first step it is within greedy's read, as greedy prices it, and
 * what the column walked through there. Not a test file; `DesignTrace` owns
 * one of these per run.
 */

import { WHOLE_BOARD } from '../botPrice';
import { exactRead, lanes, priceLanes } from '../botValue';
import type { Run } from '../Run';
import type { GateKind } from '../types';
import { balance } from '@/data';

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

/** The gate rows of one run, read as they come within reach. */
export class RowReads {
  private readonly out: RowTrace[];
  private readonly lens = exactRead();
  private readonly firstKind = new Map<number, GateKind>();
  private readonly rowRead = new Map<number, RowTrace>();

  /** `out` is the trace's own list; rows are pushed onto it in the order read. */
  constructor(out: RowTrace[]) {
    this.out = out;
  }

  /** What every panel was when the level was built: a flipped curse is still a red lane. */
  prime(gates: ReadonlyArray<{ id: number; kind: GateKind }>): void {
    for (const gate of gates) this.firstKind.set(gate.id, gate.kind);
  }

  passed(row: number, gateId: number): void {
    const trace = this.rowRead.get(row);
    if (trace === undefined) return;
    const kind = this.firstKind.get(gateId);
    trace.tookRed = kind === 'sub';
    trace.tookMul = kind === 'mul';
  }

  /** Prices each gate row once, the first step it is within greedy's read. */
  read(run: Run): void {
    const state = run.state;
    const reach = balance.bots.readDistance;
    for (const gate of state.gates) {
      if (gate.passed || this.rowRead.has(gate.rowIndex)) continue;
      if (gate.z - state.squad.z > reach) continue;
      priceLanes(state, gate.rowIndex, gate.z, WHOLE_BOARD, this.lens, balance);
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
      this.out.push(trace);
    }
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
