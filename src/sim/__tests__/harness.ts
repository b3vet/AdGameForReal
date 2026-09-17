/**
 * Shared plumbing for the balance tests: play a whole level with a bot and
 * report what happened. Not a test file itself.
 *
 * `playDef` is the same loop for a level built by hand or by the beat lab
 * (`./beatLab.ts`), with a hook that sees every step's events, which is how
 * the design readout (`./designReadout.test.ts`) instruments a run without a
 * second copy of the loop.
 */

import { createBot } from '../bots';
import type { BotKind } from '../bots';
import { generateLevel } from '../level';
import type { LevelDef } from '../level';
import { Run } from '../Run';
import type { SimEvent, UnitLossReason } from '../types';
import { balance, levelConfig, levelCount } from '@/data';
import type { Balance, PlayerState } from '@/data/types';

/** One sim step; the bots are asked for a target every step, as the app does. */
const DT = 1 / 60;

/** A run longer than this is a stalemate and counts as a loss. */
const MAX_SECONDS = 240;

/** What a straggler group cost and what came back from it (D44). */
export interface StragglerTally {
  /** Groups the level's fences cut off during the run. */
  groups: number;
  /** Units in them the moment they were cut. */
  units: number;
  /** Groups that walked home when their fence released them. */
  rejoined: number;
  /** Units alive in those groups when they rejoined. */
  unitsRejoined: number;
  /** Groups whose last member died before the fence let them go. */
  wiped: number;
  /** Groups still fighting on their own when the column reached the arena. */
  atArena: number;
}

/** Units lost, by the reason the sim gave (`UnitLossReason`). */
export type LossTally = Record<UnitLossReason, number>;

export const LOSS_REASONS: readonly UnitLossReason[] = ['contact', 'gate', 'stomp', 'leak', 'charge'];

export function emptyTally(): LossTally {
  return { contact: 0, gate: 0, stomp: 0, leak: 0, charge: 0 };
}

export interface PlayResult {
  status: 'won' | 'lost';
  survivors: number;
  peakCount: number;
  seconds: number;
  /** Sim seconds between the boss activating and the run ending. */
  bossSeconds: number;
  /** Squad size the moment the boss woke up, or 0 if it never did. */
  countAtBoss: number;
  /** Boss hp still standing when the run ended. */
  bossHpLeft: number;
  /** Units lost to stream bodies walking into the squad. */
  leaked: number;
  /** Mean `leaked / count` over the streams that actually started. */
  leakShare: number;
  /** Streams that started during the run. */
  streamsSeen: number;
  /** Worst single stream's `leaked / count`. */
  worstLeakShare: number;
  /** What the fences cut off on the way (D44). */
  stragglers: StragglerTally;
  /** Units the boss's stomps took (D31's `bite` is what scales them). */
  stompKills: number;
  /**
   * Units the Rime Fiend's lane charge ran over (D49). Their own loss reason
   * since document 29, which the feedback needed as much as this count did.
   */
  chargeKills: number;
  /**
   * Every unit lost before the boss woke, by reason: blocks and chargers
   * (`contact`), river bodies (`leak`), curses (`gate`). The road half of
   * document 31's "where the squad is lost".
   */
  road: LossTally;
  /** The same from the moment the boss woke: its stomps, grind and charge. */
  boss: LossTally;
  /** Most enemies alive at once, boss excluded (document 31, 4.7). */
  peakLive: number;
}

/** What `playDef` hands its hook each step, besides the run itself. */
export type StepHook = (run: Run, events: readonly SimEvent[], step: number) => void;

export interface PlayOptions {
  player?: PlayerState | undefined;
  /** The tuning the run and the bot are built on. */
  balance?: Balance;
  /** The bot's own seed; `playLevel` derives it from the road's. */
  botSeed?: number;
  /** Called after every step with that step's events (copy what you keep). */
  onStep?: StepHook;
  /** Stop once the squad is past this `z` (the beat lab's short road). */
  untilZ?: number;
  /** A cap on simulated seconds, below the stalemate one. */
  maxSeconds?: number;
}

/**
 * `player` is optional and a player who has bought nothing is the identity
 * (D35): the ordinary bands are measured without one, and the milestone levels
 * are measured both ways — with nothing, and with the set the economy affords
 * by then (D45).
 */
export function playLevel(
  levelIndex: number,
  seed: number,
  kind: BotKind,
  player?: PlayerState,
): PlayResult {
  const level = generateLevel(levelIndex, levelConfig(levelIndex), seed, player);
  return playDef(level, kind, { player, botSeed: seed * 7919 + levelIndex });
}

/** Plays a built level with one bot. See `PlayOptions`. */
export function playDef(level: LevelDef, kind: BotKind, options: PlayOptions = {}): PlayResult {
  const tuning = options.balance ?? balance;
  const run = new Run(level, tuning, options.player);
  const bot = createBot(kind, options.botSeed ?? level.seed, tuning);

  let steps = 0;
  let bossStart = -1;
  let countAtBoss = 0;
  let peakLive = 0;
  const road = emptyTally();
  const boss = emptyTally();
  const maxSteps = Math.round(Math.min(MAX_SECONDS, options.maxSeconds ?? MAX_SECONDS) / DT);
  const stragglers: StragglerTally = {
    groups: 0,
    units: 0,
    rejoined: 0,
    unitsRejoined: 0,
    wiped: 0,
    atArena: 0,
  };
  // Per straggler group: the count it carried at the end of the previous step,
  // so a cut (0 to n) and a release (n to 0) are read off the edges.
  const held: number[] = [];
  const reachedArena: boolean[] = [];

  while (run.state.status === 'running' && steps < maxSteps) {
    run.setTargetX(bot(run.state));
    const events = run.tick(DT);
    steps++;
    // Booked before the boss edge below: a stomp on the step the boss wakes is
    // not possible (it wakes before it stomps), and a curse on that step is
    // still the road's.
    const tally = bossStart < 0 ? road : boss;
    for (const event of events) {
      if (event.type === 'unitsLost') tally[event.reason] += event.amount;
    }
    if (bossStart < 0 && run.state.boss?.active === true) {
      bossStart = steps;
      countAtBoss = run.state.squad.count;
    }
    let live = 0;
    for (const enemy of run.state.enemies) if (enemy.alive && enemy.kind !== 'boss') live++;
    if (live > peakLive) peakLive = live;
    noteStragglers(run.state, stragglers, held, reachedArena);
    options.onStep?.(run, events, steps);
    if (options.untilZ !== undefined && run.state.squad.z >= options.untilZ) break;
  }

  const state = run.state;
  let leaked = 0;
  let shareTotal = 0;
  let worst = 0;
  let seen = 0;
  for (const stream of state.streams) {
    if (!stream.started) continue;
    seen++;
    leaked += stream.leaked;
    const share = stream.leaked / Math.max(1, stream.count);
    shareTotal += share;
    if (share > worst) worst = share;
  }

  return {
    status: state.status === 'won' ? 'won' : 'lost',
    survivors: state.survivors,
    peakCount: state.peakCount,
    seconds: steps * DT,
    bossSeconds: bossStart < 0 ? 0 : (steps - bossStart) * DT,
    countAtBoss,
    bossHpLeft: state.boss?.hp ?? 0,
    leaked,
    leakShare: seen > 0 ? shareTotal / seen : 0,
    streamsSeen: seen,
    worstLeakShare: worst,
    stragglers,
    stompKills: boss.stomp + road.stomp,
    chargeKills: boss.charge + road.charge,
    road,
    boss,
    peakLive,
  };
}

/**
 * Reads this step's straggler edges off the groups.
 *
 * A group that empties with its lane released (`lane === null`) walked home —
 * `CrowdSim.rejoinToMain` clears the lane as it moves everybody across — and one
 * that empties still confined to a lane died where it stood.
 */
function noteStragglers(
  state: { arenaZ: number; groups?: ReadonlyArray<{ count: number; z: number; lane: number | null }> },
  tally: StragglerTally,
  held: number[],
  reachedArena: boolean[],
): void {
  const groups = state.groups;
  if (groups === undefined) return;
  for (let g = 1; g < groups.length; g++) {
    const group = groups[g];
    if (group === undefined) continue;
    const before = held[g] ?? 0;
    if (before === 0 && group.count > 0) {
      tally.groups++;
      tally.units += group.count;
      reachedArena[g] = false;
    }
    if (before > 0 && group.count === 0) {
      if (group.lane === null) {
        tally.rejoined++;
        tally.unitsRejoined += before;
      } else {
        tally.wiped++;
      }
    }
    if (group.count > 0 && group.lane !== null && group.z >= state.arenaZ - 1e-6) {
      if (reachedArena[g] !== true) {
        reachedArena[g] = true;
        tally.atArena++;
      }
    }
    held[g] = group.count;
  }
}

export interface BotSummary {
  kind: BotKind;
  /** Wins per level index (1-based), summed over the seed set. */
  winsByLevel: number[];
  /** Mean levels lost per seed, out of `levelCount`. */
  meanLosses: number;
  /** Mean of `survivors / peakCount` over won runs. */
  meanSurvivorShare: number;
}

export function summarise(kind: BotKind, seeds: readonly number[]): BotSummary {
  const winsByLevel = new Array<number>(levelCount).fill(0);
  let losses = 0;
  let shareTotal = 0;
  let shareCount = 0;

  for (const seed of seeds) {
    for (let level = 1; level <= levelCount; level++) {
      const result = playLevel(level, seed, kind);
      if (result.status === 'won') {
        winsByLevel[level - 1] = (winsByLevel[level - 1] ?? 0) + 1;
        shareTotal += result.peakCount > 0 ? result.survivors / result.peakCount : 0;
        shareCount++;
      } else {
        losses++;
      }
    }
  }

  return {
    kind,
    winsByLevel,
    meanLosses: losses / seeds.length,
    meanSurvivorShare: shareCount > 0 ? shareTotal / shareCount : 0,
  };
}
