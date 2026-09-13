/**
 * The gate pool: which arch is bound to which gate id, and for how long.
 *
 * Split out of `./gates.ts` for the file-size rule (CLAUDE.md). The line between
 * the two is the one the view's own comment draws: *this* is the bookkeeping —
 * a fixed set of slots, a slot claimed the first time a gate shows up in
 * `RunState` and handed back when its exit animation finishes — and `gates.ts`
 * is the frame: what is close enough to draw, what carries a number, and what
 * the arch, the plaque and the shimmer are written with.
 *
 * Nothing here allocates after construction: the slots are built once and only
 * ever rewritten, which is what lets the draw pass walk them every frame.
 */

import type { NumberLabels } from './labels';
import { LANE_WIDTH } from './theme';
import type { GateKind, GateState } from '@/sim';

/** Where a slot is in its life: on the road, chosen, or passed over. */
export type Exit = 'none' | 'chosen' | 'skipped';

export interface GateSlot {
  /** This slot's label id in the shared atlas; see `src/render/labels.ts`. */
  label: number;
  gateId: number;
  rowIndex: number;
  x: number;
  z: number;
  /** Last kind seen. A shot-down `sub` gate flips to `add` and must re-dress. */
  kind: GateKind;
  /** Last value printed. Re-building the string every frame allocates. */
  shownValue: number;
  /** The string that value produced, handed back to the atlas every frame. */
  shownText: string;
  /** Seconds left on the hit flash. */
  pulse: number;
  exit: Exit;
  exitAge: number;
  /** Frame counter of the last `RunState` that still listed this gate. */
  seen: number;
}

export class GateSlots {
  /** Every slot, in pool order. The draw pass walks this and nothing else. */
  readonly all: GateSlot[] = [];

  private readonly byGateId = new Map<number, GateSlot>();
  private readonly labels: NumberLabels;
  private frameCount = 0;

  constructor(labels: NumberLabels, size: number) {
    this.labels = labels;
    for (let i = 0; i < size; i++) {
      this.all.push({
        label: labels.claim(),
        gateId: -1,
        rowIndex: -1,
        x: 0,
        z: 0,
        kind: 'add',
        shownValue: Number.NaN,
        shownText: '',
        pulse: 0,
        exit: 'none',
        exitAge: 0,
        seen: 0,
      });
    }
  }

  /** Opens a frame and answers the stamp `seen` is compared against. */
  beginFrame(): number {
    this.frameCount++;
    return this.frameCount;
  }

  /** The stamp the current frame is writing, without opening a new one. */
  get frame(): number {
    return this.frameCount;
  }

  /** The slot bound to this gate, or undefined. */
  find(gateId: number): GateSlot | undefined {
    return this.byGateId.get(gateId);
  }

  /**
   * The slot this gate is drawn from, claiming a free one the first time the
   * gate is seen. Undefined when the gate is already behind the squad or the
   * pool is full — both of which are simply a gate that is not drawn.
   */
  bind(gate: GateState): GateSlot | undefined {
    const existing = this.byGateId.get(gate.id);
    if (existing !== undefined) return existing;
    if (gate.passed) return undefined;

    const slot = this.freeSlot();
    if (slot === undefined) return undefined;

    slot.gateId = gate.id;
    slot.rowIndex = gate.rowIndex;
    slot.shownValue = Number.NaN;
    slot.shownText = '';
    slot.pulse = 0;
    slot.exit = 'none';
    slot.exitAge = 0;
    slot.kind = gate.kind;
    slot.x = gate.lane * LANE_WIDTH;
    slot.z = gate.z;

    this.byGateId.set(gate.id, slot);
    return slot;
  }

  /** Starts an exit animation, unless one is already playing. */
  startExit(slot: GateSlot, exit: Exit): void {
    if (slot.exit !== 'none' || exit === 'none') return;
    slot.exit = exit;
    slot.exitAge = 0;
  }

  /** The squad chose `chosen`; every other slot in its row dims. */
  exitRow(chosen: GateSlot): void {
    this.startExit(chosen, 'chosen');
    for (const slot of this.all) {
      if (slot.gateId < 0 || slot === chosen) continue;
      if (slot.rowIndex === chosen.rowIndex) this.startExit(slot, 'skipped');
    }
  }

  /** Hands one slot back to the pool and takes its number off the road. */
  release(slot: GateSlot): void {
    if (slot.gateId >= 0) this.byGateId.delete(slot.gateId);
    this.labels.hide(slot.label);
    slot.gateId = -1;
    slot.rowIndex = -1;
    slot.exit = 'none';
    slot.exitAge = 0;
    slot.pulse = 0;
    slot.shownText = '';
  }

  /** Every arch back to the pool. Called from `loadLevel`. */
  reset(): void {
    this.byGateId.clear();
    for (const slot of this.all) this.release(slot);
  }

  /** Drops every binding; the slots themselves go with the view. */
  dispose(): void {
    this.all.length = 0;
    this.byGateId.clear();
  }

  /** First unbound slot, or undefined when the pool is full. An index loop
   *  rather than `find`: this runs per gate per frame and a closure per call is
   *  an allocation in the steady-state path. */
  private freeSlot(): GateSlot | undefined {
    for (let i = 0; i < this.all.length; i++) {
      const slot = this.all[i];
      if (slot !== undefined && slot.gateId < 0) return slot;
    }
    return undefined;
  }
}
