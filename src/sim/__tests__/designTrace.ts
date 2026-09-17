/**
 * One run, instrumented for the design readout (document 31, section 1) and
 * the road bands (section 5): every gate row as greedy prices it when it first
 * reads it, every threat from first sight to its end, every contact's warning
 * time, the count every row's spacing, and the losses by beat when the level
 * carries beat marks. Not a test; `designReadout.test.ts` and the balance
 * files play the campaign through `playDef` with `DesignTrace.onStep` as the
 * hook and aggregate the `RunTrace`s.
 *
 * A threat is a block (chargers included) or a river. A block's cost is the
 * `unitsLost` its contact emits right after its `enemyKilled`; a river's is its
 * own `leaked`. Everything is read off the events and the state, never off the
 * level's internals, so the readout measures what a run did.
 *
 * A beat owns the threats that stand on its rows and the curse on its gate
 * row: anything placed up to half a row's spacing past its gate row (an ambush
 * at +5, a portal at +8) and past the previous beat's. Its loss is what those
 * threats and that curse took, whenever they took it, over the squad when the
 * first of them woke (or when the column entered the beat, if that came
 * first). Booking by owner rather than by where the column stood keeps a toll's
 * tail, which lands after the gate row, on the toll, and the next guard, which
 * can bite before it, on the next beat.
 */

import type { BeatMark, LevelDef } from '../level';
import type { Run } from '../Run';
import type { EnemyKind, SimEvent } from '../types';
import { RowReads } from './designRows';
import type { RowTrace } from './designRows';
import { balance } from '@/data';

export type { RowTrace } from './designRows';
export { quantile, spread } from './designRows';

/** How far up the road a threat counts as seen (document 31, 3.2 draw range). */
export const SIGHT = 70;

/** A count that falls by this share between two samples a row apart is a fall. */
const FALL = 0.08;

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

/** The warning one threat gave before it first reached a group (3.2). */
export interface ContactTrace {
  kind: EnemyKind | 'river';
  /** Seconds from first sight to the first unit it took. */
  sightToContact: number;
  /** Seconds from waking (a charger's trigger, a portal's opening) to it. */
  wakeToContact: number;
}

export interface BeatLoss {
  beat: string;
  tier: number;
  /** `(threatCost + curseCost) / base`. */
  share: number;
  /** Units the beat's own blocks, chargers and rivers took. */
  threatCost: number;
  /** Units its gate row's curse took. */
  curseCost: number;
  /** The squad the share is taken of. */
  base: number;
  /** True when the beat stands at least one block or river. */
  threat: boolean;
  /** The count as the column entered the beat, and what the beat was sized for. */
  arrive: number;
  expected: number;
}

export interface RunTrace {
  threats: ThreatTrace[];
  contacts: ContactTrace[];
  rows: RowTrace[];
  bodyDeathGaps: number[];
  beats: BeatLoss[];
  /** Times the count fell at least `FALL` between two samples a row apart. */
  falls: number;
}

interface BlockNote {
  kind: EnemyKind;
  beat: number;
  sight: number;
  wake: number;
  count: number;
}

interface RiverNote {
  beat: number;
  sight: number;
  start: number;
  end: number;
  count: number;
  firstLeak: number;
}

interface BeatNote {
  mark: BeatMark;
  /** The column is inside the beat from here on. */
  from: number;
  threats: number;
  threatCost: number;
  curseCost: number;
  base: number;
  arrive: number;
}

/** The beat that owns something standing at `z`, or -1 on an unmarked road. */
function ownerOf(beats: readonly BeatNote[], z: number): number {
  if (beats.length === 0) return -1;
  const half = balance.level.rowSpacing / 2;
  for (let k = 0; k < beats.length; k++) {
    if (z <= (beats[k]?.mark.z ?? 0) + half) return k;
  }
  return beats.length - 1;
}

export class DesignTrace {
  private readonly blocks = new Map<number, BlockNote>();
  private readonly rivers = new Map<number, RiverNote>();
  private readonly gateBeat = new Map<number, number>();
  private readonly rowReads: RowReads;
  private readonly beatNotes: BeatNote[];
  private readonly out: RunTrace = {
    threats: [],
    contacts: [],
    rows: [],
    bodyDeathGaps: [],
    beats: [],
    falls: 0,
  };
  private primed = false;
  private sampleZ = 0;
  private lastSample = -1;
  private pendingBlock: BlockNote | null = null;
  private pendingCurse = -1;
  private last: Run | null = null;
  private time = 0;

  constructor(level: LevelDef) {
    const half = balance.level.rowSpacing / 2;
    this.rowReads = new RowReads(this.out.rows);
    this.beatNotes = (level.beats ?? []).map((mark, k, marks) => ({
      mark,
      from: k === 0 ? -Infinity : (marks[k - 1]?.z ?? 0) + half,
      threats: 0,
      threatCost: 0,
      curseCost: 0,
      base: -1,
      arrive: -1,
    }));
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

    for (const beat of this.beatNotes) {
      if (beat.arrive >= 0 || squadZ < beat.from) continue;
      beat.arrive = state.squad.count;
      if (beat.base < 0) beat.base = state.squad.count;
    }

    for (const event of events) this.onEvent(run, event, time);
    this.rowReads.read(run);
    this.sample(state.squad.count, squadZ);
  };

  private prime(run: Run): void {
    this.primed = true;
    const state = run.state;
    for (const enemy of state.enemies) {
      if (enemy.streamId !== undefined || enemy.kind === 'boss') continue;
      const beat = ownerOf(this.beatNotes, enemy.z);
      this.blocks.set(enemy.id, { kind: enemy.kind, beat, sight: -1, wake: -1, count: 0 });
      this.countThreat(beat);
    }
    for (const stream of state.streams) {
      const beat = ownerOf(this.beatNotes, stream.anchorZ ?? stream.z);
      this.rivers.set(stream.id, { beat, sight: -1, start: -1, end: -1, count: 0, firstLeak: -1 });
      this.countThreat(beat);
    }
    this.rowReads.prime(state.gates);
    for (const gate of state.gates) this.gateBeat.set(gate.id, ownerOf(this.beatNotes, gate.z));
  }

  private countThreat(beat: number): void {
    const note = this.beatNotes[beat];
    if (note !== undefined) note.threats++;
  }

  /** The squad a beat's share is taken of: the count when its first threat woke. */
  private wakeBeat(beat: number, count: number): void {
    const note = this.beatNotes[beat];
    if (note !== undefined && note.base < 0) note.base = count;
  }

  private onEvent(run: Run, event: SimEvent, time: number): void {
    const state = run.state;
    const block = this.pendingBlock;
    const curse = this.pendingCurse;
    this.pendingBlock = null;
    this.pendingCurse = -1;
    if (event.type === 'enemyActivated') {
      const note = this.blocks.get(event.enemyId);
      if (note !== undefined && note.wake < 0) {
        note.wake = time;
        note.count = state.squad.count;
        this.wakeBeat(note.beat, state.squad.count);
      }
    } else if (event.type === 'streamStarted') {
      const note = this.rivers.get(event.streamId);
      if (note !== undefined) {
        note.start = time;
        note.count = state.squad.count;
        if (note.sight < 0) note.sight = time;
        this.wakeBeat(note.beat, state.squad.count);
      }
    } else if (event.type === 'streamCleared') {
      const note = this.rivers.get(event.streamId);
      if (note !== undefined) note.end = time;
    } else if (event.type === 'enemyLeaked') {
      const note = this.rivers.get(event.streamId);
      if (note !== undefined && note.firstLeak < 0) {
        note.firstLeak = time;
        this.out.contacts.push({
          kind: 'river',
          sightToContact: time - Math.max(0, note.sight),
          wakeToContact: time - Math.max(0, note.start),
        });
      }
    } else if (event.type === 'enemyKilled') {
      if (event.streamId !== undefined) {
        this.out.bodyDeathGaps.push(event.z - state.squad.z);
      } else {
        const note = this.blocks.get(event.enemyId);
        if (note !== undefined) {
          this.endBlock(event.enemyId, note, time, event.z - state.squad.z);
          this.pendingBlock = note;
        }
      }
    } else if (event.type === 'unitsLost') {
      if (event.reason === 'contact' && block !== null) this.bookContact(block, event.amount, time);
      if (event.reason === 'gate' && curse >= 0) {
        const beat = this.beatNotes[curse];
        if (beat !== undefined) beat.curseCost += event.amount;
      }
    } else if (event.type === 'gatePassed') {
      this.pendingCurse = this.gateBeat.get(event.gateId) ?? -1;
      this.rowReads.passed(state.gates.find((gate) => gate.id === event.gateId)?.rowIndex ?? -1, event.gateId);
    }
  }

  private endBlock(id: number, note: BlockNote, time: number, gap: number): void {
    this.out.threats.push({
      kind: note.kind,
      cost: 0,
      share: 0,
      sightToEnd: note.sight < 0 ? 0 : time - note.sight,
      wakeToEnd: note.wake < 0 ? 0 : time - note.wake,
      endGap: gap,
      contact: false,
      base: note.wake < 0 ? this.last?.state.squad.count ?? 1 : note.count,
    });
    this.blocks.delete(id);
  }

  /** The block that died this step walked into a group: its cost and its warning. */
  private bookContact(note: BlockNote, amount: number, time: number): void {
    const threat = this.out.threats[this.out.threats.length - 1];
    if (threat !== undefined) {
      threat.contact = true;
      threat.endGap = 0;
      threat.cost = amount;
      threat.share = amount / Math.max(1, threat.base);
    }
    const beat = this.beatNotes[note.beat];
    if (beat !== undefined) beat.threatCost += amount;
    this.out.contacts.push({
      kind: note.kind,
      sightToContact: note.sight < 0 ? 0 : time - note.sight,
      wakeToContact: note.wake < 0 ? 0 : time - note.wake,
    });
  }

  private sample(count: number, z: number): void {
    if (z < this.sampleZ) return;
    if (this.lastSample >= 0 && count < this.lastSample * (1 - FALL)) this.out.falls++;
    this.lastSample = count;
    this.sampleZ += balance.level.rowSpacing;
  }

  /** The run's trace, with every river's leak booked as its cost and every beat closed. */
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
      const beat = this.beatNotes[note.beat];
      if (beat !== undefined) beat.threatCost += stream.leaked;
    }
    for (const beat of this.beatNotes) {
      // A beat the column never reached (the run ended first) says nothing.
      if (beat.arrive < 0) continue;
      const base = Math.max(1, beat.base < 0 ? beat.arrive : beat.base);
      this.out.beats.push({
        beat: beat.mark.beat,
        tier: beat.mark.tier,
        share: (beat.threatCost + beat.curseCost) / base,
        threatCost: beat.threatCost,
        curseCost: beat.curseCost,
        base,
        threat: beat.threats > 0,
        arrive: beat.arrive,
        expected: beat.mark.expected,
      });
    }
    return this.out;
  }
}
