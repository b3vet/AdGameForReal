/**
 * Shared plumbing for the balance tests: play a whole level with a bot and
 * report what happened. Not a test file itself.
 */

import { createBot } from '../bots';
import type { BotKind } from '../bots';
import { generateLevel } from '../level';
import { Run } from '../Run';
import { balance, levelConfig, levelCount } from '@/data';

/** One sim step; the bots are asked for a target every step, as the app does. */
const DT = 1 / 60;

/** A run longer than this is a stalemate and counts as a loss. */
const MAX_SECONDS = 240;

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
}

export function playLevel(levelIndex: number, seed: number, kind: BotKind): PlayResult {
  const level = generateLevel(levelIndex, levelConfig(levelIndex), seed);
  const run = new Run(level, balance);
  const bot = createBot(kind, seed * 7919 + levelIndex);

  let steps = 0;
  let bossStart = -1;
  let countAtBoss = 0;
  const maxSteps = Math.round(MAX_SECONDS / DT);
  while (run.state.status === 'running' && steps < maxSteps) {
    run.setTargetX(bot(run.state));
    run.tick(DT);
    steps++;
    if (bossStart < 0 && run.state.boss?.active === true) {
      bossStart = steps;
      countAtBoss = run.state.squad.count;
    }
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
  };
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
