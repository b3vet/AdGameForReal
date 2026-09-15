/**
 * The endless road (D52): the generator, the run semantics and the pay.
 *
 * Three promises, and they are the reason the mode exists. The road is a
 * function of its seed, so a score is worth comparing and a run is worth
 * replaying. It ends — on the wipe or on the last row — so a run is a thing
 * that finishes rather than a tab left open. And it pays *under* the campaign,
 * so walking it can never be the fastest way to fill the purse.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { runCampaign } from '../campaign';
import { generateEndless } from '../endless';
import { biomeAt } from '../level';
import { emptyPlayer } from '../player';
import { endlessCap, repeatClearValue, runRewards } from '../rewards';
import { Run } from '../Run';
import { playerHolding } from './fixtures';
import { balance, endless } from '@/data';
import type { UnitLossReason } from '../types';
import type { PlayerState } from '@/data/types';

/** `expect` on a labelled string, so a failure names the number that broke. */
function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

describe('the endless generator', () => {
  it('builds one road with no level number and no boss', () => {
    const road = generateEndless(7);
    expect(road.endless).toBe(true);
    expect(road.index).toBe(0);
    expect(road.seed).toBe(7);
    expect(road.rows).toHaveLength(Math.floor(endless.rows));
    expect(road.boss.hp).toBe(0);
    // ...and a run built on it stands nothing in the arena to fight.
    expect(new Run(road, balance).state.boss).toBeNull();
  });

  it('is the same road every time from the same seed, and a different one from another', () => {
    expect(JSON.stringify(generateEndless(11))).toBe(JSON.stringify(generateEndless(11)));
    expect(JSON.stringify(generateEndless(11))).not.toBe(JSON.stringify(generateEndless(12)));
    // The player's two level-shaping upgrades apply exactly as they do to a
    // campaign level, and an empty player is the identity (D35).
    expect(JSON.stringify(generateEndless(11, emptyPlayer()))).toBe(
      JSON.stringify(generateEndless(11)),
    );
  });

  it('alternates its biome every `rowsPerBiome` rows', () => {
    const road = generateEndless(3);
    const span = Math.max(1, endless.rowsPerBiome) * balance.level.rowSpacing;
    expect(road.biomeSpan).toBe(span);
    expect(road.biome).toBe(endless.biomes[0]);

    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const middle = span * i + span / 2;
      const biome = biomeAt(road, middle);
      seen.add(biome);
      expect(`${String(i)} ${biome}`).toBe(
        `${String(i)} ${String(endless.biomes[i % endless.biomes.length])}`,
      );
      // ...and it holds for the whole span, not only at its middle.
      expect(biomeAt(road, span * i + 0.5)).toBe(biome);
    }
    expect(seen.size).toBe(endless.biomes.length);
    // A campaign level names one biome and every metre of it answers that.
    const level = { ...road };
    delete level.biomeSpan;
    delete level.biomes;
    expect(biomeAt(level, 900)).toBe(road.biome);
  });

  it('gets harder as it goes: bigger gates, bigger blocks, more pressure', () => {
    const road = generateEndless(5);
    const early = road.rows.slice(0, 20);
    const late = road.rows.slice(-20);

    const addValues = (rows: typeof road.rows): number[] =>
      rows.flatMap((row) => row.gates.filter((g) => g?.kind === 'add').map((g) => g?.value ?? 0));
    const meanAdd = (rows: typeof road.rows): number => {
      const values = addValues(rows);
      return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    };
    expectTrue(
      `add gates ${meanAdd(early).toFixed(1)} early, ${meanAdd(late).toFixed(1)} late`,
      meanAdd(late) > meanAdd(early) * 3,
    );

    const bodies = (rows: typeof road.rows): number =>
      rows.reduce((total, row) => total + (row.streams ?? []).reduce((n, s) => n + s.count, 0), 0);
    expectTrue(
      `stream bodies ${String(bodies(early))} early, ${String(bodies(late))} late`,
      bodies(late) > bodies(early),
    );
  });

  it('deals every kind the bestiary holds, and fences the road', () => {
    const road = generateEndless(9);
    const kinds = new Set(road.rows.flatMap((row) => row.enemies.map((e) => e.kind)));
    for (const kind of ['grunt', 'brute', 'charger', 'shieldBrute']) {
      expect(`${kind} dealt ${String(kinds.has(kind as never))}`).toBe(`${kind} dealt true`);
    }
    expect(road.rows.some((row) => (row.streams ?? []).length >= 2)).toBe(true);
    expect(road.rows.some((row) => row.gates.some((g) => g?.kind === 'weapon'))).toBe(true);
    expect((road.walls ?? []).length).toBeGreaterThan(0);
    // The road ends one row's spacing past its last row, like a level's arena.
    expect(road.arenaZ).toBeCloseTo(balance.level.rowSpacing * (road.rows.length + 1), 6);
  });
});

describe('an endless run', () => {
  it('counts its metres and ends on the wipe', () => {
    const road = generateEndless(4);
    const run = new Run(road, balance);
    expect(run.state.endless?.metres).toBe(0);

    let metres = 0;
    // No steering at all: the column walks into whatever the road puts in it
    // and dies somewhere. Long enough to be sure it does.
    for (let step = 0; step < 60 * 400 && run.state.status === 'running'; step++) {
      run.tick(1 / 60);
      const now = run.state.endless?.metres ?? 0;
      expectTrue(`metres ${String(now)} never go backward`, now >= metres);
      metres = now;
    }
    expect(run.state.status).toBe('lost');
    expectTrue(`walked ${metres.toFixed(0)} m`, metres > 0 && metres < road.arenaZ);
    expect(run.state.endless?.metres).toBeCloseTo(run.state.squad.z, 9);
    // Past vitest's five-second default since the Milestone 8 retune: the road
    // carries a few hundred live bodies by the time it wipes an unsteered
    // column, and this walks it a step at a time with an assertion on each.
  }, 60_000);

  it('is won by reaching the end of the road', () => {
    // A short road, so the test walks the whole of it: the rule under test is
    // "the last row is the win condition", not how long the road is.
    const road = generateEndless(2);
    road.rows.length = 3;
    road.arenaZ = balance.level.rowSpacing * 4;
    road.walls = [];
    const run = new Run(road, balance);
    for (let step = 0; step < 60 * 120 && run.state.status === 'running'; step++) {
      run.tick(1 / 60);
    }
    expect(run.state.status).toBe('won');
    expect(run.state.endless?.metres).toBeCloseTo(road.arenaZ, 6);
    expect(run.state.squad.count).toBeGreaterThan(0);
  });
});

describe('what an endless run pays (D52)', () => {
  /** A finished endless run that walked `metres`. */
  function walked(metres: number, status: 'won' | 'lost' = 'lost') {
    return { status, survivors: 0, endless: { metres } };
  }

  it('pays by the metre, under a share of a repeat clear of the best level', () => {
    const best = 10;
    const cap = endlessCap(best);
    expect(cap).toBeCloseTo(endless.capShare * repeatClearValue(best), 9);
    expect(cap).toBeLessThan(repeatClearValue(best));

    const short = runRewards(walked(200), 0, false, { bestLevel: best }).coins;
    expect(short).toBe(Math.round(200 * endless.coinsPerMetre));
    expect(short).toBeLessThan(cap);

    // The whole road, twice over: the cap is what holds, whichever way it ended.
    const far = runRewards(walked(99_999), 0, false, { bestLevel: best }).coins;
    expect(far).toBe(Math.round(cap));
    expect(runRewards(walked(99_999, 'won'), 0, false, { bestLevel: best }).coins).toBe(far);
  });

  it('never out-earns the campaign, at any level and any distance', () => {
    // The whole point of the cap (D52): level progress stays the earner. A
    // repeat clear is the honest comparison — the first clear happens once and
    // the endless road can be walked all evening.
    for (const best of [1, 5, 10, 20, 40]) {
      const paid = runRewards(walked(1e6), 0, false, { bestLevel: best }).coins;
      const clear = repeatClearValue(best);
      expectTrue(
        `L${String(best)} endless pays ${String(paid)} against a clear of ${clear.toFixed(0)}`,
        paid < clear,
      );
    }
    // Nothing named: an untried player is priced at level 1, not at level 40.
    expect(runRewards(walked(1e6), 0, false).coins).toBe(Math.round(endlessCap(1)));
  });

  it('is never paid as a campaign clear, and a campaign run never by distance', () => {
    // The presence of `endless` is the whole switch, so the two can never be
    // confused: a distance run pays by distance even with a level index on it,
    // and a campaign clear is unmoved by a level that has no number.
    const clear = runRewards({ status: 'won', survivors: 100 }, 10, false).coins;
    expect(clear).toBeGreaterThan(0);
    expect(runRewards(walked(200), 10, true, { bestLevel: 10 }).coins).toBe(
      Math.round(200 * endless.coinsPerMetre),
    );
    // A run still going pays nothing, endless or not.
    expect(runRewards({ status: 'running', survivors: 9, endless: { metres: 900 } }, 0, false).coins).toBe(0);
  });
});

/**
 * The band the first ten minutes are held to (D52), measured on the human bot
 * carrying the kit the campaign holds at level 20 — the hand the mode is first
 * played with, since Endless sits beside the campaign from the start and a
 * player who has walked twenty levels is the one with a best worth beating.
 *
 * What is asserted, and why. The road has to *end* — a mode called Endless that
 * everyone walks to the last row is a level with no boss, which is what wave
 * one shipped: ten of ten seeds finished it with five hundred units standing.
 * It has to end by being ground down rather than by one row: the worst row
 * before the wipe takes under a third of the column's peak. And it has to land
 * somewhere worth comparing, which is what makes the metres a score.
 *
 * Milestone 8, ten seeds on the retuned kit (the level-20 hand now carries the
 * burn): median 1951 m of 2898, min 1392, max 2241, none finished, worst row
 * under a third of peak, and the losses are rivers first (551 units a run),
 * then blocks walked into (208), then curses (110).
 */
const ENDLESS_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ENDLESS_MEDIAN_BAND: readonly [number, number] = [1200, 2400];
const ENDLESS_MIN_METRES = 800;
const ENDLESS_WORST_ROW_SHARE = 1 / 3;
const TEN_MINUTES = 600;

interface Walk {
  metres: number;
  seconds: number;
  won: boolean;
  /** The worst row before the wipe, as a share of the column at its peak. */
  worstRowShare: number;
  byReason: Record<UnitLossReason, number>;
}

/** The kit the campaign says the human holds at level 20 (D46). */
function kitAtTwenty(): PlayerState {
  const held = runCampaign({ bot: 'human', seed: 1 }).levels.find((e) => e.level === 20)?.held;
  if (held === undefined) throw new Error('no level-20 kit');
  return playerHolding({
    upgrades: held.upgrades,
    staffs: held.staffs,
    evolved: held.evolved,
    tiers: held.tiers,
    wispTier: held.wispTier,
    unlockedLevel: 20,
  });
}

function walk(seed: number, player: PlayerState): Walk {
  const road = generateEndless(seed, player);
  const run = new Run(road, balance, player);
  const bot = createBot('human', seed * 131);
  const spacing = balance.level.rowSpacing;
  const byReason: Record<UnitLossReason, number> = { contact: 0, gate: 0, stomp: 0, leak: 0 };
  const lost: number[] = [];
  let steps = 0;
  const maxSteps = Math.round((TEN_MINUTES + 60) * 60);
  while (run.state.status === 'running' && steps < maxSteps) {
    const bucket = Math.floor(run.state.squad.z / spacing);
    run.setTargetX(bot(run.state));
    for (const event of run.tick(1 / 60)) {
      if (event.type !== 'unitsLost') continue;
      byReason[event.reason] = (byReason[event.reason] ?? 0) + event.amount;
      lost[bucket] = (lost[bucket] ?? 0) + event.amount;
    }
    steps++;
  }
  // The row the run ended on takes whatever is left of the column, so it is the
  // death rather than a cliff: the worst row is measured over the ones before.
  let worst = 0;
  const peak = Math.max(1, run.state.peakCount);
  for (let i = 0; i < lost.length - 1; i++) worst = Math.max(worst, (lost[i] ?? 0) / peak);
  return {
    metres: run.state.endless?.metres ?? 0,
    seconds: steps / 60,
    won: run.state.status === 'won',
    worstRowShare: worst,
    byReason,
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

describe('the first ten minutes (D52)', () => {
  it('grinds the level-20 kit down inside ten minutes, and never on one row', () => {
    const kit = kitAtTwenty();
    const metres: number[] = [];
    const worst: number[] = [];
    for (const seed of ENDLESS_SEEDS) {
      const out = walk(seed, kit);
      metres.push(out.metres);
      worst.push(out.worstRowShare);
      expectTrue(`s${String(seed)} ended in ${out.seconds.toFixed(0)} s`, out.seconds <= TEN_MINUTES);
      expectTrue(`s${String(seed)} wiped, not finished`, !out.won);
      expectTrue(`s${String(seed)} walked ${out.metres.toFixed(0)} m`, out.metres >= ENDLESS_MIN_METRES);
    }
    const mid = median(metres);
    expectTrue(
      `median ${mid.toFixed(0)} m in [${String(ENDLESS_MEDIAN_BAND[0])}, ${String(ENDLESS_MEDIAN_BAND[1])}]` +
        ` (min ${Math.min(...metres).toFixed(0)}, max ${Math.max(...metres).toFixed(0)})`,
      mid >= ENDLESS_MEDIAN_BAND[0] && mid <= ENDLESS_MEDIAN_BAND[1],
    );
    const worstRow = median(worst);
    expectTrue(
      `worst row ${(worstRow * 100).toFixed(0)} percent of peak`,
      worstRow <= ENDLESS_WORST_ROW_SHARE,
    );
    // ...and what that walk pays is under another clear of the level it is
    // measured against, which is the whole of D52's promise about the pay.
    const paid = runRewards(
      { status: 'lost', survivors: 0, endless: { metres: mid } },
      0,
      false,
      { bestLevel: 20 },
    ).coins;
    expectTrue(
      `a median walk pays ${String(paid)} against a repeat clear of ${repeatClearValue(20).toFixed(0)}`,
      paid < repeatClearValue(20),
    );
  }, 600_000);
});
