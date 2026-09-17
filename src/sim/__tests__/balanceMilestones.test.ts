/**
 * The seven milestone levels (10, 15, 20, 25, 30, 35, 40; D45, D48, D49, D55)
 * on the scripted campaign. The owner's answer 1 to document 30 asks for them
 * to be genuinely hard; document 31 keeps D45's gating (section 5). What that
 * is measured as, level by level, on ten roads:
 *
 *   armed   the human carrying the kit the campaign holds when it first
 *           arrives clears four to six first tries in ten. D45's "about 60
 *           percent", and at least ten points under the ordinary band's floor
 *           (0.70), so a milestone never reads as an ordinary level; four is
 *           the floor because the campaign has to get through it, and a
 *           player retries it two or three times.
 *   bare    a hand that bought nothing clears at most two in ten: D45's
 *           "under 15 percent", at the resolution ten roads give.
 *   kit     so the kit buys at least twenty points of clears. Asserted on its
 *           own so a failure says what the upgrades bought (D45, D49, D50).
 *   road    the spike is felt before the arena (3.7's set piece): pooled over
 *           the seven, the armed human loses at least 45 percent of what it
 *           loses on the road, the ordinary band's floor, so a milestone is not
 *           an ordinary road with a bigger boss.
 *   greedy  armed, clears every road: the reference ceiling still gets
 *           through with what the road paid for (D45; document 31, 7).
 *   sight   the road stays fair: every contact seen 4.5 s ahead, every
 *           charger 2 s from its trigger, 180 live enemies at most.
 *
 * Retired: the dealt roads' ceilings of 0.55 bare on Meadow and 0.45 on
 * Frostfell, and a fifteen-point separation asserted from level 15 only
 * (level 10 never separated on a dealt road, D55). Nothing is asserted about a
 * milestone's boss length: its clears are the kit's lucky roads and say little
 * about the fight.
 *
 * Runtime: 175 runs and one campaign, under two minutes on a quiet box.
 */

import { describe, it } from 'vitest';

import { CHARGER_SECONDS, MILESTONE_ROAD_FLOOR, PEAK_LIVE, SIGHT_SECONDS } from './balanceBands';
import {
  Findings,
  GREEDY_ROADS,
  HUMAN_ROADS,
  MILESTONES,
  bandText,
  clearRate,
  expectTrue,
  f2,
  inBand,
  lossSplit,
  peakLive,
  play,
  playAll,
  roadName,
  warningFloor,
  worst,
} from './balanceRuns';
import type { Hand } from './balanceRuns';

const TIMEOUT_MS = 900_000;

const MILESTONE_ARMED: readonly [number, number] = [0.4, 0.6];
const MILESTONE_BARE = 0.2;
const MILESTONE_KIT_BUYS = 0.2;

const clears = (level: number, hand: Hand): number =>
  clearRate(HUMAN_ROADS.map((road) => play(level, road, 'human', hand)));
const armed = (level: number): number => clears(level, 'kit');
const bare = (level: number): number => clears(level, 'bare');

describe('balance: milestones', () => {
  it('makes every milestone genuinely hard for the hand that arrives there', () => {
    const findings = new Findings();
    for (const level of MILESTONES) {
      findings.check(
        `L${String(level)} armed human clears ${f2(armed(level))}, band ${bandText(MILESTONE_ARMED)}`,
        inBand(armed(level), MILESTONE_ARMED),
      );
    }
    findings.assert();
  }, TIMEOUT_MS);

  it('shuts every milestone to a hand that bought nothing', () => {
    const findings = new Findings();
    for (const level of MILESTONES) {
      findings.check(
        `L${String(level)} bare human clears ${f2(bare(level))}, ceiling ${String(MILESTONE_BARE)}`,
        bare(level) <= MILESTONE_BARE,
      );
    }
    findings.assert();
  }, TIMEOUT_MS);

  it('buys at least twenty points of clears with the kit the road paid for', () => {
    const findings = new Findings();
    for (const level of MILESTONES) {
      const gain = armed(level) - bare(level);
      findings.check(
        `L${String(level)} kit buys ${f2(gain)} (armed ${f2(armed(level))}, bare ${f2(bare(level))}), ` +
          `floor ${String(MILESTONE_KIT_BUYS)}`,
        gain >= MILESTONE_KIT_BUYS - 1e-9,
      );
    }
    findings.assert();
  }, TIMEOUT_MS);

  it('puts the spike on the road as well as in the arena', () => {
    const split = lossSplit(playAll(MILESTONES, 'human', HUMAN_ROADS, 'kit'));
    const road = (level: number): number => lossSplit(playAll([level], 'human', HUMAN_ROADS, 'kit')).road;
    expectTrue(
      `milestone road share ${f2(split.road)}, floor ${String(MILESTONE_ROAD_FLOOR)} ` +
        `(lowest: ${worst(MILESTONES, road, 4, false)})`,
      split.road >= MILESTONE_ROAD_FLOOR,
    );
  }, TIMEOUT_MS);

  it('lets greedy clear every milestone road with the kit', () => {
    const findings = new Findings();
    for (const level of MILESTONES) {
      for (const road of GREEDY_ROADS) {
        const run = play(level, road, 'greedy', 'kit');
        findings.check(`L${String(level)} ${roadName(road)} greedy armed lost`, run.result.status === 'won');
      }
    }
    findings.assert();
  }, TIMEOUT_MS);

  it('keeps every milestone road readable', () => {
    const findings = new Findings();
    const runs = [
      ...playAll(MILESTONES, 'human', HUMAN_ROADS, 'kit'),
      ...playAll(MILESTONES, 'human', HUMAN_ROADS, 'bare'),
      ...playAll(MILESTONES, 'greedy', GREEDY_ROADS, 'kit'),
    ];
    const sight = warningFloor(runs, 'sight');
    findings.check(
      `milestone shortest sight to contact ${sight.seconds.toFixed(2)} s, floor ${String(SIGHT_SECONDS)} ` +
        `(${sight.where})`,
      sight.seconds >= SIGHT_SECONDS,
    );
    const charger = warningFloor(runs, 'charger');
    findings.check(
      `milestone shortest charger trigger to contact ${charger.seconds.toFixed(2)} s, ` +
        `floor ${String(CHARGER_SECONDS)} (${charger.where})`,
      charger.seconds >= CHARGER_SECONDS,
    );
    const peak = peakLive(runs);
    findings.check(
      `milestone peak live enemies ${String(peak.live)}, ceiling ${String(PEAK_LIVE)} (${peak.where})`,
      peak.live <= PEAK_LIVE,
    );
    findings.assert();
  }, TIMEOUT_MS);
});
