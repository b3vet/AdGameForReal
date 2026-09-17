/**
 * Phase 1, wave two: the beats' price can no longer be stepped around.
 *
 * Wave one's guards walked from in front of their panels and met the column
 * rows before them, and its forks and first toll poured from portals that
 * had stopped before their bodies reached the row. A column that waited in
 * the next lane let the threat pass and slid into the prize for nothing, and
 * both bots did exactly that. These tests hold the fix on the sim itself:
 * a block that holds the gateway meets whoever takes its panel, and a river
 * timed by its tail is still arriving as the column crosses the row.
 */

import { describe, expect, it } from 'vitest';

import { buildBeatLevel } from '../beats/beatLevel';
import { composeLevel } from '../beats/compose';
import { resolveTier } from '../beats/library';
import { playBeat } from './beatLab';
import { beat, scripted, testLibrary } from './beatFixtures';
import { playDef } from './harness';
import { laneCenter } from '../lanes';
import type { LevelDef, RowDef, RowEnemyDef } from '../level';
import { openForTail, portalOpen } from '../pressure';
import { Run } from '../Run';
import type { Lane, StreamDef } from '../types';
import { balance, beats } from '@/data';
import type { BeatDef, BeatLibrary } from '@/data/types';

const DT = 1 / 60;
const GATE_Z = 60;

function road(row: RowDef, count: number): LevelDef {
  return {
    index: 40,
    seed: 11,
    runSpeed: balance.squad.runSpeed,
    startCount: count,
    rows: [row],
    arenaZ: GATE_Z + 20,
    biome: 'meadow',
    walls: [],
    endless: true,
    boss: { hp: 0, units: 0 },
    squadRates: true,
  };
}

function panels(): RowDef['gates'] {
  return [
    { kind: 'add', value: 10, cap: 16 },
    { kind: 'add', value: 30, cap: 48 },
    { kind: 'add', value: 10, cap: 16 },
  ];
}

interface Crossing {
  /** The lane whose panel the column took, or null. */
  lane: Lane | null;
  /** Units lost, by any cause. */
  lost: number;
  /** The same, from the step the column set off for its panel. */
  lostAfter: number;
}

/**
 * Plays a road with the column waiting in `wait` and sliding into `into` once
 * the squad is at `switchZ`.
 */
function slideIn(def: LevelDef, wait: Lane, into: Lane, switchZ: number): Crossing {
  const run = new Run(def, balance);
  let lane: Lane | null = null;
  let lost = 0;
  let lostAfter = 0;
  for (let step = 0; step < 60 * 60 && run.state.status === 'running'; step++) {
    const sliding = run.state.squad.z >= switchZ;
    run.setTargetX(laneCenter(sliding ? into : wait, balance.road.laneWidth));
    for (const event of run.tick(DT)) {
      if (event.type === 'unitsLost') {
        lost += event.amount;
        if (sliding) lostAfter += event.amount;
      }
      if (event.type === 'gatePassed') {
        lane = run.state.gates.find((gate) => gate.id === event.gateId)?.lane ?? null;
      }
    }
  }
  return { lane, lost, lostAfter };
}

/** Every slide-in point from well before the row to just after it. */
function slidePoints(): number[] {
  const out: number[] = [];
  for (let z = GATE_Z - 12; z <= GATE_Z + 0.5; z += 0.1) out.push(z);
  return out;
}

describe('a block that holds the gateway', () => {
  // In a side lane, as wave one's free guards were: a wide block in the middle
  // lane reaches into both others and was never free to wait out.
  const brute = (extra: Partial<RowEnemyDef>): RowEnemyDef => ({
    kind: 'brute',
    lane: -1,
    units: 8,
    hpPerUnit: 1e6,
    ...extra,
  });

  it('cannot be let past: a column that takes its panel always meets it', () => {
    const hold = -balance.enemies.beat.holdGap;
    const def = road(
      { z: GATE_Z, gates: panels(), enemies: [brute({ dz: hold, holdDz: hold, wake: 1.2, maxHalf: 0.88 })] },
      20,
    );
    let took = 0;
    for (const z of slidePoints()) {
      const crossing = slideIn(def, 1, -1, z);
      if (crossing.lane !== -1) continue;
      took++;
      expect(crossing.lostAfter, `slid in at ${z.toFixed(1)}`).toBeGreaterThan(0);
    }
    // The slide does reach the panel from far enough out; it just pays on the way.
    expect(took).toBeGreaterThan(0);
  });

  it('is exactly what wave one\'s walking guard was not', () => {
    // The same block walking from 8 m out, waking at 45 m: it meets the column
    // twenty metres short of the row, and there is time to step back in behind it.
    const def = road({ z: GATE_Z, gates: panels(), enemies: [brute({ dz: -8, wake: 45 })] }, 20);
    const free = slidePoints().some((z) => {
      const crossing = slideIn(def, 1, -1, z);
      return crossing.lane === -1 && crossing.lost === 0;
    });
    expect(free).toBe(true);
  });

  it('walks through its panel to the line and stands there', () => {
    const def = road(
      { z: GATE_Z, gates: panels(), enemies: [brute({ dz: 5, holdDz: -1, wake: 80, lane: 1 })] },
      20,
    );
    const run = new Run(def, balance);
    const block = run.state.enemies.find((enemy) => enemy.kind === 'brute');
    expect(block?.holdZ).toBe(GATE_Z - 1);
    // Held in the far lane, so the column walks on untouched and the block is watched.
    for (let step = 0; step < 60 * 6; step++) {
      run.setTargetX(laneCenter(-1, balance.road.laneWidth));
      run.tick(DT);
    }
    expect(block?.active).toBe(true);
    expect(block?.z).toBe(GATE_Z - 1);
    // One standing in front of its line is held where it stands, not pulled back.
    const ahead = new Run(
      road({ z: GATE_Z, gates: panels(), enemies: [brute({ dz: -6, holdDz: -1, wake: 80, lane: 1 })] }, 20),
      balance,
    );
    for (let step = 0; step < 60; step++) ahead.tick(DT);
    expect(ahead.state.enemies.find((enemy) => enemy.kind === 'brute')?.z).toBe(GATE_Z - 6);
  });
});

describe('a river timed by its tail', () => {
  const at = 8;
  const seconds = 4;
  const tail = 1;
  const river = (hp: number): StreamDef => ({
    lane: -1,
    kind: 'grunt',
    count: 30,
    durationSeconds: seconds,
    hpPerEnemy: hp,
    speed: balance.streams.speed,
    jitter: balance.streams.jitter,
    anchorZ: GATE_Z + at,
    openAt: openForTail(at, seconds, tail, balance.streams.speed),
  });

  it('opens early enough that its last body meets the column the tail past the row', () => {
    const run = new Run(road({ z: GATE_Z, gates: panels(), enemies: [], streams: [river(1e6)] }, 40), balance);
    let last = -Infinity;
    for (let step = 0; step < 60 * 60 && run.state.status === 'running'; step++) {
      run.setTargetX(laneCenter(-1, balance.road.laneWidth));
      for (const event of run.tick(DT)) if (event.type === 'enemyLeaked') last = run.state.squad.z;
    }
    expect(run.state.streams[0]?.leaked).toBe(30);
    // One sim step of the column, and a body's jitter across the contact band.
    expect(Math.abs(last - (GATE_Z + tail))).toBeLessThan(0.35);
  });

  it('charges a column that slides in at the last moment', () => {
    const def = road({ z: GATE_Z, gates: panels(), enemies: [], streams: [river(1e6)] }, 20);
    let took = 0;
    for (const z of slidePoints()) {
      const crossing = slideIn(def, 1, -1, z);
      if (crossing.lane !== -1) continue;
      took++;
      expect(crossing.lostAfter, `slid in at ${z.toFixed(1)}`).toBeGreaterThan(0);
    }
    expect(took).toBeGreaterThan(0);
  });

  it('reads its opening from the tail, or from `open` when it has one', () => {
    const speed = balance.streams.speed;
    const tailed = { at: 8, seconds: 5, tail: 1 };
    expect(portalOpen(tailed, speed)).toBeCloseTo(openForTail(8, 5, 1, speed), 9);
    expect(portalOpen({ at: 8, seconds: 5, open: 44 }, speed)).toBe(44);
    // A longer pour opens earlier by the road the squad walks in the extra time.
    expect(openForTail(8, 6, 1, speed) - openForTail(8, 5, 1, speed)).toBeCloseTo(balance.squad.runSpeed, 9);
  });
});

describe('the shipped library leaves no dodge', () => {
  it('lays every guard on its hold line, in its own lane only', () => {
    for (const id of ['guard', 'shieldGuard', 'flip']) {
      const level = buildBeatLevel(id, 1, 100, 3);
      const mark = level.beats?.[0];
      const blocks = level.rows.flatMap((row) => row.enemies.map((enemy) => ({ row, enemy })));
      expect(blocks.length, id).toBeGreaterThan(0);
      for (const { row, enemy } of blocks) {
        const z = row.z + (enemy.dz ?? 0);
        expect(z, id).toBe((mark?.z ?? 0) - balance.enemies.beat.holdGap);
        expect(row.z + (enemy.holdDz ?? Number.NaN), id).toBe(z);
        expect(enemy.maxHalf, id).toBeLessThanOrEqual(balance.road.laneWidth / 2);
      }
    }
  });

  it('pours every river past the row on every beat', () => {
    for (const def of beats.defs) {
      for (const key of Object.keys(def.tiers)) {
        const tier = resolveTier(def, Number(key));
        for (const river of tier.rivers) expect(river.tail, `${def.id}:${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('prices a fork: the bigger plus stands behind the heavier river, and the choice is worth something', () => {
    for (const squad of [30, 100, 300]) {
      const level = buildBeatLevel('fork', 2, squad, 5);
      const mark = level.beats?.[0];
      const row = level.rows.find((candidate) => candidate.z === mark?.z);
      const prize = mark?.prize ?? 0;
      const streams = row?.streams ?? [];
      const heaviest = [...streams].sort((a, b) => b.count * b.hpPerEnemy - a.count * a.hpPerEnemy)[0];
      expect(heaviest?.lane, `squad ${String(squad)}`).toBe(prize);
      const values = (row?.gates ?? []).map((gate) => (gate?.kind === 'add' ? gate.value : 0));
      expect(Math.max(...values), `squad ${String(squad)}`).toBe(values[prize + 1]);
      expect(playBeat('fork', 2, squad, 5, 'greedy').decision, `squad ${String(squad)}`).toBeGreaterThan(0);
    }
  });

  it('replays a beat byte for byte', () => {
    const one = playDef(buildBeatLevel('guard', 2, 100, 4), 'human', { botSeed: 9 });
    const two = playDef(buildBeatLevel('guard', 2, 100, 4), 'human', { botSeed: 9 });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });
});

describe('the composer', () => {
  const holding: BeatDef = {
    id: 'guard',
    rows: 2,
    tiers: {
      '1': {
        rating: 1,
        expectLoss: 0.05,
        gates: {
          prize: { kind: 'add', size: 'big' },
          safe: { kind: 'add', size: 'small' },
          other: { kind: 'sub', size: 'price' },
        },
        // Written further out than its line: the composer stands it on the line anyway.
        enemies: [{ kind: 'brute', lane: 'prize', at: -8, wake: 1.2, killSeconds: 2, hold: true }],
      },
    },
  };
  const library: BeatLibrary = {
    ...testLibrary,
    defs: testLibrary.defs.map((def) => (def.id === 'guard' ? holding : def)),
  };

  it('never stands a holding block in front of its line, and gives it the line', () => {
    const config = scripted(8, [beat('open'), beat('guard'), beat('prep')]);
    const level = composeLevel(8, config, config.seed, undefined, library);
    const mark = level.beats?.[1];
    const lead = level.rows[2];
    const block = lead?.enemies[0];
    expect((lead?.z ?? 0) + (block?.dz ?? 0)).toBe((mark?.z ?? 0) - balance.enemies.beat.holdGap);
    expect(block?.holdDz).toBe(block?.dz);
    expect(block?.lane).toBe(mark?.prize);
  });
});
