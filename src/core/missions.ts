/**
 * The three missions on the board (D51): where they come from, what counts
 * towards them, and what one finished run does to them.
 *
 * Three rules shape this file:
 *
 *   the sim stays pure    nothing here is asked of `src/sim`. A mission is
 *                         counted in core, off the events a run already emits
 *                         and off the state the session already holds, so
 *                         adding a mission can never change a run.
 *   the draw is seeded    `MissionsState.rolled` is the whole of the board's
 *                         memory: draw n is `mulberry32(n)` over the pool
 *                         minus what is already on the board, so two devices
 *                         with the same save show the same three missions and
 *                         a reload never re-rolls them.
 *   nothing allocates     `RunTracker.absorb` runs inside the frame loop, once
 *                         per sim chunk. It is counters and a loop over the
 *                         events the session is already walking; the one
 *                         object it makes is the tally, at the end of the run.
 */

import { missionDef, missions as missionsData } from '@/data';
import type { MissionDef, MissionKind, MissionState, MissionsState } from '@/data';
import { mulberry32 } from '@/sim';
import type { EnemyKind, RunState, SimEvent } from '@/sim';

import type { KillCounts } from './bestiary';
import { emptyKills } from './bestiary';

/** How many missions the board holds at once. Three (D51). */
export const boardSize = Math.max(1, Math.floor(missionsData.board.active));

/**
 * What one finished run did, in the vocabulary the missions count in.
 *
 * Built once, when the run ends. Everything on it is either a count over the
 * whole run or a fact about how it ended, which is exactly the set of things a
 * mission can ask for without the sim knowing missions exist.
 */
export interface RunTally {
  /** A campaign level walked to its end. Endless never sets it (D52). */
  cleared: boolean;
  /** This was an endless run, so `metres` is the score and `cleared` is not. */
  endless: boolean;
  /** Units alive at the end. Only meaningful on a cleared run. */
  survivors: number;
  peak: number;
  shieldsBroken: number;
  chargersKilled: number;
  mulGates: number;
  /** Seconds from the arena gate to the boss's death, or null if it lived. */
  bossSeconds: number | null;
  /** True when no unit was ever cut off behind a fence (D44 straggler groups). */
  cleanColumn: boolean;
  /** Metres of endless road walked; 0 on a campaign run. */
  metres: number;
  /** Kills by kind, for the bestiary's ladders (D53). */
  kills: KillCounts;
}

/**
 * Counts one run, a sim chunk at a time.
 *
 * Owned by `RunSession`, which already walks every event for the bestiary, so
 * this is one more pass over a list that is in cache rather than a second
 * subscription. It holds numbers only, and one tracker belongs to one run:
 * a new run is a new session, which is a new tracker.
 */
export class RunTracker {
  /** Which boss this road ends with, so its death lands on the right counter. */
  private readonly bossKind: 'demon' | 'rime';

  private shields = 0;
  private muls = 0;
  private stragglers = false;
  private bossAt: number | null = null;
  private bossSeconds: number | null = null;
  private readonly kills: KillCounts = emptyKills();

  constructor(bossKind: 'demon' | 'rime') {
    this.bossKind = bossKind;
  }

  /**
   * One sim chunk's events, plus the state they left behind.
   *
   * The state is read for two things only: the clock the boss timer runs on,
   * and whether any straggler group is alive right now. Both are cheap reads
   * off an object the caller already has.
   */
  absorb(events: readonly SimEvent[], state: RunState): void {
    for (const event of events) {
      switch (event.type) {
        case 'shieldBreak':
          this.shields += 1;
          break;
        case 'enemyKilled':
          this.countKill(event.kind);
          break;
        case 'gatePassed':
          if (event.kind === 'mul') this.muls += 1;
          break;
        case 'bossActivated':
          // The arena gate: the clock a `bossUnder` mission is measured on.
          this.bossAt = state.time;
          break;
        case 'bossKilled':
          this.kills[this.bossKind] += 1;
          if (this.bossSeconds === null && this.bossAt !== null) {
            this.bossSeconds = Math.max(0, state.time - this.bossAt);
          }
          break;
        default:
          break;
      }
    }

    // A straggler group is live exactly while its count is above zero (D44).
    // Index 0 is the main column and is always live, so it is skipped.
    const groups = state.groups;
    if (groups !== undefined && !this.stragglers) {
      for (let i = 1; i < groups.length; i++) {
        const group = groups[i];
        if (group !== undefined && group.count > 0) {
          this.stragglers = true;
          break;
        }
      }
    }
  }

  /** What the run adds up to. Called once, when the run has finished. */
  tally(state: RunState, endlessMetres: number | null): RunTally {
    const endless = endlessMetres !== null;
    return {
      cleared: !endless && state.status === 'won',
      endless,
      survivors: Math.max(0, Math.floor(state.survivors)),
      peak: Math.max(0, Math.floor(state.peakCount)),
      shieldsBroken: this.shields,
      chargersKilled: this.kills.charger,
      mulGates: this.muls,
      bossSeconds: this.bossSeconds,
      cleanColumn: !this.stragglers,
      metres: Math.max(0, endlessMetres ?? 0),
      kills: { ...this.kills },
    };
  }

  private countKill(kind: EnemyKind): void {
    // The boss is counted on `bossKilled`, where the variant is known; a body
    // of kind `boss` here would double-count it against the wrong ladder.
    if (kind === 'boss') return;
    this.kills[kind] += 1;
  }
}

// --- The board -------------------------------------------------------------

/**
 * What a mission is measured against on the board.
 *
 * `bossUnder` is the exception the pool's schema names: its `param` is a time
 * the run has to beat, not a count to climb, so the bar it fills is one step
 * wide and a run either takes it or does not.
 */
export function missionTarget(def: MissionDef): number {
  return def.kind === 'bossUnder' ? 1 : Math.max(1, def.param);
}

/** One row of the board, ready to paint. */
export interface MissionView {
  id: string;
  kind: MissionKind;
  text: string;
  progress: number;
  target: number;
  reward: number;
  done: boolean;
}

/** The board itself: what the Academy's missions room shows (D51). */
export function missionBoard(state: MissionsState): MissionView[] {
  const rows: MissionView[] = [];
  for (const mission of state.active) {
    const def = missionDef(mission.id);
    if (def === null) continue;
    const target = missionTarget(def);
    rows.push({
      id: def.id,
      kind: def.kind,
      text: def.text,
      progress: Math.min(target, Math.max(0, mission.progress)),
      target,
      reward: def.reward,
      done: mission.done,
    });
  }
  return rows;
}

/**
 * Fills the board, dropping whatever is finished.
 *
 * Called at the start of a play session and nowhere else (D51: "done missions
 * are replaced at the next session start"), so a mission completed on the
 * result sheet stays on the board with its tick until the player comes back —
 * which is the only moment the tick is worth anything to them.
 *
 * Returns null when the board is already three live missions, so the caller
 * can skip a save it does not owe.
 */
export function rollMissions(state: MissionsState): MissionsState | null {
  const kept: MissionState[] = [];
  for (const mission of state.active) {
    if (mission.done || missionDef(mission.id) === null) continue;
    if (kept.some((other) => other.id === mission.id)) continue;
    kept.push({ ...mission });
  }

  let rolled = Math.max(0, Math.floor(state.rolled));
  const changed = kept.length !== state.active.length;
  while (kept.length < boardSize) {
    const drawn = draw(rolled, kept);
    rolled += 1;
    // Every mission in the pool is already on the board: a board smaller than
    // three is the honest answer, and the loop has to stop.
    if (drawn === null) break;
    kept.push({ id: drawn.id, progress: 0, done: false });
  }

  if (!changed && rolled === state.rolled) return null;
  return { active: kept, rolled };
}

/**
 * Draw number `rolled`, over the pool minus what is on the board.
 *
 * `mulberry32(rolled)` rather than one stream advanced three times, so a board
 * can be rebuilt from `rolled` alone: the save carries one integer and the draw
 * is a function of it (the plan's "drawn seeded (mulberry32 over `rolled`)").
 */
function draw(rolled: number, taken: readonly MissionState[]): MissionDef | null {
  const eligible = missionsData.pool.filter(
    (def) => !taken.some((mission) => mission.id === def.id),
  );
  if (eligible.length === 0) return null;
  const index = Math.min(eligible.length - 1, Math.floor(mulberry32(rolled)() * eligible.length));
  return eligible[index] ?? null;
}

// --- Progress --------------------------------------------------------------

/** What a finished run did to the board. */
export interface MissionOutcome {
  missions: MissionsState;
  /** Coins the missions completed on this run are worth, paid once. */
  coins: number;
  /** Missions that crossed their target on this run, for the result sheet. */
  completed: MissionView[];
  changed: boolean;
}

/**
 * Applies a finished run to the board.
 *
 * Progress is one of two shapes and the kind says which: a *count* that climbs
 * across runs (roads walked, shields broken) and a *best* that only a single
 * run can set (survivors at the arena, metres of endless road, a boss killed
 * inside the clock). A best is written with `Math.max` rather than added, so
 * three runs of forty survivors never add up to "reach an arena with ninety".
 *
 * A mission that is already done is left exactly as it is: it has been paid,
 * and the next session start is what replaces it.
 */
export function applyMissions(state: MissionsState, tally: RunTally): MissionOutcome {
  const active: MissionState[] = [];
  const completed: MissionView[] = [];
  let coins = 0;
  let changed = false;

  for (const mission of state.active) {
    const def = missionDef(mission.id);
    if (def === null || mission.done) {
      active.push(mission);
      continue;
    }

    const target = missionTarget(def);
    const progress = Math.min(target, Math.max(0, advance(def, mission.progress, tally)));
    if (progress === mission.progress) {
      active.push(mission);
      continue;
    }

    changed = true;
    const done = progress >= target;
    active.push({ id: mission.id, progress, done });
    if (!done) continue;

    coins += Math.max(0, Math.round(def.reward));
    completed.push({
      id: def.id,
      kind: def.kind,
      text: def.text,
      progress: target,
      target,
      reward: def.reward,
      done: true,
    });
  }

  return { missions: { active, rolled: state.rolled }, coins, completed, changed };
}

function advance(def: MissionDef, progress: number, tally: RunTally): number {
  switch (def.kind) {
    case 'clearLevel':
      return tally.cleared ? progress + 1 : progress;
    case 'finishWith':
      // The count that matters is the crowd that *arrived*, so only a cleared
      // road can set it; a wipe at the last row brought nobody anywhere.
      return tally.cleared ? Math.max(progress, tally.survivors) : progress;
    case 'breakShields':
      return progress + tally.shieldsBroken;
    case 'killChargers':
      return progress + tally.chargersKilled;
    case 'noStragglers':
      return tally.cleared && tally.cleanColumn ? progress + 1 : progress;
    case 'bossUnder': {
      const seconds = tally.bossSeconds;
      return seconds !== null && seconds <= def.param ? 1 : progress;
    }
    case 'mulGates':
      return progress + tally.mulGates;
    case 'endlessMetres':
      return tally.endless ? Math.max(progress, Math.floor(tally.metres)) : progress;
    default:
      return progress;
  }
}
