/**
 * The mission board (D51): the seeded draw, the counting, and the payment.
 *
 * Two things are worth testing hardest, and they are the two ways a player
 * loses something: a draw that is not reproducible (the board re-rolls itself
 * on every reload) and a reward that is paid twice (the economy stops meaning
 * anything). Both have a test of their own below.
 *
 * `RunState` is faked rather than played: the tracker reads four fields off it
 * — `time`, `status`, `survivors`, `peakCount` — plus the straggler groups, and
 * playing a real level to make those numbers would test the level generator.
 */

import { describe, expect, it } from 'vitest';

import { missionDef, missions as missionsData } from '@/data';
import type { MissionsState } from '@/data';
import type { GroupState, RunState, SimEvent } from '@/sim';

import { emptyKills } from '../bestiary';
import {
  RunTracker,
  applyMissions,
  boardSize,
  missionBoard,
  missionTarget,
  rollMissions,
} from '../missions';
import type { RunTally } from '../missions';

/** The four fields the tracker reads, and nothing else. */
function fakeState(fields: {
  time?: number;
  status?: 'running' | 'won' | 'lost';
  survivors?: number;
  peakCount?: number;
  groups?: GroupState[];
}): RunState {
  const state = {
    time: fields.time ?? 0,
    status: fields.status ?? 'running',
    survivors: fields.survivors ?? 0,
    peakCount: fields.peakCount ?? 0,
    ...(fields.groups === undefined ? {} : { groups: fields.groups }),
  };
  // The tracker touches five fields of a `RunState`; a whole one would have to
  // be played out of the level generator to make them.
  return state as unknown as RunState;
}

function group(count: number): GroupState {
  return { count } as unknown as GroupState;
}

/** A tally with nothing in it, for the fields one test cares about. */
function tally(fields: Partial<RunTally> = {}): RunTally {
  return {
    cleared: false,
    endless: false,
    survivors: 0,
    peak: 0,
    shieldsBroken: 0,
    chargersKilled: 0,
    mulGates: 0,
    bossSeconds: null,
    cleanColumn: true,
    metres: 0,
    kills: emptyKills(),
    ...fields,
  };
}

const empty: MissionsState = { active: [], rolled: 0 };

describe('the pool', () => {
  it('has at least twelve missions across every kind', () => {
    expect(missionsData.pool.length).toBeGreaterThanOrEqual(12);

    const kinds = new Set(missionsData.pool.map((def) => def.kind));
    expect([...kinds].sort()).toEqual([
      'bossUnder',
      'breakShields',
      'clearLevel',
      'endlessMetres',
      'finishWith',
      'killChargers',
      'mulGates',
      'noStragglers',
    ]);
  });

  it('has unique ids, a reward and a line of text on every entry', () => {
    const ids = new Set<string>();
    for (const def of missionsData.pool) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      expect(def.param).toBeGreaterThan(0);
      expect(def.reward).toBeGreaterThan(0);
      expect(def.text.length).toBeGreaterThan(8);
    }
  });
});

describe('the draw', () => {
  it('fills an empty board with three different missions', () => {
    const rolled = rollMissions(empty);
    expect(rolled).not.toBeNull();
    if (rolled === null) return;

    expect(rolled.active).toHaveLength(boardSize);
    expect(new Set(rolled.active.map((mission) => mission.id)).size).toBe(boardSize);
    expect(rolled.rolled).toBe(boardSize);
    for (const mission of rolled.active) {
      expect(missionDef(mission.id)).not.toBeNull();
      expect(mission).toMatchObject({ progress: 0, done: false });
    }
  });

  it('is a function of `rolled` alone, so a reload never re-rolls', () => {
    const first = rollMissions(empty);
    const second = rollMissions(empty);
    expect(second).toEqual(first);

    // And a board already full is left exactly as it is.
    expect(first === null ? null : rollMissions(first)).toBeNull();
  });

  it('replaces only what is done, and never draws a duplicate', () => {
    const full = rollMissions(empty);
    expect(full).not.toBeNull();
    if (full === null) return;

    const partly: MissionsState = {
      active: full.active.map((mission, index) =>
        index === 0 ? { ...mission, done: true, progress: 9 } : mission,
      ),
      rolled: full.rolled,
    };

    const next = rollMissions(partly);
    expect(next).not.toBeNull();
    if (next === null) return;

    expect(next.active).toHaveLength(boardSize);
    expect(next.active.map((mission) => mission.id)).not.toContain(full.active[0]?.id);
    // The two that were not done are untouched, progress included.
    expect(next.active.slice(0, 2)).toEqual(full.active.slice(1));
    expect(new Set(next.active.map((mission) => mission.id)).size).toBe(boardSize);
  });

  it('drops a mission whose id has been retired from the pool', () => {
    const stale: MissionsState = {
      active: [{ id: 'a-mission-that-was-retired', progress: 4, done: false }],
      rolled: 3,
    };
    const next = rollMissions(stale);
    expect(next).not.toBeNull();
    if (next === null) return;
    expect(next.active).toHaveLength(boardSize);
    expect(next.active.map((mission) => mission.id)).not.toContain(
      'a-mission-that-was-retired',
    );
  });
});

describe('the tracker', () => {
  it('counts shields, chargers, multiplier sigils and the boss clock', () => {
    const tracker = new RunTracker('demon');
    const events: SimEvent[] = [
      { type: 'shieldBreak', enemyId: 1, x: 0, z: 0 },
      { type: 'shieldBreak', enemyId: 2, x: 0, z: 0 },
      { type: 'enemyKilled', enemyId: 3, kind: 'charger', x: 0, z: 0 },
      { type: 'enemyKilled', enemyId: 4, kind: 'grunt', x: 0, z: 0 },
      { type: 'gatePassed', gateId: 1, kind: 'mul', value: 2, countBefore: 5, countAfter: 10 },
      { type: 'gatePassed', gateId: 2, kind: 'add', value: 5, countBefore: 10, countAfter: 15 },
    ];
    tracker.absorb(events, fakeState({ time: 4 }));
    tracker.absorb([{ type: 'bossActivated', enemyId: 9 }], fakeState({ time: 60 }));
    tracker.absorb([{ type: 'bossKilled' }], fakeState({ time: 78 }));

    const result = tracker.tally(
      fakeState({ status: 'won', survivors: 42, peakCount: 310, time: 78 }),
      null,
    );

    expect(result.shieldsBroken).toBe(2);
    expect(result.chargersKilled).toBe(1);
    expect(result.mulGates).toBe(1);
    expect(result.bossSeconds).toBe(18);
    expect(result.cleared).toBe(true);
    expect(result.survivors).toBe(42);
    expect(result.peak).toBe(310);
    expect(result.kills.grunt).toBe(1);
    expect(result.kills.charger).toBe(1);
    expect(result.kills.demon).toBe(1);
    expect(result.kills.rime).toBe(0);
  });

  it('files the boss under the variant the road ends with (D49)', () => {
    const tracker = new RunTracker('rime');
    // A body of kind `boss` is not counted here: the variant is only known to
    // the session, so `bossKilled` is what pays the ladder.
    tracker.absorb(
      [
        { type: 'enemyKilled', enemyId: 1, kind: 'boss', x: 0, z: 0 },
        { type: 'bossKilled' },
      ],
      fakeState({ time: 10 }),
    );
    const result = tracker.tally(fakeState({ status: 'won' }), null);
    expect(result.kills.rime).toBe(1);
    expect(result.kills.demon).toBe(0);
  });

  it('notices a column that broke, and one that did not', () => {
    const clean = new RunTracker('demon');
    clean.absorb([], fakeState({ groups: [group(200), group(0), group(0)] }));
    expect(clean.tally(fakeState({ status: 'won' }), null).cleanColumn).toBe(true);

    const cut = new RunTracker('demon');
    cut.absorb([], fakeState({ groups: [group(190), group(0), group(0)] }));
    cut.absorb([], fakeState({ groups: [group(180), group(10), group(0)] }));
    // And it stays broken once it has been: the group rejoining does not undo it.
    cut.absorb([], fakeState({ groups: [group(190), group(0), group(0)] }));
    expect(cut.tally(fakeState({ status: 'won' }), null).cleanColumn).toBe(false);
  });

  it('reads an endless run in metres rather than as a clear', () => {
    const tracker = new RunTracker('demon');
    const result = tracker.tally(fakeState({ status: 'won', survivors: 3 }), 812.6);
    expect(result.endless).toBe(true);
    expect(result.cleared).toBe(false);
    expect(result.metres).toBeCloseTo(812.6);
  });
});

describe('progress', () => {
  function boardWith(id: string, progress = 0, done = false): MissionsState {
    return { active: [{ id, progress, done }], rolled: 1 };
  }

  it('climbs a counting mission across runs and pays once', () => {
    const def = missionDef('roads3');
    expect(def).not.toBeNull();
    if (def === null) return;

    let state = boardWith('roads3');
    let paid = 0;
    for (let run = 0; run < 5; run++) {
      const outcome = applyMissions(state, tally({ cleared: true }));
      state = outcome.missions;
      paid += outcome.coins;
    }

    expect(state.active[0]).toEqual({ id: 'roads3', progress: def.param, done: true });
    // Five clears, one payment: the two runs past the target add nothing.
    expect(paid).toBe(def.reward);
  });

  it('takes the best single run for a `finishWith`, never the sum', () => {
    let state = boardWith('arrive40');
    state = applyMissions(state, tally({ cleared: true, survivors: 25 })).missions;
    expect(state.active[0]?.progress).toBe(25);

    // A worse run does not walk it back...
    state = applyMissions(state, tally({ cleared: true, survivors: 10 })).missions;
    expect(state.active[0]?.progress).toBe(25);
    expect(state.active[0]?.done).toBe(false);

    // ...and two runs of 25 are not a run of 50.
    const outcome = applyMissions(state, tally({ cleared: true, survivors: 44 }));
    expect(outcome.missions.active[0]?.done).toBe(true);
    expect(outcome.coins).toBeGreaterThan(0);
    expect(outcome.completed.map((row) => row.id)).toEqual(['arrive40']);
  });

  it('only counts survivors on a road that was actually walked to its end', () => {
    const state = applyMissions(
      boardWith('arrive40'),
      tally({ cleared: false, survivors: 200 }),
    );
    expect(state.missions.active[0]?.progress).toBe(0);
  });

  it('takes a `bossUnder` in one step or not at all', () => {
    const slow = applyMissions(boardWith('boss25'), tally({ bossSeconds: 40 }));
    expect(slow.missions.active[0]?.progress).toBe(0);

    const fast = applyMissions(boardWith('boss25'), tally({ bossSeconds: 21 }));
    expect(fast.missions.active[0]).toEqual({ id: 'boss25', progress: 1, done: true });

    // The one kind whose bar is a single step rather than a count.
    const def = missionDef('boss25');
    expect(def).not.toBeNull();
    if (def !== null) expect(missionTarget(def)).toBe(1);
  });

  it('wants both a clear and an unbroken column for `noStragglers`', () => {
    expect(
      applyMissions(boardWith('column1'), tally({ cleared: true, cleanColumn: false })).missions
        .active[0]?.progress,
    ).toBe(0);
    expect(
      applyMissions(boardWith('column1'), tally({ cleared: false, cleanColumn: true })).missions
        .active[0]?.progress,
    ).toBe(0);
    expect(
      applyMissions(boardWith('column1'), tally({ cleared: true, cleanColumn: true })).missions
        .active[0]?.done,
    ).toBe(true);
  });

  it('measures endless missions in metres of one run', () => {
    let state = boardWith('endless600');
    state = applyMissions(state, tally({ endless: true, metres: 310.9 })).missions;
    expect(state.active[0]?.progress).toBe(310);

    const outcome = applyMissions(state, tally({ endless: true, metres: 900 }));
    expect(outcome.missions.active[0]?.done).toBe(true);
    expect(outcome.coins).toBe(missionDef('endless600')?.reward);
  });

  it('leaves a finished mission alone until the next session start', () => {
    const done = boardWith('roads3', 3, true);
    const outcome = applyMissions(done, tally({ cleared: true }));
    expect(outcome.coins).toBe(0);
    expect(outcome.changed).toBe(false);
    expect(outcome.missions.active[0]).toEqual({ id: 'roads3', progress: 3, done: true });
  });
});

describe('the board view', () => {
  it('clamps progress to the target and carries the copy', () => {
    const state: MissionsState = {
      active: [{ id: 'roads3', progress: 99, done: true }],
      rolled: 1,
    };
    const rows = missionBoard(state);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'roads3',
      kind: 'clearLevel',
      progress: 3,
      target: 3,
      done: true,
    });
    expect(rows[0]?.text).toBe(missionDef('roads3')?.text);
  });

  it('skips a row it cannot describe', () => {
    expect(missionBoard({ active: [{ id: 'gone', progress: 1, done: false }], rolled: 0 })).toEqual(
      [],
    );
  });
});
