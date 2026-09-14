/**
 * Shared plumbing for the balance tests: play a whole level with a bot and
 * report what happened. Not a test file itself.
 */

import { createBot } from '../bots';
import type { BotKind } from '../bots';
import { generateLevel } from '../level';
import { Run } from '../Run';
import { balance, levelConfig, levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

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
   * Units the Rime Fiend's lane charge ran over (D49).
   *
   * The sim reports a charge's dead as `contact`, like the boss's grind and
   * like walking into a block, because `UnitLossReason` is what render and
   * audio switch on and a fourth reason there would be a contract change for a
   * number only the balance bands read. They are separated here instead, off
   * the two things that are true of a charge and nothing else: the boss is
   * away from its stand (`boss.charge` is set, and `boss.ts` skips the grind
   * and the stomp entirely while it is), and no body died this step for the
   * loss to belong to.
   */
  chargeKills: number;
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
  const run = new Run(level, balance, player);
  const bot = createBot(kind, seed * 7919 + levelIndex);

  let steps = 0;
  let bossStart = -1;
  let countAtBoss = 0;
  let stompKills = 0;
  let chargeKills = 0;
  const maxSteps = Math.round(MAX_SECONDS / DT);
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
    // The boss is on its charge for the whole of this step or none of it: it
    // is set on the step the charge begins and cleared on the step it is home.
    const charging = run.state.boss?.charge !== undefined;
    let bodyDied = false;
    for (const event of events) {
      if (event.type === 'enemyKilled') {
        if (event.streamId === undefined) bodyDied = true;
        continue;
      }
      if (event.type !== 'unitsLost') continue;
      if (event.reason === 'stomp') stompKills += event.amount;
      else if (event.reason === 'contact' && charging && !bodyDied) chargeKills += event.amount;
      bodyDied = false;
    }
    if (bossStart < 0 && run.state.boss?.active === true) {
      bossStart = steps;
      countAtBoss = run.state.squad.count;
    }
    noteStragglers(run.state, stragglers, held, reachedArena);
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
    stompKills,
    chargeKills,
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
