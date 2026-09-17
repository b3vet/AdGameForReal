/**
 * The runs the balance files read (document 31, section 5), and the arithmetic
 * that turns them into the plan's metrics. Not a test file.
 *
 * Every balance file plays the levels it asserts on through `play`, which
 * builds the level exactly as the app does (the script, on a road seed), plays
 * it with one bot on one hand, and instruments it with `DesignTrace` — the
 * same trace the `DESIGN=1` readout prints — so a band here and a column there
 * are one number measured one way. Runs are cached per file: vitest gives each
 * file its own module instance, which is also why the bands are split across
 * files by the runs they need rather than kept in one: four files run in
 * parallel where one would run them in a row.
 *
 * Hands (D35, D45, D49, D54): Meadow's ordinary levels are measured on a hand
 * that bought nothing; Frostfell's, and every milestone, on the kit the human
 * campaign holds when it first walks onto the level; the tier kit is the same
 * purse spent on evolutions as well.
 */

import { expect } from 'vitest';

import type { BotKind } from '../bots';
import { runCampaign } from '../campaign';
import { generateLevel } from '../level';
import { DesignTrace, quantile } from './designTrace';
import type { RunTrace } from './designTrace';
import { playerHolding } from './fixtures';
import { playDef } from './harness';
import type { PlayResult } from './harness';
import { levelConfig, levelCount } from '@/data';
import type { PlayerState } from '@/data/types';

/** A road: the level's own seed (the one the app plays), or another seed's lane shuffle. */
export type Road = 'shipped' | number;

/**
 * Ten roads for the human, whose bands are "of ten" (D45): the shipped road
 * and nine lane shuffles of the same script (3.8). The shipped road is in
 * every sample because it is the level the owner plays.
 */
export const HUMAN_ROADS: readonly Road[] = ['shipped', 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Five for greedy, which is deterministic in its read and only has to be the ceiling. */
export const GREEDY_ROADS: readonly Road[] = ['shipped', 1, 2, 3, 4];

export type Hand = 'bare' | 'kit' | 'tiers';

/** The levels the road is not meant to give up without the kit (D45, D48, D49, D55). */
export const MILESTONES: readonly number[] = [10, 15, 20, 25, 30, 35, 40];

export const isMilestone = (level: number): boolean => MILESTONES.includes(level);

/** Frostfell's first level (D49): from here the ordinary bands are measured armed. */
export const FROST_FROM = 21;

export interface Biome {
  name: 'Meadow' | 'Frostfell';
  /** The biome's first and last level, milestones included. */
  from: number;
  to: number;
  /** The ordinary levels of the biome, in order. */
  levels: readonly number[];
  hand: Hand;
}

function ordinary(from: number, to: number): number[] {
  const out: number[] = [];
  for (let level = from; level <= to; level++) if (!isMilestone(level)) out.push(level);
  return out;
}

export const MEADOW: Biome = {
  name: 'Meadow',
  from: 1,
  to: FROST_FROM - 1,
  levels: ordinary(1, FROST_FROM - 1),
  hand: 'bare',
};
export const FROST: Biome = {
  name: 'Frostfell',
  from: FROST_FROM,
  to: levelCount,
  levels: ordinary(FROST_FROM, levelCount),
  hand: 'kit',
};

/** The hand a level's headline bands are measured on. */
export function referenceHand(level: number): Hand {
  return level < FROST_FROM && !isMilestone(level) ? 'bare' : 'kit';
}

export interface Played {
  level: number;
  road: Road;
  bot: BotKind;
  hand: Hand;
  result: PlayResult;
  trace: RunTrace;
}

const kits = new Map<Hand, Map<number, PlayerState>>();

/**
 * What the human campaign (seed 1) holds the first time it reaches each level
 * (D46). Read off the real campaign rather than written down, because the set
 * moves whenever the difficulty does: harder roads are more retries, and a
 * retry pays. `tiers` is the same purse with the Workbench's ladders on (D54).
 */
export function kitOf(hand: Hand, level: number): PlayerState | undefined {
  if (hand === 'bare') return undefined;
  let map = kits.get(hand);
  if (map === undefined) {
    map = new Map();
    const campaign = runCampaign({ bot: 'human', seed: 1, evolutions: hand === 'tiers' });
    for (const entry of campaign.levels) {
      map.set(
        entry.level,
        playerHolding({
          upgrades: entry.held.upgrades,
          staffs: entry.held.staffs,
          evolved: entry.held.evolved,
          tiers: entry.held.tiers,
          wispTier: entry.held.wispTier,
          unlockedLevel: entry.level,
        }),
      );
    }
    kits.set(hand, map);
  }
  const kit = map.get(level);
  // The campaign stops at the first level it cannot clear in twelve tries, so
  // a missing kit is a finding about the campaign, not a hand to fall back on.
  if (kit === undefined) throw new Error(`the ${hand} campaign never reached L${String(level)}`);
  return kit;
}

const played = new Map<string, Played>();

export function seedOf(level: number, road: Road): number {
  return road === 'shipped' ? levelConfig(level).seed : road;
}

export function roadName(road: Road): string {
  return road === 'shipped' ? 'shipped' : `s${String(road)}`;
}

/** One level, one road, one bot, one hand: played once per file and traced. */
export function play(level: number, road: Road, bot: BotKind, hand: Hand): Played {
  const key = `${bot}:${hand}:${String(level)}:${String(road)}`;
  const cached = played.get(key);
  if (cached !== undefined) return cached;
  const seed = seedOf(level, road);
  const player = kitOf(hand, level);
  const def = generateLevel(level, levelConfig(level), seed, player);
  const trace = new DesignTrace(def);
  const result = playDef(def, bot, { player, botSeed: seed * 7919 + level, onStep: trace.onStep });
  const run: Played = { level, road, bot, hand, result, trace: trace.finish() };
  played.set(key, run);
  return run;
}

/** Every road of `levels` for one bot on one hand (the reference hand when omitted). */
export function playAll(
  levels: readonly number[],
  bot: BotKind,
  roads: readonly Road[],
  hand?: Hand,
): Played[] {
  const out: Played[] = [];
  for (const level of levels) {
    for (const road of roads) out.push(play(level, road, bot, hand ?? referenceHand(level)));
  }
  return out;
}

/** `expect` on a labelled string, so a failure names the level and the number that broke. */
export function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

/**
 * Every broken level at once. A balance run takes minutes, and a tuning pass
 * that learns about one level a run learns slowly, so a per-level sweep
 * collects what it finds and fails once with the whole list.
 */
export class Findings {
  private readonly lines: string[] = [];

  check(where: string, ok: boolean): void {
    if (!ok) this.lines.push(where);
  }

  assert(): void {
    expect(this.lines.join('\n')).toBe('');
  }
}

export const inBand = (value: number, band: readonly [number, number]): boolean =>
  value >= band[0] - 1e-9 && value <= band[1] + 1e-9;

export const bandText = (band: readonly [number, number]): string =>
  `[${String(band[0])}, ${String(band[1])}]`;

export const f2 = (value: number): string => value.toFixed(2);

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function clearRate(runs: readonly Played[]): number {
  return share(runs.filter((run) => run.result.status === 'won').length, runs.length);
}

export const won = (runs: readonly Played[]): Played[] =>
  runs.filter((run) => run.result.status === 'won');

/**
 * Where the squad was lost, pooled: the road (blocks, chargers, rivers and
 * curses before the boss woke) against the boss (everything after, its stomps,
 * grind and charge). The two add to one.
 */
export function lossSplit(runs: readonly Played[]): { road: number; boss: number; units: number } {
  let road = 0;
  let boss = 0;
  for (const run of runs) {
    const r = run.result.road;
    const b = run.result.boss;
    road += r.contact + r.leak + r.charge + r.gate;
    boss += r.stomp + b.contact + b.leak + b.charge + b.gate + b.stomp;
  }
  return { road: share(road, road + boss), boss: share(boss, road + boss), units: road + boss };
}

/** Mean `survivors / peak` over the clears. */
export function survivorShare(runs: readonly Played[]): number {
  return mean(won(runs).map((run) => share(run.result.survivors, Math.max(1, run.result.peakCount))));
}

/** Mean boss fight over the clears, in seconds. */
export function bossSeconds(runs: readonly Played[]): number {
  return mean(won(runs).map((run) => run.result.bossSeconds));
}

/** The road losses of the human's walk as a share of its peak: threats and curses. */
export function roadLossOfPeak(runs: readonly Played[]): number {
  return mean(
    runs.map((run) => {
      const r = run.result.road;
      return share(r.contact + r.leak + r.charge + r.gate, Math.max(1, run.result.peakCount));
    }),
  );
}

/** Share of the threat beats the column walked that cost it nothing at all. */
export function freeThreatBeats(runs: readonly Played[]): { share: number; beats: number } {
  const beats = runs.flatMap((run) => run.trace.beats.filter((beat) => beat.threat));
  return { share: share(beats.filter((beat) => beat.share <= 0).length, beats.length), beats: beats.length };
}

/** Threats that took at least `DENT` of the squad, per run. */
export function dentsPerRun(runs: readonly Played[], dent: number): number {
  return mean(runs.map((run) => run.trace.threats.filter((threat) => threat.share >= dent).length));
}

/** Greedy's reads of every gate row: the median priced decision, and the share over `wide`. */
export function decisions(runs: readonly Played[], wide: number): { median: number; wide: number; rows: number } {
  const rows = runs.flatMap((run) => run.trace.rows);
  const values = rows.map((row) => row.decision);
  return {
    median: quantile(values, 0.5),
    wide: share(values.filter((value) => value > wide).length, values.length),
    rows: rows.length,
  };
}

/** Share of gate rows on which the column walked a panel that was built red. */
export function redLane(runs: readonly Played[]): number {
  const rows = runs.flatMap((run) => run.trace.rows);
  return share(rows.filter((row) => row.tookRed).length, rows.length);
}

/** The shortest warning any contact gave, and the run it was on. */
export function warningFloor(
  runs: readonly Played[],
  kind: 'sight' | 'charger',
): { seconds: number; where: string } {
  let seconds = Infinity;
  let where = 'no contact';
  for (const run of runs) {
    for (const contact of run.trace.contacts) {
      const value = kind === 'sight' ? contact.sightToContact : contact.wakeToContact;
      if (kind === 'charger' && contact.kind !== 'charger') continue;
      if (value < seconds) {
        seconds = value;
        where = `L${String(run.level)} ${roadName(run.road)} ${run.bot} ${contact.kind}`;
      }
    }
  }
  return { seconds, where };
}

/** The most enemies alive at once over the runs, and where. */
export function peakLive(runs: readonly Played[]): { live: number; where: string } {
  let live = 0;
  let where = 'none';
  for (const run of runs) {
    if (run.result.peakLive > live) {
      live = run.result.peakLive;
      where = `L${String(run.level)} ${roadName(run.road)} ${run.bot}/${run.hand}`;
    }
  }
  return { live, where };
}

/**
 * The column's count arriving at the prep beat over the E it was sized for
 * (3.4): the median over the runs that got there. NaN when none did.
 */
export function prepFit(runs: readonly Played[]): number {
  const ratios: number[] = [];
  for (const run of runs) {
    const prep = reachedPrep(run);
    if (prep === null || prep.expected <= 0) continue;
    ratios.push(prep.arrive / prep.expected);
  }
  return ratios.length === 0 ? Number.NaN : quantile(ratios, 0.5);
}

/** The prep beat (every script ends on one), if the column got that far. */
function reachedPrep(run: Played): Played['trace']['beats'][number] | null {
  const beats = run.trace.beats;
  const last = beats[beats.length - 1];
  const marks = generatedMarks(run);
  return last !== undefined && last.beat === 'prep' && beats.length === marks ? last : null;
}

function generatedMarks(run: Played): number {
  return (levelConfig(run.level).script ?? []).length;
}

/**
 * The count arriving at the last-but-one beat: the column as it enters the
 * last two, before which the scripts keep E under about 350 so a multiplier is
 * still a choice (3.4, "the 500 cap"). Null for a run that ended sooner.
 */
export function countBeforeLastTwo(run: Played): number | null {
  if (reachedPrep(run) === null) return null;
  const beats = run.trace.beats;
  return beats[beats.length - 2]?.arrive ?? null;
}

/** `L4 0.52, L9 0.61`: the levels a pooled band is worst on, for a failure message. */
export function worst(
  levels: readonly number[],
  value: (level: number) => number,
  count = 4,
  descending = true,
): string {
  const scored = levels
    .map((level) => ({ level, value: value(level) }))
    .filter((entry) => !Number.isNaN(entry.value));
  scored.sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
  return scored
    .slice(0, count)
    .map((entry) => `L${String(entry.level)} ${f2(entry.value)}`)
    .join(', ');
}
