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

import { generateEndless } from '../endless';
import { biomeAt } from '../level';
import { emptyPlayer } from '../player';
import { endlessCap, repeatClearValue, runRewards } from '../rewards';
import { Run } from '../Run';
import { balance, endless } from '@/data';

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
  });

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
