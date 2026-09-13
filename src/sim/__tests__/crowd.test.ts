/**
 * The crowd as agents (D43).
 *
 * What these hold onto is the contract the rest of the milestone rests on: the
 * arrays are deterministic step for step, the slots have no holes in them, a
 * fence stops every unit and a column driven into one spills along it rather
 * than through it, an arch's legs are solid, and a body standing in the front
 * rank bows it backward without changing how many people it kills.
 */

import { describe, expect, it } from 'vitest';

import { createBot } from '../bots';
import { formationOffsets } from '../formation';
import { generateLevel } from '../level';
import { Run } from '../Run';
import { CROWD_SHOVED } from '../types';
import type { CrowdState, StreamDef } from '../types';
import { wallX } from '../walls';
import { level, play, row, runOf, testBalance, wall } from './fixtures';
import { balance, levelConfig } from '@/data';

const DT = 1 / 60;

function crowdOf(run: Run): CrowdState {
  const crowd = run.state.crowd;
  if (crowd === undefined) throw new Error('the run has no crowd');
  return crowd;
}

/** Everything about one unit that has to replay identically. */
function snapshot(crowd: CrowdState): string {
  const parts: string[] = [];
  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0) continue;
    parts.push(
      `${String(i)}:${String(crowd.group[i])}:${String(crowd.slot[i])}:${String(crowd.flags[i])}:` +
        `${(crowd.x[i] ?? 0).toFixed(9)}:${(crowd.z[i] ?? 0).toFixed(9)}:` +
        `${(crowd.vx[i] ?? 0).toFixed(9)}:${(crowd.vz[i] ?? 0).toFixed(9)}`,
    );
  }
  return parts.join('|');
}

function forEachLive(crowd: CrowdState, visit: (index: number, x: number, z: number) => void): void {
  for (let i = 0; i < crowd.capacity; i++) {
    if ((crowd.alive[i] ?? 0) === 0) continue;
    visit(i, crowd.x[i] ?? 0, crowd.z[i] ?? 0);
  }
}

describe('the crowd', () => {
  it('replays a whole level step for step, agents included', () => {
    // The contract the balance suite and the goldens rest on (CLAUDE.md): same
    // seed, same inputs, same crowd — every array, every step, not just at the
    // end. Level 6 carries walls, streams, blocks and a boss, so the straggler
    // cut, the shove and the kill selection are all in the replay.
    const config = levelConfig(6);
    const a = new Run(generateLevel(6, config, 3), balance);
    const b = new Run(generateLevel(6, config, 3), balance);
    const botA = createBot('greedy', 3);
    const botB = createBot('greedy', 3);

    for (let step = 0; step < 60 * 40 && a.state.status === 'running'; step++) {
      a.setTargetX(botA(a.state));
      a.tick(DT);
      b.setTargetX(botB(b.state));
      b.tick(DT);
      const where = `step ${String(step)}`;
      expect(`${where} ${snapshot(crowdOf(b))}`).toBe(`${where} ${snapshot(crowdOf(a))}`);
    }
    expect(a.state.status).toBe(b.state.status);
  }, 60_000);

  it('hands out slots front first and never leaves a hole in them', () => {
    // A unit dies anywhere in the column and the highest slot moves down into
    // the gap, so the formation stays exactly `count` slots deep.
    const run = runOf(
      level({
        startCount: 100,
        rows: [],
        arenaZ: 8,
        boss: { hp: 4_000_000, units: 400_000 },
      }),
    );
    play(run, 12, 0);
    const crowd = crowdOf(run);
    const count = run.state.groups?.[0]?.count ?? 0;
    expect(count).toBeGreaterThan(10);
    expect(count).toBeLessThan(100);

    const seen = new Set<number>();
    forEachLive(crowd, (i) => {
      expect(crowd.group[i]).toBe(0);
      seen.add(crowd.slot[i] ?? -1);
    });
    expect(seen.size).toBe(count);
    expect(Math.max(...seen)).toBe(count - 1);
  });

  it('closes the gaps: every unit walks to the slot it inherited', () => {
    // A brute walks square into the column and takes a bite out of its front;
    // the units behind inherit the empty slots and walk into them.
    const run = runOf(
      level({
        startCount: 90,
        rows: [row(30, [null, null, null], [{ kind: 'brute', lane: 0, units: 40 }])],
        arenaZ: 400,
      }),
    );
    const before = run.state.squad.count;
    play(run, 6, 0);
    expect(run.state.squad.count).toBeLessThan(before);
    // ...and three seconds for the column to close up behind them.
    play(run, 3, 0);

    const crowd = crowdOf(run);
    const squad = run.state.squad;
    const offsets = formationOffsets(squad.count, squad.formationWidth);
    let worst = 0;
    forEachLive(crowd, (i, x, z) => {
      const offset = offsets[crowd.slot[i] ?? 0];
      if (offset === undefined) throw new Error('a unit with no slot');
      worst = Math.max(worst, Math.hypot(x - (squad.x + offset.x), z - (squad.z + offset.z)));
    });
    // Every one of them is standing in the slot it inherited, inside a third
    // of the spacing they keep: no holes, and no column left ragged by them.
    expect(worst).toBeLessThan(0.1);
  });

  it('jams against a fence and spills along it rather than through it', () => {
    const line = wallX(1, balance.road.laneWidth);
    const body = balance.crowd.bodyRadius;
    const run = runOf(level({ startCount: 200, rows: [], walls: [wall(1, 10, 90)] }));

    // Enter on the left, then lean the whole column against the fence.
    play(run, 2.4, -99);
    const crowd = crowdOf(run);
    const spread = (): number => {
      let lo = Infinity;
      let hi = -Infinity;
      forEachLive(crowd, (_i, _x, z) => {
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      });
      return hi - lo;
    };
    const settled = spread();

    let worstX = -Infinity;
    let widest = 0;
    for (let step = 0; step < 60 * 10; step++) {
      run.setTargetX(99);
      run.tick(DT);
      const z = run.state.squad.z;
      if (z < 10 || z > 88) continue;
      forEachLive(crowd, (_i, x) => {
        worstX = Math.max(worstX, x);
      });
      widest = Math.max(widest, spread());
    }

    // Not one unit through the line, at any step.
    expect(worstX).toBeLessThanOrEqual(line - body + 1e-9);
    expect(worstX).toBeCloseTo(line - body, 6);
    // And the column is longer than it was: with the slots on the far side of
    // the fence, the crowd piles up against it and separation spills it
    // forward and back along the line.
    expect(widest).toBeGreaterThan(settled * 1.1);
  });

  it('funnels through an arch instead of walking through its legs', () => {
    const legX = balance.road.laneWidth / 2;
    const legHalf = balance.crowd.arch.legHalf;
    const half = balance.crowd.arch.depth / 2;
    const rowZ = 30;
    const run = runOf(
      level({
        startCount: 300,
        rows: [row(rowZ, [null, { kind: 'add', value: 1 }, null])],
        arenaZ: 400,
      }),
    );
    const crowd = crowdOf(run);

    let inside = 0;
    let measured = 0;
    for (let step = 0; step < 60 * 10; step++) {
      // Steering straight at a leg, which is the only way to test one.
      run.setTargetX(legX);
      run.tick(DT);
      forEachLive(crowd, (_i, x, z) => {
        if (Math.abs(z - rowZ) > half) return;
        measured++;
        if (Math.abs(Math.abs(x) - legX) < legHalf) inside++;
      });
    }
    expect(measured).toBeGreaterThan(1000);
    expect(inside).toBe(0);
  });
});

describe('the enemy shove', () => {
  /** A river down the middle lane, walking into a squad that cannot shoot. */
  function river(): ReturnType<typeof level> {
    const stream: StreamDef = {
      lane: 0,
      kind: 'grunt',
      count: 25,
      durationSeconds: 6,
      hpPerEnemy: 1,
      speed: balance.streams.speed,
      jitter: balance.streams.jitter,
    };
    return level({
      startCount: 60,
      rows: [{ z: 10, gates: [null, null, null], enemies: [], streams: [stream] }],
      arenaZ: 4000,
    });
  }

  /** The same run with and without the shove; nobody fires in either. */
  function cost(shove: boolean): number {
    const tuning = testBalance();
    tuning.squad.fireRate = 0;
    if (!shove) {
      tuning.crowd.shove.back = 0;
      tuning.crowd.shove.side = 0;
    }
    const run = new Run(river(), tuning);
    let lost = 0;
    for (let step = 0; step < 60 * 20; step++) {
      run.setTargetX(0);
      for (const event of run.tick(DT)) if (event.type === 'unitsLost') lost += event.amount;
    }
    return lost;
  }

  /**
   * How far the shove moves the crowd off its slots as one body walks through
   * it. Contact is switched off entirely, so nobody dies and what is left is
   * the shove and nothing else.
   */
  function bow(shove: boolean): number {
    const tuning = testBalance();
    tuning.squad.fireRate = 0;
    tuning.enemies.contactDistance = 0;
    if (!shove) {
      tuning.crowd.shove.back = 0;
      tuning.crowd.shove.side = 0;
    }
    const run = new Run(
      level({
        startCount: 60,
        rows: [row(30, [null, null, null], [{ kind: 'grunt', lane: 0, units: 6 }])],
        arenaZ: 4000,
      }),
      tuning,
    );
    const crowd = crowdOf(run);
    let worst = 0;
    for (let step = 0; step < 60 * 10; step++) {
      run.setTargetX(0);
      run.tick(DT);
      const squad = run.state.squad;
      const offsets = formationOffsets(squad.count, squad.formationWidth, tuning);
      forEachLive(crowd, (i, x, z) => {
        const offset = offsets[crowd.slot[i] ?? 0];
        if (offset === undefined) return;
        worst = Math.max(worst, Math.hypot(x - (squad.x + offset.x), z - (squad.z + offset.z)));
      });
    }
    return worst;
  }

  it('bows the crowd around a body walking into it', () => {
    // Half a body's width out of place, where a column left alone stands in
    // its slots to the millimetre. That is the crowd giving ground.
    expect(bow(false)).toBeLessThan(0.05);
    expect(bow(true)).toBeGreaterThan(0.25);
  });

  it('does not change what the river costs', () => {
    // The rule is untouched: a body that reaches the crowd costs one soldier,
    // and where the soldier was standing when it did makes no difference to
    // how many of them there were (D29, `contact.ts`).
    const pushed = cost(true);
    expect(pushed).toBeGreaterThan(10);
    expect(pushed).toBe(cost(false));
  });

  it('flags the units a body is standing in, for render to stumble', () => {
    const tuning = testBalance();
    tuning.squad.fireRate = 0;
    const run = new Run(river(), tuning);
    const crowd = crowdOf(run);
    let shoved = 0;
    for (let step = 0; step < 60 * 20; step++) {
      run.setTargetX(0);
      run.tick(DT);
      forEachLive(crowd, (i) => {
        if (((crowd.flags[i] ?? 0) & CROWD_SHOVED) !== 0) shoved++;
      });
    }
    expect(shoved).toBeGreaterThan(100);
  });
});

describe('the boss shove', () => {
  it('bows the crowd once the boss is close enough to stomp it', () => {
    // Phase A left this undone and Phase C2 wired it: the boss is not in
    // `state.enemies`, so the obstacle gatherer is offered it separately.
    // It pushes from `enemies.boss.shoveReach` rather than the shared reach
    // because it never gets within a body's length of the column — it starts
    // `level.bossOffset` out and closes at half a metre a second — so without a
    // reach of its own the wiring is live and the crowd never feels a thing.
    const run = new Run(generateLevel(1, levelConfig(1), 1), balance);
    const bot = createBot('greedy', 1);
    const crowd = crowdOf(run);
    let bossSteps = 0;
    let shovedSteps = 0;
    for (let step = 0; step < 60 * 240 && run.state.status === 'running'; step++) {
      run.setTargetX(bot(run.state));
      run.tick(DT);
      if (run.state.boss?.active !== true) continue;
      bossSteps++;
      let shoved = false;
      forEachLive(crowd, (i) => {
        if (((crowd.flags[i] ?? 0) & CROWD_SHOVED) !== 0) shoved = true;
      });
      if (shoved) shovedSteps++;
    }
    expect(bossSteps).toBeGreaterThan(600);
    // Not from the first step of the fight: the boss has to walk in first.
    expect(shovedSteps).toBeGreaterThan(bossSteps * 0.3);
    expect(shovedSteps).toBeLessThan(bossSteps);
  }, 60_000);

  it('changes where the boss kills, never how many', () => {
    // The same promise the body shove makes (D43): a stomp takes a share of the
    // squad measured against the count, and the shove only moves the people it
    // lands on.
    const survivors = (reach: number): number => {
      const tuning = testBalance();
      tuning.enemies.boss.shoveReach = reach;
      const run = new Run(generateLevel(1, levelConfig(1), 1), tuning);
      const bot = createBot('greedy', 1, tuning);
      for (let step = 0; step < 60 * 240 && run.state.status === 'running'; step++) {
        run.setTargetX(bot(run.state));
        run.tick(DT);
      }
      return run.state.survivors;
    };
    expect(survivors(balance.enemies.boss.shoveReach)).toBe(survivors(0));
  }, 60_000);
});
