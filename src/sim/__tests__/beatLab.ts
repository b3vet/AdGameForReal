/**
 * The beat lab (document 31, 4.4 and 5): one beat, one tier, one squad size,
 * played on many seeds by both bots, and what it cost against the rating band
 * the beat claims. Not a test file itself: `beatLabReadout.test.ts` prints the
 * whole library behind `BEATLAB=1`, and the tuning pass and `beats.test.ts`
 * (wave two) call `labBeat` for the numbers they hold a beat to.
 *
 * A beat is played on the short boss-less road `buildBeatLevel` lays for it,
 * sized for exactly the squad it is played with, so E is the starting count
 * and every share below is a share of it.
 *
 * What one play reports:
 *
 *   loss      every unit the road took (blocks, rivers, chargers, curses) over
 *             the starting squad, which is what the rating bands are written in;
 *   lane      the lane the squad took at the beat's gate row, and whether it
 *             was the prize the seed put there;
 *   decision  the best priced lane less the second, over the squad, as greedy
 *             prices them when it first reads the row — the plan's "decision
 *             value", 0.05 to 0.25 being a real choice;
 *   peakLive  the most enemies alive at once (4.7 caps a level at 180).
 */

import { lanes, exactRead, priceLanes } from '../botValue';
import { WHOLE_BOARD } from '../botPrice';
import type { BotKind } from '../bots';
import { buildBeatLevel } from '../beats/beatLevel';
import type { BeatLevelOptions } from '../beats/beatLevel';
import { findBeat, resolveTier } from '../beats/library';
import type { LevelDef } from '../level';
import type { Lane } from '../types';
import { quantile, spread } from './designTrace';
import { emptyTally, LOSS_REASONS, playDef } from './harness';
import type { LossTally } from './harness';
import { balance, beats } from '@/data';
import type { BiomeId } from '@/data/types';

/**
 * Expected loss for the reference human by rating (document 31, 3.4), as a
 * share of E. Greedy is expected at about half and never above the top.
 */
export const RATING_BANDS: Readonly<Record<number, readonly [number, number]>> = {
  0: [0, 0.02],
  1: [0.02, 0.05],
  2: [0.05, 0.1],
  3: [0.1, 0.15],
  4: [0.15, 0.22],
  5: [0.22, 0.3],
};

/** The three squad sizes a beat has to hold its band at (section 5). */
export const LAB_SIZES: readonly number[] = [30, 100, 300];

export interface BeatPlay {
  status: 'won' | 'lost';
  /** Units the road took, over the starting squad. */
  loss: number;
  byReason: LossTally;
  /** Lane taken at the beat's gate row, or null if the squad never got there. */
  lane: Lane | null;
  prize: Lane;
  /** Priced best less second at the first read, over the squad. */
  decision: number;
  /** The same on the panels' face values alone. */
  decisionFace: number;
  peakLive: number;
  /** The squad when the column reached the end of the road. */
  after: number;
}

/** The beat's gate row mark, which is where the lane taken is read. */
function markOf(level: LevelDef): { z: number; prize: Lane } {
  const mark = level.beats?.[0];
  if (mark === undefined) throw new Error('a beat level carries its mark');
  return { z: mark.z, prize: mark.prize };
}

export function playBeat(
  beatId: string,
  tier: number,
  squad: number,
  seed: number,
  kind: BotKind,
  biome: BiomeId = 'meadow',
  options: BeatLevelOptions = {},
): BeatPlay {
  const level = buildBeatLevel(beatId, tier, squad, seed, biome, options);
  const mark = markOf(level);
  const rowIndex = level.rows.findIndex((row) => Math.abs(row.z - mark.z) < 1e-6);
  const read = exactRead();
  let lane: Lane | null = null;
  let decision = -1;
  let decisionFace = 0;

  const result = playDef(level, kind, {
    player: options.player,
    botSeed: seed * 7919 + squad,
    onStep: (run, events) => {
      const state = run.state;
      if (decision < 0 && rowIndex >= 0 && mark.z - state.squad.z <= balance.bots.readDistance) {
        priceLanes(state, rowIndex, mark.z, WHOLE_BOARD, read, balance);
        const count = Math.max(1, lanes.count);
        decision = spread(lanes.worth) / count;
        decisionFace = spread(lanes.face) / count;
      }
      if (lane !== null) return;
      for (const event of events) {
        if (event.type !== 'gatePassed') continue;
        const gate = state.gates.find((candidate) => candidate.id === event.gateId);
        if (gate !== undefined && gate.rowIndex === rowIndex) lane = gate.lane;
      }
    },
  });

  const road = result.road;
  const lost = road.contact + road.leak + road.charge + road.gate + road.stomp;
  return {
    status: result.status,
    loss: lost / Math.max(1, squad),
    byReason: road,
    lane,
    prize: mark.prize,
    decision: Math.max(0, decision),
    decisionFace,
    peakLive: result.peakLive,
    after: result.survivors,
  };
}

export interface BeatReport {
  beat: string;
  tier: number;
  squad: number;
  bot: BotKind;
  runs: number;
  rating: number;
  expectLoss: number;
  band: readonly [number, number];
  lossMedian: number;
  lossMean: number;
  lossP90: number;
  lossWorst: number;
  /** Share of plays that took the prize lane. */
  prizeShare: number;
  decisionMedian: number;
  decisionFaceMedian: number;
  peakLive: number;
  /** Plays that cost nothing at all. */
  freeShare: number;
  byReason: LossTally;
  wipes: number;
}

export function labBeat(
  beatId: string,
  tier: number,
  squad: number,
  kind: BotKind,
  seeds: readonly number[],
  biome: BiomeId = 'meadow',
  options: BeatLevelOptions = {},
): BeatReport {
  const resolved = resolveTier(findBeat(options.library ?? beats, beatId), tier);
  const losses: number[] = [];
  const decisions: number[] = [];
  const faces: number[] = [];
  const byReason = emptyTally();
  let prize = 0;
  let peak = 0;
  let free = 0;
  let wipes = 0;
  for (const seed of seeds) {
    const play = playBeat(beatId, tier, squad, seed, kind, biome, options);
    losses.push(play.loss);
    decisions.push(play.decision);
    faces.push(play.decisionFace);
    if (play.lane !== null && play.lane === play.prize) prize++;
    if (play.loss <= 0) free++;
    if (play.status === 'lost') wipes++;
    peak = Math.max(peak, play.peakLive);
    for (const reason of LOSS_REASONS) byReason[reason] += play.byReason[reason];
  }
  const n = Math.max(1, seeds.length);
  return {
    beat: beatId,
    tier,
    squad,
    bot: kind,
    runs: seeds.length,
    rating: resolved.rating,
    expectLoss: resolved.expectLoss,
    band: RATING_BANDS[resolved.rating] ?? [0, 1],
    lossMedian: quantile(losses, 0.5),
    lossMean: losses.reduce((sum, value) => sum + value, 0) / n,
    lossP90: quantile(losses, 0.9),
    lossWorst: quantile(losses, 1),
    prizeShare: prize / n,
    decisionMedian: quantile(decisions, 0.5),
    decisionFaceMedian: quantile(faces, 0.5),
    peakLive: peak,
    freeShare: free / n,
    byReason,
    wipes,
  };
}
