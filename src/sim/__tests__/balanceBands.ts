/**
 * Document 31's acceptance criteria (section 5) for one biome's ordinary
 * levels, registered as tests by `biomeBands`. Not a test file itself:
 * `balance.test.ts` calls it for Meadow on the bare hand and
 * `balanceFrost.test.ts` for Frostfell on the campaign's kit (D45, D49), so the
 * two biomes are held to one list of bands written once.
 *
 * Every band here is measured on the priced greedy and the noisy human that
 * D45 was amended to (document 31, 4.4). A pooled band is read over all the
 * biome's ordinary levels, because ten roads resolve one level's rate to about
 * a tenth; per-level floors and ceilings catch the single level that breaks.
 * A failure names the metric, the target, the measured value and the levels
 * that pull it hardest, which is what the tuning pass needs to move.
 */

import { it } from 'vitest';

import {
  Findings,
  GREEDY_ROADS,
  HUMAN_ROADS,
  bandText,
  bossSeconds,
  clearRate,
  countBeforeLastTwo,
  decisions,
  dentsPerRun,
  expectTrue,
  f2,
  freeThreatBeats,
  inBand,
  lossSplit,
  mean,
  peakLive,
  play,
  playAll,
  prepFit,
  redLane,
  roadName,
  survivorShare,
  warningFloor,
  worst,
} from './balanceRuns';
import type { Biome, Played } from './balanceRuns';
import { balance, levelConfig } from '@/data';

/**
 * The reference thumb's first-try clears on ordinary levels, the biome's mean.
 *
 * Tech-lead ruling of 2026-09-17 (document 32 follow-up, D76): section 5's
 * 0.70 to 0.80 was D45's figure for a human bot that misread even obvious rows
 * three times in ten. The priced human of document 31 (4.4) reads an obvious
 * row right, so its clear rate is no longer a stand-in for the owner's 70 to
 * 80 percent, and the bosses that would pull it there were knife edges (a
 * tenth more hit points swung a level from 1.0 to 0.2), which real players,
 * who spread wider than the bot, would meet as luck. The band is held where
 * the corrected road puts the priced bot, 0.88 to 0.98, and the owner's device
 * run (document 31, Phase 3) re-sets it.
 */
/*
 * Tech-lead ruling of 2026-09-17 (D78, Phase 1 wave two close): Frostfell
 * landed on one frontier a hair outside four bands at once (clears 0.988,
 * road share 0.4497, survivors 0.501; every further loss traded one for
 * another), and two levels' prep fit and the pooled milestone road share sat
 * just under their floors. The bands below are held at that measured edge
 * rather than chased for another round: they read the priced bot, whose
 * calibration the owner's device run (document 31, Phase 3) re-sets anyway.
 */
export const CLEAR_BAND: readonly [number, number] = [0.88, 0.99];
/** Section 5: below this on one ordinary level and it is a wall, not a level. */
export const CLEAR_FLOOR = 0.35;
/** Section 5, D31: levels 1 to 3 are generous. */
export const EARLY_CLEAR_FLOOR = 0.9;
/**
 * The evolution-tier kit's ceiling on an ordinary Frostfell level
 * (`./balanceTiers.test.ts`, D54). Until D76 it also capped the plain kit per
 * level on Frostfell; that cap is dropped in favour of the biome band above.
 */
export const ARMED_CLEAR_CEILING = 0.85;

/**
 * Section 5, "the road carries the level": the human loses 45 to 65 percent
 * of what it loses before the boss wakes, so the boss takes the other 35 to 55
 * (the two rows of the plan's table are one split). Greedy, who reads the road
 * better, loses a smaller share of a smaller loss there.
 */
export const HUMAN_ROAD_SHARE: readonly [number, number] = [0.44, 0.65];
export const HUMAN_BOSS_SHARE: readonly [number, number] = [0.35, 0.56];
/** D78: the seven milestones pooled, on the kit (`./balanceMilestones.test.ts`). */
export const MILESTONE_ROAD_FLOOR = 0.43;
export const GREEDY_ROAD_SHARE: readonly [number, number] = [0.3, 0.5];

/**
 * Section 5, D45: a clear keeps a quarter to a half of its peak, with a
 * per-level ceiling from level 4 (1 to 3 are generous).
 */
export const SURVIVOR_BAND: readonly [number, number] = [0.25, 0.52];
export const SURVIVOR_CEILING = 0.6;

/**
 * Section 5, D20: twenty to thirty seconds of boss for the reference thumb,
 * per level, on its clears. Re-derived for the smaller boss share (3.7): the
 * boss bites a quarter less and its hit points are re-fitted to the count the
 * new roads deliver, so the D20 band itself is held as written. The Milestone
 * 6 widening to 19 to 35 on Meadow (a monotone ladder a bare hand could not
 * fill) and Frostfell's 33-second ceiling (one level the shopper under-armed)
 * are retired with the dealt roads they were measured on: a scripted road
 * fixes the arrival count per level (3.4's `curveTrim`), which is the freedom
 * both widenings lacked.
 */
export const BOSS_SECONDS: readonly [number, number] = [20, 30];
/**
 * Greedy brings a bigger crowd to the same boss, so its fight is shorter: the
 * floor keeps it from being a formality, and the ceiling is the thumb's own,
 * since a bigger crowd never fights longer (it was 36 on the dealt roads,
 * above the thumb's widened 35).
 */
export const GREEDY_BOSS_SECONDS: readonly [number, number] = [12, 30];

/** Section 5: at most three threat beats in ten cost greedy nothing (was 0.63 to 0.67 of threats). */
export const FREE_THREAT_BEATS = 0.3;
/** Section 5, 3.2: every threat is seen 4.5 s before it can land; a charger gives 2 s from its trigger. */
export const SIGHT_SECONDS = 4.5;
export const CHARGER_SECONDS = 2;
/** Section 5: the priced best lane beats the second by 5 to 25 percent of E, rarely by more than half. */
export const DECISION_MEDIAN: readonly [number, number] = [0.05, 0.25];
export const DECISION_WIDE = 0.5;
export const DECISION_WIDE_SHARE = 0.2;
/** Section 5: greedy walks or flips the red lane on 5 to 15 percent of gate beats (was 0.001). */
export const RED_LANE: readonly [number, number] = [0.05, 0.15];
/** Section 5: a dent is a threat that takes 8 percent of the squad; three a level from level 4. */
export const DENT = 0.08;
export const DENTS_PER_LEVEL = 3;
export const DENTS_FROM = 4;
/*
 * Retired in wave two: section 5's "where greedy's blocks die, median at least
 * 15 m out". The hold line (Phase 1 wave two: `BeatEnemy.hold`,
 * `EnemyState.holdZ`) stands every scripted block on the gateway a metre in
 * front of its row, so a block that costs anything ends at contact, and every
 * brute and shielded brute in `beats.json` holds; chargers are runners and were
 * never in the measure, so no walking block is left to hold to it. The
 * readout still prints where threats end (`DESIGN=1`).
 */
/** Section 5, 4.7: 180 live enemies at most, on every level and road (`maxLive` 300 stays the ceiling). */
export const PEAK_LIVE = 180;
/** 3.4: `curveTrim` is fitted so E matches the human's median count within 15 percent. */
export const CURVE_FIT = 0.15;
/**
 * D78: up to `CURVE_FIT_WIDE_LEVELS` levels a biome may miss by as much as
 * this, where a toll or fence screens the first multiplier and the shared
 * curve under-credits the shoot-up (Frostfell's 23 and 28).
 */
export const CURVE_FIT_WIDE = 0.25;
export const CURVE_FIT_WIDE_LEVELS = 2;

type Runs = (level: number) => Played[];

const level$ = (level: number): string => `L${String(level)}`;

/** Registers the section 5 bands for one biome's ordinary levels. */
export function biomeBands(biome: Biome, timeout: number): void {
  const { levels, hand, name } = biome;
  const human: Runs = (level) => HUMAN_ROADS.map((road) => play(level, road, 'human', hand));
  const greedy: Runs = (level) => GREEDY_ROADS.map((road) => play(level, road, 'greedy', hand));
  const allHuman = (): Played[] => playAll(levels, 'human', HUMAN_ROADS, hand);
  const allGreedy = (): Played[] => playAll(levels, 'greedy', GREEDY_ROADS, hand);

  it(`clears ${name}'s ordinary levels at the rate D76 holds the priced thumb to`, () => {
    const findings = new Findings();
    const rate = (level: number): number => clearRate(human(level));
    for (const level of levels) {
      const where = `${level$(level)} human ${hand} clears ${f2(rate(level))}`;
      findings.check(`${where}, floor ${String(CLEAR_FLOOR)}`, rate(level) >= CLEAR_FLOOR);
      if (level <= 3) {
        findings.check(`${where}, early floor ${String(EARLY_CLEAR_FLOOR)}`, rate(level) >= EARLY_CLEAR_FLOOR);
      }
    }
    const pooled = mean(levels.map(rate));
    const easy = pooled > CLEAR_BAND[1];
    findings.check(
      `${name} clears ${pooled.toFixed(3)}, band ${bandText(CLEAR_BAND)} ` +
        `(${easy ? 'easiest' : 'hardest'}: ${worst(levels, rate, 4, easy)})`,
      inBand(pooled, CLEAR_BAND),
    );
    findings.assert();
  }, timeout);

  it(`lets greedy clear every ${name} level on every road`, () => {
    // Document 31, 7: a beat greedy cannot clear at its reference size is a
    // beat to fix, not a band to widen.
    const findings = new Findings();
    for (const level of levels) {
      for (const run of greedy(level)) {
        findings.check(`${level$(level)} ${roadName(run.road)} greedy ${hand} lost`, run.result.status === 'won');
      }
    }
    findings.assert();
  }, timeout);

  it(`moves most of the ${name} losses onto the road`, () => {
    const findings = new Findings();
    const h = lossSplit(allHuman());
    const g = lossSplit(allGreedy());
    const road = (runs: Runs) => (level: number) => lossSplit(runs(level)).road;
    findings.check(
      `${name} human road share ${f2(h.road)}, band ${bandText(HUMAN_ROAD_SHARE)}; boss ${f2(h.boss)}, ` +
        `band ${bandText(HUMAN_BOSS_SHARE)} (furthest: ${worst(levels, road(human), 4, h.road > HUMAN_ROAD_SHARE[1])})`,
      inBand(h.road, HUMAN_ROAD_SHARE) && inBand(h.boss, HUMAN_BOSS_SHARE),
    );
    findings.check(
      `${name} greedy road share ${f2(g.road)}, band ${bandText(GREEDY_ROAD_SHARE)} ` +
        `(furthest: ${worst(levels, road(greedy), 4, g.road > GREEDY_ROAD_SHARE[1])})`,
      inBand(g.road, GREEDY_ROAD_SHARE),
    );
    findings.assert();
  }, timeout);

  it(`leaves a ${name} clear with a quarter to a half of its peak`, () => {
    const findings = new Findings();
    const late = levels.filter((level) => level >= 4);
    const kept = (level: number): number => survivorShare(human(level));
    for (const level of late) {
      findings.check(
        `${level$(level)} survivors ${f2(kept(level))}, ceiling ${String(SURVIVOR_CEILING)}`,
        kept(level) <= SURVIVOR_CEILING,
      );
    }
    const pooled = mean(late.map(kept));
    findings.check(
      `${name} survivors ${pooled.toFixed(3)}, band ${bandText(SURVIVOR_BAND)}`,
      inBand(pooled, SURVIVOR_BAND),
    );
    findings.assert();
  }, timeout);

  it(`makes every ${name} boss a fight of twenty to thirty seconds`, () => {
    const findings = new Findings();
    for (const level of levels) {
      const boss = levelConfig(level).boss;
      const recipe = `hp ${String(boss.hp)}, bite ${String(boss.bite)}`;
      const thumb = bossSeconds(human(level));
      findings.check(
        `${level$(level)} boss ${thumb.toFixed(1)} s for the thumb, band ${bandText(BOSS_SECONDS)} (${recipe})`,
        inBand(thumb, BOSS_SECONDS),
      );
      const ceiling = mean(greedy(level).map((run) => run.result.bossSeconds));
      findings.check(
        `${level$(level)} boss ${ceiling.toFixed(1)} s for greedy, band ${bandText(GREEDY_BOSS_SECONDS)} (${recipe})`,
        inBand(ceiling, GREEDY_BOSS_SECONDS),
      );
    }
    findings.assert();
  }, timeout);

  it(`stands no ${name} boss smaller than the one before`, () => {
    // 3.7: hit points re-derived per level, and the ladder stays monotone, so
    // a player never meets a smaller boss than the last. Milestones included.
    const findings = new Findings();
    for (let level = biome.from + 1; level <= biome.to; level++) {
      const hp = levelConfig(level).boss.hp;
      const before = levelConfig(level - 1).boss.hp;
      findings.check(`${level$(level)} boss hp ${String(hp)} under L${String(level - 1)}'s ${String(before)}`, hp >= before);
    }
    findings.assert();
  });

  it(`makes most ${name} threat beats cost greedy something`, () => {
    const free = freeThreatBeats(allGreedy());
    const byLevel = (level: number): number => freeThreatBeats(greedy(level)).share;
    expectTrue(
      `${name} threat beats free to greedy ${f2(free.share)} of ${String(free.beats)}, ` +
        `ceiling ${String(FREE_THREAT_BEATS)} (freest: ${worst(levels, byLevel)})`,
      free.share <= FREE_THREAT_BEATS,
    );
  }, timeout);

  it(`gives every ${name} threat time to be seen`, () => {
    const findings = new Findings();
    const runs = [...allHuman(), ...allGreedy()];
    const sight = warningFloor(runs, 'sight');
    findings.check(
      `${name} shortest sight to contact ${sight.seconds.toFixed(2)} s, floor ${String(SIGHT_SECONDS)} (${sight.where})`,
      sight.seconds >= SIGHT_SECONDS,
    );
    const charger = warningFloor(runs, 'charger');
    findings.check(
      `${name} shortest charger trigger to contact ${charger.seconds.toFixed(2)} s, ` +
        `floor ${String(CHARGER_SECONDS)} (${charger.where})`,
      charger.seconds >= CHARGER_SECONDS,
    );
    findings.assert();
  }, timeout);

  it(`makes each ${name} gate row a priced decision`, () => {
    const findings = new Findings();
    const read = decisions(allGreedy(), DECISION_WIDE);
    const median = (level: number): number => decisions(greedy(level), DECISION_WIDE).median;
    const flat = read.median < DECISION_MEDIAN[0];
    findings.check(
      `${name} decision median ${f2(read.median)} over ${String(read.rows)} rows, band ${bandText(DECISION_MEDIAN)} ` +
        `(${flat ? 'flattest' : 'widest'}: ${worst(levels, median, 4, !flat)})`,
      inBand(read.median, DECISION_MEDIAN),
    );
    const wide = (level: number): number => decisions(greedy(level), DECISION_WIDE).wide;
    findings.check(
      `${name} rows decided by more than ${String(DECISION_WIDE)} of E: ${f2(read.wide)}, ` +
        `ceiling ${String(DECISION_WIDE_SHARE)} (most: ${worst(levels, wide)})`,
      read.wide <= DECISION_WIDE_SHARE,
    );
    findings.assert();
  }, timeout);

  it(`makes greedy take a ${name} red lane now and then`, () => {
    const taken = redLane(allGreedy());
    const byLevel = (level: number): number => redLane(greedy(level));
    expectTrue(
      `${name} gate rows greedy took red ${f2(taken)}, band ${bandText(RED_LANE)} ` +
        `(furthest: ${worst(levels, byLevel, 4, taken > RED_LANE[1])})`,
      inBand(taken, RED_LANE),
    );
  }, timeout);

  it(`dents the ${name} thumb three times a level`, () => {
    const late = levels.filter((level) => level >= DENTS_FROM);
    const dents = (level: number): number => dentsPerRun(human(level), DENT);
    const pooled = mean(late.map(dents));
    expectTrue(
      `${name} dents ${pooled.toFixed(2)} a level from L${String(DENTS_FROM)}, floor ${String(DENTS_PER_LEVEL)} ` +
        `(fewest: ${worst(late, dents, 4, false)})`,
      pooled >= DENTS_PER_LEVEL,
    );
  }, timeout);

  it(`keeps every ${name} road under ${String(PEAK_LIVE)} live enemies`, () => {
    const peak = peakLive([...allHuman(), ...allGreedy()]);
    expectTrue(
      `${name} peak live enemies ${String(peak.live)}, ceiling ${String(PEAK_LIVE)} (${peak.where})`,
      peak.live <= PEAK_LIVE,
    );
  }, timeout);

  it(`sizes each ${name} road for the crowd the thumb brings, and keeps greedy off the cap`, () => {
    const findings = new Findings();
    const cap = balance.squad.maxCount;
    let wide = 0;
    for (const level of levels) {
      const fit = prepFit(human(level));
      const trim = levelConfig(level).curveTrim ?? 1;
      const miss = Math.abs(fit - 1);
      if (miss > CURVE_FIT && miss <= CURVE_FIT_WIDE) wide += 1;
      findings.check(
        `${level$(level)} thumb reaches the prep beat with ${f2(fit)} of E, within ${String(CURVE_FIT)} ` +
          `of 1 (${String(CURVE_FIT_WIDE)} on at most ${String(CURVE_FIT_WIDE_LEVELS)} levels; curveTrim ${String(trim)})`,
        miss <= CURVE_FIT || (miss <= CURVE_FIT_WIDE && wide <= CURVE_FIT_WIDE_LEVELS),
      );
      const counts = greedy(level)
        .map(countBeforeLastTwo)
        .filter((count): count is number => count !== null);
      const before = mean(counts);
      findings.check(
        `${level$(level)} greedy enters the last two beats with ${before.toFixed(0)}, under the cap ${String(cap)}`,
        counts.length > 0 && before < cap,
      );
    }
    findings.assert();
  }, timeout);
}
