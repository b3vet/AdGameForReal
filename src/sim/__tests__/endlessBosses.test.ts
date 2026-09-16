/**
 * The endless road's bosses and the curve they put on a run (document 28).
 *
 * The owner's note was that Endless was far too easy: the bots walked a squad
 * of five hundred through a kilometre of road nothing on it could hurt. So the
 * road now stops at an arena every biome span, the two bosses take turns there
 * with rising hit points and bite, the stretches between them are dealt from a
 * mix that turns towards the tougher kinds, and every dial climbs faster.
 *
 * What is asserted here: where the arenas stand and what stands in them; that a
 * boss mid-road is a stop and not the end, that nothing past the line joins the
 * fight, and that the road carries on after it; that a run is a function of its
 * seed with the bosses in it; and the curve itself, on the bots.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import type { BotKind } from '../bots';
import { runCampaign } from '../campaign';
import { generateEndless } from '../endless';
import { arenaRows, dialAt } from '../endlessLayout';
import { biomeAt } from '../level';
import type { LevelDef } from '../level';
import { Run } from '../Run';
import type { SimEvent } from '../types';
import { wallHolds } from '../walls';
import { level, playerHolding, row } from './fixtures';
import { balance, endless } from '@/data';
import type { PlayerState } from '@/data/types';

const DT = 1 / 60;

/** `expect` on a labelled string, so a failure names the number that broke. */
function expectTrue(where: string, value: boolean): void {
  expect(`${where}: ${String(value)}`).toBe(`${where}: true`);
}

describe('the arenas', () => {
  const road = generateEndless(3);
  const arenas = road.arenas ?? [];
  const spacing = balance.level.rowSpacing;
  const bosses = endless.bosses;

  it('stands one every `everyRows` from `firstRow`, the two bosses in turn', () => {
    const rows = arenaRows(road.rows.length);
    expect(arenas.length).toBe(rows.length);
    expect(arenas.length).toBeGreaterThanOrEqual(6);
    arenas.forEach((arena, n) => {
      expect(arena.z).toBe(spacing * (bosses.firstRow + n * bosses.everyRows + 1));
      expect(arena.kind).toBe(n % 2 === 0 ? 'demon' : 'rime');
    });
    // The same schedule on every seed: the arenas are where the score is read.
    expect(generateEndless(99).arenas).toEqual(arenas);
  });

  it('meets the first boss a minute or so into the run', () => {
    const seconds = (arenas[0]?.z ?? 0) / balance.squad.runSpeed;
    expectTrue(`first arena after ${seconds.toFixed(0)} s`, seconds >= 60 && seconds <= 90);
  });

  it('puts each boss at the end of its own land', () => {
    // A span is a biome and ends with its boss: the demon in the meadow, the
    // Rime Fiend in the frost (D49).
    for (const arena of arenas) {
      const biome = biomeAt(road, arena.z);
      expect(`${arena.kind} in ${biome}`).toBe(
        `${arena.kind} in ${arena.kind === 'rime' ? 'frost' : 'meadow'}`,
      );
    }
  });

  it('makes every boss bigger and harder than the last', () => {
    arenas.forEach((arena, n) => {
      expect(arena.hp).toBe(Math.round(dialAt(bosses.hp, n)));
      expect(arena.units).toBe(Math.ceil(arena.hp / balance.enemies.boss.hpPerUnit));
      expect(arena.bite).toBeCloseTo(dialAt(bosses.bite, n), 9);
      expect(arena.bite).toBeLessThanOrEqual(1);
      const before = arenas[n - 1];
      if (before === undefined) return;
      expect(arena.hp).toBeGreaterThan(before.hp);
      expect(arena.bite).toBeGreaterThanOrEqual(before.bite);
    });
  });

  it('keeps the arena and its breathers empty, and every fence off the line', () => {
    const breathers = bosses.breatherRows;
    for (const at of arenaRows(road.rows.length)) {
      for (let k = 0; k <= breathers; k++) {
        const empty = road.rows[at + k];
        expect(empty?.gates).toEqual([null, null, null]);
        expect(empty?.enemies).toEqual([]);
        expect(empty?.streams ?? []).toEqual([]);
      }
      // The row after them is a gate row: the road comes back with a choice.
      expect(road.rows[at + breathers + 1]?.gates.some((g) => g !== null)).toBe(true);
    }
    for (const arena of arenas) {
      for (const wall of road.walls ?? []) {
        expectTrue(
          `fence ${String(wall.zStart)}-${String(wall.zEnd)} clear of ${String(arena.z)}`,
          !wallHolds(wall, arena.z, balance.walls.approach, balance.walls.gateGap),
        );
      }
    }
  });

  it('turns the stretches towards the tougher kinds as the road goes on', () => {
    const tough = new Set(['brute', 'charger', 'shieldBrute']);
    const shareOf = (from: number, to: number): number => {
      let threats = 0;
      let hard = 0;
      for (const def of road.rows.slice(from, to)) {
        if (def.gates.some((g) => g !== null)) continue;
        const kinds = def.enemies.map((e) => e.kind);
        if (kinds.length === 0 && (def.streams ?? []).length === 0) continue;
        threats++;
        if (kinds.some((k) => tough.has(k)) || (def.streams ?? []).length >= 2) hard++;
      }
      return hard / Math.max(1, threats);
    };
    const early = shareOf(0, 60);
    const late = shareOf(100, 160);
    expectTrue(`tough threat rows ${early.toFixed(2)} early, ${late.toFixed(2)} late`, late > early);
  });
});

/** A short hand-made endless road: two arenas, the second a Rime Fiend. */
function twoStops(): LevelDef {
  const stop = { hp: 900, units: 90, bite: 0.3, hold: 2 };
  return level({
    endless: true,
    startCount: 40,
    rows: [
      // Past the first line and inside the waking range of a column stopped at
      // it: a block that would walk into the fight, and a river that would
      // start pouring into it.
      row(60, [null, null, null], [{ kind: 'grunt', lane: 1, units: 2 }]),
      {
        z: 70,
        gates: [null, null, null],
        enemies: [],
        streams: [
          { lane: 1, kind: 'grunt', count: 6, durationSeconds: 2, hpPerEnemy: 1, speed: 3, jitter: 0 },
        ],
      },
    ],
    walls: [],
    arenaZ: 200,
    arenas: [
      { z: 40, kind: 'demon', ...stop },
      { z: 120, kind: 'rime', ...stop },
    ],
  });
}

describe('a boss mid-road', () => {
  it('stops the column, falls, and lets it walk on to the next one', () => {
    const run = new Run(twoStops(), balance);
    const order: string[] = [];
    let heldAtFirst = 0;
    let blockWokeEarly = false;
    let riverEarly = false;
    let firstDown = false;
    let downAt = -1;
    let leftAt = -1;
    for (let step = 0; step < 60 * 120 && run.state.status === 'running'; step++) {
      run.setTargetX(0);
      for (const event of run.tick(DT)) {
        if (event.type === 'bossActivated' || event.type === 'bossKilled' || event.type === 'runEnded') {
          order.push(`${event.type}@${run.state.squad.z.toFixed(0)}`);
        }
        if (event.type === 'bossKilled' && !firstDown) downAt = run.state.time;
        if (event.type === 'bossKilled') firstDown = true;
        if (event.type === 'streamStarted' && downAt < 0) riverEarly = true;
      }
      const block = run.state.enemies[0];
      if (downAt < 0 && block?.active === true) blockWokeEarly = true;
      if (!firstDown && Math.abs(run.state.squad.z - 40) < 1e-9) heldAtFirst++;
      if (firstDown && leftAt < 0 && run.state.squad.z > 40) leftAt = run.state.time;
    }

    expect(run.state.status).toBe('won');
    expect(order).toEqual([
      'bossActivated@40',
      'bossKilled@40',
      'bossActivated@120',
      'bossKilled@120',
      'runEnded@200',
    ]);
    // It was a fight, not a brush past: the column stood at the line.
    expectTrue(`held ${String(heldAtFirst)} steps at the first line`, heldAtFirst > 60);
    // ...and it stood over the body for the stop's hold before walking on.
    expect(leftAt - downAt).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(leftAt - downAt).toBeLessThan(2 + 2 * DT);
    // Nothing past the line joined it.
    expect(blockWokeEarly).toBe(false);
    expect(riverEarly).toBe(false);
    // The last body stays on the state, dead; the metres are the whole road.
    expect(run.state.boss?.variant).toBe('rime');
    expect(run.state.boss?.alive).toBe(false);
    expect(run.state.endless?.metres).toBeCloseTo(200, 6);
  }, 60_000);

  it('still ends the run when a boss wipes the column', () => {
    const def = twoStops();
    const first = def.arenas?.[0];
    if (first === undefined) throw new Error('no arena');
    first.hp = 1e7;
    first.bite = 1;
    const run = new Run(def, balance);
    for (let step = 0; step < 60 * 400 && run.state.status === 'running'; step++) run.tick(DT);
    expect(run.state.status).toBe('lost');
    expect(run.state.endless?.metres).toBeCloseTo(40, 6);
  }, 60_000);
});

describe('an endless run with bosses in it', () => {
  it('is the same run from the same seed', () => {
    // Long enough to reach the first arena and fight in it.
    const toArena = ((endless.bosses.firstRow + 1) * balance.level.rowSpacing) / balance.squad.runSpeed;
    const steps = Math.round((toArena + 20) / DT);
    const play = (): { state: string; events: string[] } => {
      const run = new Run(generateEndless(21), balance);
      const bot = createBot('greedy', 21);
      const events: string[] = [];
      for (let step = 0; step < steps && run.state.status === 'running'; step++) {
        run.setTargetX(bot(run.state));
        for (const event of run.tick(DT)) {
          if (event.type.startsWith('boss')) events.push(`${String(step)}:${event.type}`);
        }
      }
      return { state: JSON.stringify(run.state), events };
    };
    const a = play();
    const b = play();
    expect(a.events.some((e) => e.endsWith('bossActivated'))).toBe(true);
    expect(b.events).toEqual(a.events);
    expect(b.state).toBe(a.state);
  }, 120_000);
});

/**
 * The curve (document 28), on the bots.
 *
 * The hand is the one D52's band was measured on: the human bot carrying the
 * kit the campaign holds at level 20. The owner's target for it is a death
 * somewhere between the second boss and the fourth, which is the stretch of
 * road from the second arena's line to the fourth's; the ceiling is greedy
 * with the level-40 kit, which must not walk forever — it never beats the
 * fifth boss.
 *
 * Measured when the bosses went in (human, level-20 kit, seeds 1 to 10): a
 * median of 1169 m, nine runs ending between the second and fourth lines and
 * one on the road after the first boss; bosses beaten 1, 2, 2, 3 × 7.
 * Greedy with the level-40 kit beat three or four and died at the fourth or
 * fifth. Before them the same human walked a median of 1964 m and nothing on
 * the road could stop a column of five hundred.
 */
const HUMAN_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const GREEDY_SEEDS = [1, 2, 3, 4, 5];
/** Of ten human runs, how many must end between the second and fourth lines. */
const HUMAN_IN_BAND = 8;
/** Greedy never beats more than this many bosses. */
const GREEDY_MAX_KILLS = 4;
const MAX_SECONDS = 900;

interface Walk {
  metres: number;
  kills: number;
  /** Sim seconds to the first `bossActivated`, or -1. */
  firstBossAt: number;
}

function kitAt(levelIndex: number): PlayerState {
  const held = runCampaign({ bot: 'human', seed: 1 }).levels.find((e) => e.level === levelIndex)?.held;
  if (held === undefined) throw new Error(`no level-${String(levelIndex)} kit`);
  return playerHolding({
    upgrades: held.upgrades,
    staffs: held.staffs,
    evolved: held.evolved,
    tiers: held.tiers,
    wispTier: held.wispTier,
    unlockedLevel: levelIndex,
  });
}

function walk(kind: BotKind, seed: number, player: PlayerState): Walk {
  const run = new Run(generateEndless(seed, player), balance, player);
  const bot = createBot(kind, seed * 131);
  const out: Walk = { metres: 0, kills: 0, firstBossAt: -1 };
  const count = (event: SimEvent): void => {
    if (event.type === 'bossKilled') out.kills++;
    if (event.type === 'bossActivated' && out.firstBossAt < 0) out.firstBossAt = run.state.time;
  };
  for (let step = 0; step < MAX_SECONDS / DT && run.state.status === 'running'; step++) {
    run.setTargetX(bot(run.state));
    for (const event of run.tick(DT)) count(event);
  }
  out.metres = run.state.endless?.metres ?? 0;
  expect(run.state.status).toBe('lost');
  return out;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe('the curve the bosses put on a run', () => {
  const arenas = generateEndless().arenas ?? [];
  const second = arenas[1]?.z ?? 0;
  const fourth = arenas[3]?.z ?? 0;

  it('ends a good thumb between the second boss and the fourth', () => {
    const kit = kitAt(20);
    const walks = HUMAN_SEEDS.map((seed) => walk('human', seed, kit));
    const metres = walks.map((w) => w.metres);
    const inBand = metres.filter((m) => m >= second - 1e-6 && m <= fourth + 1e-6).length;
    const where = `metres ${metres.map((m) => m.toFixed(0)).join(' ')}; kills ${walks.map((w) => w.kills).join(' ')}`;
    // Every run meets the first boss, and meets it a minute or so in.
    for (const w of walks) {
      expectTrue(`${where}: first boss at ${w.firstBossAt.toFixed(0)} s`, w.firstBossAt >= 60 && w.firstBossAt <= 90);
    }
    expectTrue(`${where}: ${String(inBand)} in [${String(second)}, ${String(fourth)}]`, inBand >= HUMAN_IN_BAND);
    const mid = median(metres);
    expectTrue(`${where}: median ${mid.toFixed(0)}`, mid >= second && mid <= fourth);
  }, 600_000);

  it('stops the reference ceiling before the sixth boss', () => {
    const kit = kitAt(40);
    const kills = GREEDY_SEEDS.map((seed) => walk('greedy', seed, kit).kills);
    for (const k of kills) {
      expectTrue(`greedy kills ${kills.join(' ')}`, k <= GREEDY_MAX_KILLS);
    }
    // ...and it is still the ceiling: it gets further than the thumb does.
    expectTrue(`greedy kills ${kills.join(' ')}`, median(kills) >= 3);
  }, 600_000);
});
