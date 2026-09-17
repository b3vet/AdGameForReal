/**
 * Hand-made boards for the priced read (document 31, 4.4 and 4.5): one beat's
 * worth of road each — a guarded prize, an ambush behind a plus, a toll river,
 * a flip curse, a fork, a commit fence — built as `LevelDef`s directly so the
 * bot tests do not wait on the composer, and a way to play each one with a
 * bot or with the column held in one lane, which is how a test knows what the
 * thoughtful answer was.
 */

import { createBot } from '../bots';
import type { BotKind } from '../bots';
import { laneCenter } from '../lanes';
import type { LevelDef, RowDef, RowEnemyDef } from '../level';
import { Run } from '../Run';
import type { GateDef, GateKind, Lane, StreamDef } from '../types';
import { level } from './fixtures';
import { balance } from '@/data';
import type { Balance } from '@/data/types';

/**
 * Where every board's gate row stands, and how far past it a play runs: far
 * enough that what pours from behind the panels has met the column too.
 */
export const ROW_Z = 90;
const PAST = 24;

type Slot = GateDef | null;

export function add(value: number): GateDef {
  return { kind: 'add', value };
}
export function sub(value: number): GateDef {
  return { kind: 'sub', value };
}
export function mul(value: number): GateDef {
  return { kind: 'mul', value };
}

/**
 * Hit points per unit of a board's brute. Pinned rather than read from
 * `enemies.beat.bruteHpPerUnit`: every board below is written in units whose
 * fire time was worked out at twelve hit points each ("eighteen units is two
 * seconds of sixty soldiers' fire"), and the tuning pass moves the beat number
 * (Phase 1 wave two set it to 120), which would make every board a different
 * question without touching the boards.
 */
const BOARD_HP_PER_UNIT = 12;

/**
 * A brute `at` metres from the row, in `lane`, at `BOARD_HP_PER_UNIT` hit
 * points per unit. `narrow` holds it to its own lane, as the composer holds an
 * ambush, so the panel in front of it screens all of it.
 */
export function brute(lane: Lane, at: number, units: number, wake: number, narrow = false): RowEnemyDef {
  const def: RowEnemyDef = { kind: 'brute', lane, units, dz: at, wake, hpPerUnit: BOARD_HP_PER_UNIT };
  if (narrow) def.maxHalf = 0.95;
  return def;
}

/** A portal `at` metres from the row. */
export function portal(lane: Lane, at: number, open: number, seconds: number, count: number, hp: number): StreamDef {
  return {
    lane,
    kind: 'grunt',
    count,
    durationSeconds: seconds,
    hpPerEnemy: hp,
    speed: balance.streams.speed,
    jitter: balance.streams.jitter,
    anchorZ: ROW_Z + at,
    openAt: open,
  };
}

export interface BoardSpec {
  start: number;
  gates: [Slot, Slot, Slot];
  enemies?: RowEnemyDef[];
  streams?: StreamDef[];
  /** A fence on `boundary` from `from` metres before the row to half a metre short of it. */
  fence?: { boundary: -1 | 1; from: number };
  /** Panels grow and curses fall by a share of the squad too, as on a scripted road. */
  squadRates?: boolean;
}

export function board(spec: BoardSpec): LevelDef {
  const row: RowDef = { z: ROW_Z, gates: spec.gates, enemies: spec.enemies ?? [], streams: spec.streams ?? [] };
  const fence = spec.fence;
  const def = level({
    index: 20,
    startCount: spec.start,
    rows: [row],
    arenaZ: ROW_Z + 60,
    walls: fence === undefined ? [] : [{ boundary: fence.boundary, zStart: ROW_Z - fence.from, zEnd: ROW_Z - 0.5 }],
  });
  if (spec.squadRates === true) def.squadRates = true;
  return def;
}

export interface BoardPlay {
  /** The lane whose panel the squad walked through, or null. */
  lane: Lane | null;
  /** What that panel was when the board was built. */
  kind: GateKind | null;
  /** What it was when it was walked. */
  walked: GateKind | null;
  count: number;
}

function play(def: LevelDef, steer: (run: Run) => number, tuning: Balance): BoardPlay {
  const run = new Run(def, tuning);
  const first = new Map(run.state.gates.map((gate) => [gate.id, gate.kind]));
  let lane: Lane | null = null;
  let kind: GateKind | null = null;
  let walked: GateKind | null = null;
  for (let step = 0; step < 60 * 60 && run.state.status === 'running'; step++) {
    run.setTargetX(steer(run));
    for (const event of run.tick(1 / 60)) {
      if (event.type !== 'gatePassed') continue;
      const gate = run.state.gates.find((candidate) => candidate.id === event.gateId);
      lane = gate?.lane ?? null;
      kind = first.get(event.gateId) ?? null;
      walked = event.kind;
    }
    if (run.state.squad.z >= ROW_Z + PAST) break;
  }
  return { lane, kind, walked, count: run.state.squad.count };
}

/** The board played by a bot. */
export function playBoard(def: LevelDef, kind: BotKind, seed = 1, tuning: Balance = balance): BoardPlay {
  const bot = createBot(kind, seed, tuning);
  return play(def, (run) => bot(run.state), tuning);
}

/** The board played with the column held in `lane` from the start. */
export function holdLane(def: LevelDef, lane: Lane, tuning: Balance = balance): BoardPlay {
  const x = laneCenter(lane, tuning.road.laneWidth);
  return play(def, () => x, tuning);
}

/** The lane a column held in one lane does best in, and what it ends with. */
export function bestHeld(def: LevelDef, tuning: Balance = balance): { lane: Lane; count: number; all: number[] } {
  const all = ([-1, 0, 1] as const).map((lane) => holdLane(def, lane, tuning).count);
  let lane: Lane = -1;
  let count = -1;
  ([-1, 0, 1] as const).forEach((candidate, i) => {
    if ((all[i] ?? -1) > count) {
      count = all[i] ?? -1;
      lane = candidate;
    }
  });
  return { lane, count, all };
}
