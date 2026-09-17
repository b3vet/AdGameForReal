/**
 * Every Phase 1 beat in its rating band, in the beat lab (document 31, 4.5
 * and section 5; definition of done 3), registered as tests by `beatBands`.
 * Not a test file itself: `beats.test.ts` calls it for Meadow on the bare
 * hand, `beatsFrost.test.ts` for Frostfell on the kit, because a beat is sized
 * with its biome's measured fire (`beats.dps`, 3.4) and Frostfell's is the
 * armed hand's.
 *
 * Each cell is one beat, one tier, one of the lab's three squad sizes, played
 * on `LAB_SEEDS` roads by both bots (`./beatLab.ts`). A tier is held only at
 * the sizes the biome's scripts put it at (the tech lead's ruling in wave
 * two): the shipped campaign is composed on the balance files' ten roads, and
 * a size is held when some use of the tier has an E within `SIZE_REACH` of
 * it, or, when none has, the one size nearest the tier's median E. The charger
 * fork's tier 4 meets squads of 60 and up, so its bite floor of six units, a
 * fifth of a squad of 30, is not a band it has to hold. Held per cell:
 *
 *   band     the human's median loss inside the tier's rating band (3.4), with
 *            one soldier of slack either side: a squad of 30 loses in steps of
 *            a thirtieth, which is wider than the tier-1 band itself;
 *   ceiling  greedy's median never above the band's top (4.5);
 *   prize    at the held size nearest the reference 100, greedy takes the
 *            prize on most roads in the beats whose designed answer is the
 *            prize (`PRIZE_BEATS`);
 *   live     under 150 live enemies at once (4.5).
 *
 * And pooled over the threat beats as the biome's scripts use them (each held
 * cell weighted by the uses whose E lies nearest its size, so the pool is the
 * campaign's mix), section 5's per-beat rows as the ruling reads them: the
 * human's median loss 0.05 to 0.12, p90 at most 0.25 and p99 at most 0.40;
 * greedy's median at least 0.03 (it pays something) and never above the
 * human's (it plays better); greedy's worst no higher than the top of the
 * highest rating band the scripts use, with a cell's one soldier of slack
 * (section 5 wrote 0.25, which the tier-5 band of 0.22 to 0.30 contradicts:
 * on a river beat a committed column pays the screened tail however well it
 * plays); at most three plays in ten free to greedy; and over every gate
 * beat, the priced decision's median 0.05 to 0.25 with at most one in five
 * over 0.5.
 *
 * A failure lists every cell that is out, with the numbers a tuner turns: the
 * human's median and p90, greedy's median and prize share, the decision value,
 * the peak of live enemies and the E the scripts put the tier at.
 */

import { it } from 'vitest';

import type { BotKind } from '../bots';
import { generateLevel } from '../level';
import { LAB_SIZES, RATING_BANDS, playBeat } from './beatLab';
import type { BeatPlay } from './beatLab';
import { Findings, HUMAN_ROADS, bandText, f2, inBand, mean, seedOf } from './balanceRuns';
import { quantile } from './designTrace';
import { findBeat, resolveTier } from '../beats/library';
import { beats, levelConfig } from '@/data';
import type { BiomeId, PlayerState } from '@/data/types';

/** Roads per cell. Six keep the whole library near a minute a biome. */
export const LAB_SEEDS: readonly number[] = [1, 2, 3, 4, 5, 6];

/**
 * A size is held for a tier when some use of it has an E within this factor.
 * The ruling said "say, a factor of two"; at two the lab's windows overlap
 * (15-60, 50-200, 150-600), and the charger fork's tier 4, whose use on level
 * 38 is composed for 53 to 57 units on some roads, would still be held
 * at 30, which the ruling names as a cell to drop. One and a half keeps each
 * size to the squads nearest it (20-45, 67-150, 200-450) and gives the ruled
 * outcome; a tier whose every use falls between windows is held at the one
 * size nearest its median E.
 */
const SIZE_REACH = 1.5;

/** The size the prize rule is read at, or the held size nearest it. */
const REFERENCE_SIZE = 100;

/**
 * Beats whose designed answer is the prize (3.3's question column): read the
 * numbers (open, rest); commit early and shoot the guard down; pay the toll;
 * commit past the fence's hazard. The ambush is a close call on purpose from
 * tier 3, the fork offers two equal pluses, the flip's calm lane is the red
 * one and the prep asks units or firepower: those leave the choice open.
 */
const PRIZE_BEATS: ReadonlySet<string> = new Set(['open', 'rest', 'guard', 'shieldGuard', 'toll', 'fence']);
const PRIZE_SHARE = 0.5;

const LIVE_CEILING = 150;

const GREEDY_MEDIAN_FLOOR = 0.03;
const HUMAN_MEDIAN: readonly [number, number] = [0.05, 0.12];
const HUMAN_P90 = 0.25;
const HUMAN_P99 = 0.4;
const FREE_PLAYS = 0.3;
const DECISION_MEDIAN: readonly [number, number] = [0.05, 0.25];
const DECISION_WIDE = 0.5;
const DECISION_WIDE_SHARE = 0.2;

export interface LabBiome {
  biome: BiomeId;
  name: string;
  /** The levels whose scripts say which beats this biome plays, where, and how often. */
  from: number;
  to: number;
  /** The hand the cells are played with (Frostfell: the campaign's kit). */
  player: () => PlayerState | undefined;
  /** The hand a level of the biome is composed for, as the balance files play it. */
  levelPlayer: (level: number) => PlayerState | undefined;
}

interface Cell {
  beat: string;
  tier: number;
  size: number;
  rating: number;
  /** Uses of the tier whose E is nearest this size, over the ten roads. */
  uses: number;
  /** The E of every use of the tier, over the ten roads. */
  expected: readonly number[];
  human: BeatPlay[];
  greedy: BeatPlay[];
}

/** E at every use of every `beat:tier` in the biome, composed on the balance roads. */
function usesIn(lab: LabBiome): Map<string, number[]> {
  const uses = new Map<string, number[]>();
  for (let level = lab.from; level <= lab.to; level++) {
    const config = levelConfig(level);
    const player = lab.levelPlayer(level);
    for (const road of HUMAN_ROADS) {
      for (const mark of generateLevel(level, config, seedOf(level, road), player).beats ?? []) {
        const key = `${mark.beat}:${String(mark.tier)}`;
        const list = uses.get(key) ?? [];
        list.push(mark.expected);
        uses.set(key, list);
      }
    }
  }
  return uses;
}

const ratio = (a: number, b: number): number => Math.abs(Math.log(Math.max(1e-9, a) / Math.max(1e-9, b)));

function nearest(sizes: readonly number[], e: number): number {
  let best = sizes[0] ?? REFERENCE_SIZE;
  for (const size of sizes) if (ratio(size, e) < ratio(best, e)) best = size;
  return best;
}

/** The sizes a tier is held at, given the E of its uses. */
function heldSizes(expected: readonly number[]): number[] {
  const reach = Math.log(SIZE_REACH) + 1e-9;
  const held = LAB_SIZES.filter((size) => expected.some((e) => ratio(size, e) <= reach));
  return held.length > 0 ? held : [nearest(LAB_SIZES, quantile(expected, 0.5))];
}

/** Repeats each value `times` times: a weighted pool for `quantile`. */
function weighted(cells: readonly Cell[], pick: (cell: Cell) => number[]): number[] {
  const out: number[] = [];
  for (const cell of cells) {
    const values = pick(cell);
    for (let i = 0; i < cell.uses; i++) out.push(...values);
  }
  return out;
}

const pct = (value: number): string => value.toFixed(3);

/** Registers the beat-lab bands for one biome. */
export function beatBands(lab: LabBiome, timeout: number): void {
  let cache: Cell[] | null = null;
  const cells = (): Cell[] => {
    if (cache !== null) return cache;
    const uses = usesIn(lab);
    const player = lab.player();
    const out: Cell[] = [];
    for (const def of beats.defs) {
      for (const key of Object.keys(def.tiers)) {
        const expected = uses.get(`${def.id}:${key}`);
        if (expected === undefined || expected.length === 0) continue;
        const tier = Number(key);
        const rating = resolveTier(findBeat(beats, def.id), tier).rating;
        const sizes = heldSizes(expected);
        for (const size of sizes) {
          const plays = (bot: BotKind): BeatPlay[] =>
            LAB_SEEDS.map((seed) =>
              playBeat(def.id, tier, size, seed, bot, lab.biome, player === undefined ? {} : { player }),
            );
          out.push({
            beat: def.id,
            tier,
            size,
            rating,
            uses: expected.filter((e) => nearest(sizes, e) === size).length,
            expected,
            human: plays('human'),
            greedy: plays('greedy'),
          });
        }
      }
    }
    cache = out;
    return out;
  };

  const losses = (plays: readonly BeatPlay[]): number[] => plays.map((play) => play.loss);
  const describeCell = (cell: Cell): string =>
    `${cell.beat}:${String(cell.tier)} at ${String(cell.size)} (rating ${String(cell.rating)}, ` +
    `band ${bandText(RATING_BANDS[cell.rating] ?? [0, 1])}, scripts' E ` +
    `${quantile(cell.expected, 0).toFixed(0)}-${quantile(cell.expected, 1).toFixed(0)}): ` +
    `human median ${pct(quantile(losses(cell.human), 0.5))} p90 ${pct(quantile(losses(cell.human), 0.9))}, ` +
    `greedy median ${pct(quantile(losses(cell.greedy), 0.5))} ` +
    `prize ${f2(mean(cell.greedy.map((play) => (play.lane === play.prize ? 1 : 0))))}, ` +
    `decision ${f2(quantile(cell.greedy.map((play) => play.decision), 0.5))}, ` +
    `live ${String(Math.max(...cell.human.map((p) => p.peakLive), ...cell.greedy.map((p) => p.peakLive)))}`;

  it(`holds every ${lab.name} beat in its rating band at the sizes the scripts use`, () => {
    const findings = new Findings();
    for (const cell of cells()) {
      const band = RATING_BANDS[cell.rating] ?? [0, 1];
      const slack = 1 / cell.size;
      const human = quantile(losses(cell.human), 0.5);
      const greedy = quantile(losses(cell.greedy), 0.5);
      findings.check(`band: ${describeCell(cell)}`, human >= band[0] - slack && human <= band[1] + slack);
      findings.check(`greedy over the band: ${describeCell(cell)}`, greedy <= band[1] + slack);
    }
    findings.assert();
  }, timeout);

  it(`gives greedy the ${lab.name} prize where the beat's answer is the prize`, () => {
    const findings = new Findings();
    const all = cells();
    for (const cell of all) {
      if (!PRIZE_BEATS.has(cell.beat)) continue;
      const sizes = all.filter((other) => other.beat === cell.beat && other.tier === cell.tier).map((c) => c.size);
      if (cell.size !== nearest(sizes, REFERENCE_SIZE)) continue;
      const taken = mean(cell.greedy.map((play) => (play.lane === play.prize ? 1 : 0)));
      findings.check(`prize ${f2(taken)} under ${String(PRIZE_SHARE)}: ${describeCell(cell)}`, taken >= PRIZE_SHARE);
    }
    findings.assert();
  }, timeout);

  it(`keeps every ${lab.name} beat under ${String(LIVE_CEILING)} live enemies`, () => {
    const findings = new Findings();
    for (const cell of cells()) {
      const live = Math.max(...cell.human.map((p) => p.peakLive), ...cell.greedy.map((p) => p.peakLive));
      findings.check(`live ${String(live)}: ${describeCell(cell)}`, live < LIVE_CEILING);
    }
    findings.assert();
  }, timeout);

  it(`prices ${lab.name} threat beats as section 5 asks, in the scripts' mix`, () => {
    const findings = new Findings();
    const threats = cells().filter((cell) => cell.rating > 0);
    const top = Math.max(0, ...threats.map((cell) => cell.rating));
    const worstCeiling = (RATING_BANDS[top] ?? [0, 1])[1];
    const greedy = weighted(threats, (cell) => losses(cell.greedy));
    const human = weighted(threats, (cell) => losses(cell.human));
    const g50 = quantile(greedy, 0.5);
    const g100 = quantile(greedy, 1);
    const h50 = quantile(human, 0.5);
    const h90 = quantile(human, 0.9);
    const h99 = quantile(human, 0.99);
    findings.check(
      `${lab.name} greedy median loss ${pct(g50)}, floor ${String(GREEDY_MEDIAN_FLOOR)}`,
      g50 >= GREEDY_MEDIAN_FLOOR - 1e-9,
    );
    findings.check(`${lab.name} greedy median loss ${pct(g50)} over the human's ${pct(h50)}`, g50 <= h50 + 1e-9);
    // With the cells' own slack of one soldier: 91 of 300 is the tier-5 top.
    const over = Math.max(
      ...threats.flatMap((cell) => cell.greedy.map((play) => play.loss - worstCeiling - 1 / cell.size)),
    );
    findings.check(
      `${lab.name} greedy worst loss ${pct(g100)}, ceiling ${String(worstCeiling)} (the top of rating ` +
        `${String(top)}) and a soldier`,
      over <= 1e-9,
    );
    findings.check(
      `${lab.name} human median loss ${pct(h50)}, band ${bandText(HUMAN_MEDIAN)}`,
      inBand(h50, HUMAN_MEDIAN),
    );
    findings.check(`${lab.name} human p90 loss ${pct(h90)}, ceiling ${String(HUMAN_P90)}`, h90 <= HUMAN_P90);
    findings.check(`${lab.name} human p99 loss ${pct(h99)}, ceiling ${String(HUMAN_P99)}`, h99 <= HUMAN_P99);
    const free = mean(greedy.map((loss) => (loss <= 0 ? 1 : 0)));
    findings.check(
      `${lab.name} plays free to greedy ${f2(free)}, ceiling ${String(FREE_PLAYS)}`,
      free <= FREE_PLAYS,
    );
    findings.assert();
  }, timeout);

  it(`makes each ${lab.name} gate beat a priced decision, in the scripts' mix`, () => {
    const findings = new Findings();
    const read = weighted(cells(), (cell) => cell.greedy.map((play) => play.decision));
    const median = quantile(read, 0.5);
    const wide = mean(read.map((value) => (value > DECISION_WIDE ? 1 : 0)));
    findings.check(
      `${lab.name} decision median ${f2(median)}, band ${bandText(DECISION_MEDIAN)}`,
      inBand(median, DECISION_MEDIAN),
    );
    findings.check(
      `${lab.name} plays decided by more than ${String(DECISION_WIDE)}: ${f2(wide)}, ` +
        `ceiling ${String(DECISION_WIDE_SHARE)}`,
      wide <= DECISION_WIDE_SHARE,
    );
    findings.assert();
  }, timeout);
}
