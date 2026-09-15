/**
 * What the six evolution mechanics D54 adds actually do.
 *
 * Every test here is the same shape — the same road played twice, once at the
 * tier below the mechanic and once at the tier that switches it on — because
 * that is the claim the milestone makes. A tier is a *purchase*, and what a
 * player buys has to be exactly the difference between those two runs.
 *
 * Which tier sells which mechanic, and that a player who has bought none of
 * them plays the run the campaign was balanced as, is `./tierGating.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { Obstacles, SHOVE_STRIDE } from '../crowdObstacles';
import { createCrowdState } from '../crowdState';
import type { RowEnemyDef } from '../level';
import { Run } from '../Run';
import type { SimEvent } from '../types';
import { weaponDef } from '../weapons';
import { level, play, row, testBalance, withStaff } from './fixtures';
import { balance } from '@/data';
import type { Balance, StaffTier } from '@/data/types';

/** A road nothing walks on and nothing runs down: only the tier moves. */
function still(): Balance {
  const tuning = testBalance();
  tuning.enemies.grunt.speed = 0;
  tuning.enemies.brute.speed = 0;
  return tuning;
}

function damageTaken(run: Run, id: number): number {
  const enemy = run.state.enemies.find((e) => e.id === id);
  return enemy === undefined ? 0 : enemy.maxHp - enemy.hp;
}

function countOf(events: readonly SimEvent[], type: SimEvent['type']): number {
  return events.filter((event) => event.type === type).length;
}

/**
 * The ceiling every mechanic is held under (Milestone 8): none of them may be
 * worth more than about a third of the squad's own output on its own.
 *
 * Two of the nine are priced in seconds of the squad's fire outright — the
 * meteor and the overcharge, because what a squad puts out spans two orders of
 * magnitude across the campaign and a flat number would be everything at level
 * one and nothing at forty — so for those the ceiling is arithmetic over the
 * tuning rather than a measurement, and it is the tightest form the rule can
 * take. The other seven are held by the end-to-end ceilings in
 * `./balance.test.ts`: measured against a damage rung of known size on a meadow
 * and a frost level, the biggest of them is worth about a seventh of a squad's
 * output and none of the nine comes near a third (the Milestone 8 log).
 */
describe('what a tier may be worth', () => {
  const CEILING = 1 / 3;

  it('never prices a mechanic above a third of the squad\'s own fire', () => {
    const meteor = balance.evolutions.ember.meteor;
    const share = meteor.secondsOfFire / meteor.intervalSeconds;
    expect(`meteor ${share.toFixed(2)} of output`).toBe(
      `meteor ${Math.min(share, CEILING).toFixed(2)} of output`,
    );

    // The arc's floor on its own gap is what turns "every fourth volley" into a
    // beat, so it — not `everyVolleys` — is what bounds the share.
    const arc = balance.evolutions.storm.overcharge;
    const arcShare = arc.secondsOfFire / arc.minSeconds;
    expect(`overcharge ${arcShare.toFixed(2)} of output`).toBe(
      `overcharge ${Math.min(arcShare, CEILING).toFixed(2)} of output`,
    );
  });

  it('keeps the two that hold rather than hurt on a duty cycle under three quarters', () => {
    // The glacier holds one lane of three, so its own ceiling is about where
    // the wall stops being a wall and starts being the road. Widened from a
    // half in Milestone 8, with what the wall is worth: measured, a wall that
    // held *and* killed everything it held, eight seconds in every nine and
    // right in front of the column, moved a run by under a percent — the
    // column runs forward at more than twice a grunt's walking pace, so the
    // hold it buys is a second of extra fire and not the five it names.
    const ice = balance.evolutions.frost.glacier;
    const duty = ice.holdSeconds / ice.intervalSeconds;
    expect(`glacier ${duty.toFixed(2)} duty`).toBe(`glacier ${Math.min(duty, 0.75).toFixed(2)} duty`);
    // And what it takes out of the river it holds, in seconds of the squad's
    // own fire a second, is priced like the meteor and under the same ceiling.
    expect(ice.bite).toBeGreaterThan(0);
    expect(ice.bite).toBeLessThanOrEqual(CEILING);
    // The freeze pulse buys time on the bodies around a frozen death; a chill
    // longer than the staff's own slow would make the pulse the mechanic.
    const pulse = balance.evolutions.frost.freezePulse;
    expect(pulse.seconds).toBeLessThanOrEqual(3);
    expect(pulse.factor).toBeGreaterThan(0);
    expect(pulse.factor).toBeLessThan(1);
  });
});

describe('ember tier 3: wildfire', () => {
  it('passes the fire from the body the squad lit to the one behind it', () => {
    // Two blocks in the same lane, eight tenths of a metre apart: inside the
    // wildfire radius, and the near one is the only one a shot can reach.
    const rows = [
      row(24, [null, null, null], [
        { kind: 'grunt', lane: 0, units: 200 },
        { kind: 'grunt', lane: 0, units: 400, dz: 0.8 },
      ]),
    ];
    const lit = (tier: StaffTier): number[] => {
      const run = new Run(level({ startCount: 20, rows }), still(), withStaff('ember', tier));
      const events = play(run, 1.5, 0);
      return [
        ...new Set(
          events.flatMap((event) => (event.type === 'enemyBurning' ? [event.enemyId] : [])),
        ),
      ].sort((a, b) => a - b);
    };

    // At tier 2 only the struck body burns; at tier 3 the fire hops once.
    expect(lit(2)).toEqual([0]);
    expect(lit(3)).toEqual([0, 1]);
  });

  it('cannot be hotter than the fire it came from, and never spreads twice', () => {
    // What jumps is `share` of what the squad is putting into the body it
    // jumps from, and it arrives half as a flare and half as fire (Milestone 8
    // made the flare of it, because nine parts in ten of a hopped fire were
    // still owed when the body it landed on died). A share under one is what
    // keeps a fire from growing as it travels.
    const wildfire = balance.evolutions.ember.wildfire;
    expect(wildfire.share).toBeGreaterThan(0);
    expect(wildfire.share).toBeLessThan(1);
    expect(wildfire.maxTargets).toBeGreaterThan(0);

    // A packed lane: nine bodies within a metre of each other. With one hop per
    // source and a share under one, what the whole mechanic adds is bounded —
    // it cannot run away down the lane as a chain reaction would.
    const bodies: RowEnemyDef[] = [];
    for (let i = 0; i < 9; i++) bodies.push({ kind: 'grunt', lane: 0, units: 300, dz: i * 0.9 });
    const run = new Run(
      level({ startCount: 20, rows: [row(24, [null, null, null], bodies)] }),
      still(),
      withStaff('ember', 3),
    );
    const events = play(run, 2, 0);

    const burning = new Set(
      events.flatMap((event) => (event.type === 'enemyBurning' ? [event.enemyId] : [])),
    );
    // The squad only ever reaches the front body, so every other fire on the
    // lane arrived by hopping — and no more than the budget of hops allows:
    // a fire that arrived by spreading never spreads on, so the ring around
    // what the squad is shooting is as far as it goes.
    expect(burning.size).toBeGreaterThan(1);
    expect(burning.size).toBeLessThanOrEqual(1 + wildfire.maxTargets);
  });
});

describe('ember tier 4: the meteor', () => {
  const rows = [row(20, [null, null, null], [{ kind: 'grunt', lane: 0, units: 40_000 }])];

  function meteorRun(tier: StaffTier, seconds: number): { run: Run; events: SimEvent[] } {
    const run = new Run(
      level({ startCount: 20, runSpeed: 0, rows }),
      still(),
      withStaff('ember', tier),
    );
    return { run, events: play(run, seconds, 0) };
  }

  it('lands on the crowd\'s aim point every N seconds, and only at tier 4', () => {
    const interval = balance.evolutions.ember.meteor.intervalSeconds;
    const three = meteorRun(3, interval * 2 + 1);
    const four = meteorRun(4, interval * 2 + 1);

    expect(countOf(three.events, 'meteor')).toBe(0);
    expect(countOf(four.events, 'meteor')).toBe(2);
    // On the body the squad is shooting, not on the squad's own feet.
    const first = four.events.find((event) => event.type === 'meteor');
    if (first?.type !== 'meteor') throw new Error('no meteor');
    expect(first.z).toBeCloseTo(20, 0);
    expect(first.radius).toBe(balance.evolutions.ember.meteor.radius);
    // ...and it is a charged shot: the block takes damage nothing else did.
    expect(damageTaken(four.run, 0)).toBeGreaterThan(damageTaken(three.run, 0));
  });

  it('is worth the seconds of the squad\'s own fire the tuning names', () => {
    const tuning = balance.evolutions.ember.meteor;
    const three = meteorRun(3, tuning.intervalSeconds + 0.5);
    const four = meteorRun(4, tuning.intervalSeconds + 0.5);
    const extra = damageTaken(four.run, 0) - damageTaken(three.run, 0);
    // One second of a 20-unit ember squad, times what the tuning says a meteor
    // is worth. Exact, because the blast lands square on a block wider than its
    // own radius: no falloff is spent on empty road.
    const perSecond = 20 * balance.squad.fireRate * balance.squad.damage;
    expect(extra).toBeCloseTo(perSecond * tuning.secondsOfFire, 6);
  });

  it('pushes the crowd through the same field a body standing in it does', () => {
    // The obstacle gatherer directly: a meteor is the one push that comes from
    // nothing on the road, and what has to be true of it is that the crowd
    // feels it for exactly as long as it lasts.
    const crowd = createCrowdState(4);
    crowd.alive[0] = 1;
    const obstacles = new Obstacles(0);
    obstacles.gather(crowd, [], [], [], null, balance, 0, 0);
    expect(obstacles.shoveCount).toBe(0);

    obstacles.push(1.5, 3, 3.2, 2.5, 0.4);
    obstacles.gather(crowd, [], [], [], null, balance, 0, 0.2);
    expect(obstacles.shoveCount).toBe(1);
    expect(obstacles.shovers[0]).toBe(1.5);
    expect(obstacles.shovers[1]).toBe(3);
    expect(obstacles.shovers[2]).toBe(3.2);
    expect(obstacles.shovers[SHOVE_STRIDE - 1]).toBe(2.5);

    // Gone the moment it expires, and gone for good.
    obstacles.gather(crowd, [], [], [], null, balance, 0, 0.5);
    expect(obstacles.shoveCount).toBe(0);
    obstacles.gather(crowd, [], [], [], null, balance, 0, 0.5);
    expect(obstacles.shoveCount).toBe(0);
  });
});

describe('storm tier 3: full chains', () => {
  it('stops the arc losing damage at every hop', () => {
    const rows = [
      row(20, [null, null, null], [{ kind: 'grunt', lane: 0, units: 200 }]),
      row(21.5, [null, null, null], [{ kind: 'grunt', lane: 1, units: 200 }]),
    ];
    const damaged = (tier: StaffTier): number => {
      const run = new Run(level({ startCount: 3, rows }), still(), withStaff('storm', tier));
      play(run, 1.4, 0);
      return damageTaken(run, 1);
    };
    const two = damaged(2);
    const three = damaged(3);
    expect(two).toBeGreaterThan(0);
    // Every hop lands as hard as the first: the whole shot, and no falloff
    // along the arc, where tier 2 pays `damageMul` of it and fades by
    // `falloff` a hop. On the first hop that is exactly `damageMul` apart.
    const chain = weaponDef('storm').chain;
    if (chain === undefined) throw new Error('storm has no arc');
    expect(three).toBeCloseTo(two / chain.damageMul, 0);
    expect(three).toBeGreaterThan(two);
  });
});

describe('storm tier 4: overcharge', () => {
  // One small body in the next lane over, where a squad of three firing up the
  // middle can never reach it and the arc does not stretch to it either.
  const rows = [row(5, [null, null, null], [{ kind: 'grunt', lane: 1, units: 4 }])];

  it('arcs to everything in range, and only at tier 4', () => {
    const arced = (tier: StaffTier): { hurt: number; events: SimEvent[] } => {
      const run = new Run(
        level({ startCount: 3, runSpeed: 0, rows }),
        still(),
        withStaff('storm', tier),
      );
      const events = play(run, 6, 0);
      return { hurt: damageTaken(run, 0), events };
    };
    const three = arced(3);
    const four = arced(4);

    expect(three.hurt).toBe(0);
    expect(countOf(three.events, 'overcharge')).toBe(0);
    expect(four.hurt).toBeGreaterThan(0);
    expect(countOf(four.events, 'overcharge')).toBeGreaterThan(0);
  });

  it('beats once, rather than on every volley the squad fires', () => {
    const tuning = balance.evolutions.storm.overcharge;
    const run = new Run(
      level({ startCount: 3, runSpeed: 0, rows }),
      still(),
      withStaff('storm', 4),
    );
    const seconds = 6;
    const events = play(run, seconds, 0);
    const arcs = countOf(events, 'overcharge');
    // A volley is a step the squad fired on, which at any real squad size is
    // every step; the floor on the gap is what turns that into a beat.
    expect(arcs).toBeGreaterThan(0);
    expect(arcs).toBeLessThanOrEqual(Math.ceil(seconds / tuning.minSeconds));
    const first = events.find((event) => event.type === 'overcharge');
    if (first?.type !== 'overcharge') throw new Error('no arc');
    expect(first.radius).toBe(tuning.radius);
    expect(first.targets).toBe(1);
  });
});

describe('frost tier 3: the freeze pulse', () => {
  // A body the squad kills, and one in the next lane it never touches: near
  // enough for the chill, too far for the shatter its own tier 2 throws.
  const rows = [
    row(10, [null, null, null], [
      { kind: 'grunt', lane: 0, units: 2 },
      { kind: 'grunt', lane: 1, units: 4 },
    ]),
  ];

  it('chills the neighbours of a body that dies frozen, and only at tier 3', () => {
    const chilled = (tier: StaffTier): { slowUntil: number; hurt: number; events: SimEvent[] } => {
      const run = new Run(
        level({ startCount: 3, runSpeed: 0, rows }),
        still(),
        withStaff('frost', tier),
      );
      const events = play(run, 3, 0);
      const neighbour = run.state.enemies.find((e) => e.id === 1);
      return { slowUntil: neighbour?.slowUntil ?? 0, hurt: damageTaken(run, 1), events };
    };
    const two = chilled(2);
    const three = chilled(3);

    // The body the squad shot died either way...
    expect(countOf(two.events, 'enemyShattered')).toBeGreaterThan(0);
    expect(countOf(three.events, 'enemyShattered')).toBeGreaterThan(0);
    // ...and only at tier 3 did the one beside it feel anything.
    expect(two.slowUntil).toBe(0);
    expect(countOf(two.events, 'freezePulse')).toBe(0);
    expect(three.slowUntil).toBeGreaterThan(0);
    expect(countOf(three.events, 'freezePulse')).toBeGreaterThan(0);
    // ...and the cold bites as well as holds (`FreezePulseBalance.share`). It
    // was a chill and nothing else until Milestone 8 measured it: a slow on a
    // body the squad was about to kill anyway is worth nothing, and the tier
    // came out *negative* end to end (the log).
    expect(three.hurt).toBeGreaterThan(two.hurt);
  });
});

describe('frost tier 4: the glacier', () => {
  /**
   * Eight bodies walking down the squad's own lane: a river to hold.
   *
   * They start where the clock below puts them in front of the wall when it
   * goes up — the wall holds what is *ahead* of it and never drags anybody
   * backward, so a river that has already walked past the line is not the
   * thing under test.
   */
  const rows = [
    row(
      21,
      [null, null, null],
      Array.from({ length: 8 }, (_, i) => ({
        kind: 'grunt' as const,
        lane: 0 as const,
        units: 1,
        dz: i * 0.5,
      })),
    ),
  ];

  function glacierRun(tier: StaffTier, seconds: number): { run: Run; events: SimEvent[] } {
    const tuning = testBalance();
    // The shipped clock is a wall every eight seconds; the rule under test
    // is what a wall *does*, so the test turns the clock up rather than
    // playing three minutes of road. The interval stays longer than the hold,
    // which is what leaves a gap between one wall and the next.
    tuning.evolutions.frost.glacier.intervalSeconds = 3;
    tuning.evolutions.frost.glacier.holdSeconds = 1;
    tuning.evolutions.frost.glacier.minBodies = 4;
    // Nothing dies: the wall is about where the bodies are, not how many.
    tuning.squad.fireRate = 0;
    const run = new Run(
      level({ startCount: 10, runSpeed: 0, rows }),
      tuning,
      withStaff('frost', tier),
    );
    return { run, events: play(run, seconds, 0) };
  }

  /** Bodies standing exactly on the line, which is what "held" means. */
  function onTheLine(run: Run, z: number): number {
    return run.state.enemies.filter((e) => e.alive && Math.abs(e.z - z) < 1e-9).length;
  }

  it('holds a lane\'s river at the wall, then lets it go', () => {
    const ahead = balance.evolutions.frost.glacier.ahead;
    const held = glacierRun(4, 3.9);
    const wall = held.events.find((event) => event.type === 'glacier');
    if (wall?.type !== 'glacier') throw new Error('no wall');
    expect(wall.lane).toBe(0);
    expect(wall.z).toBeCloseTo(ahead, 6);
    // Up three seconds in (the clock this test turned up), down a second later
    // — to the step, since a cooldown is counted in steps of 1/60 s.
    expect(wall.until).toBeCloseTo(4, 1);
    expect(held.run.state.ice?.z).toBeCloseTo(ahead, 6);
    expect(onTheLine(held.run, ahead)).toBeGreaterThanOrEqual(4);

    // ...and once it melts the river walks again: nobody is left on the line,
    // and the next wall is still on its cooldown.
    const gone = glacierRun(4, 4.5);
    expect(gone.run.state.ice).toBeNull();
    expect(onTheLine(gone.run, ahead)).toBe(0);
    expect(gone.run.state.enemies.every((e) => !e.alive || e.z < ahead)).toBe(true);
  });

  it('does not go up at tier 3, and the river walks straight through', () => {
    const ahead = balance.evolutions.frost.glacier.ahead;
    const three = glacierRun(3, 3.9);
    expect(countOf(three.events, 'glacier')).toBe(0);
    expect(three.run.state.ice).toBeNull();
    expect(onTheLine(three.run, ahead)).toBe(0);
    expect(Math.min(...three.run.state.enemies.map((e) => e.z))).toBeLessThan(ahead);
  });

  it('spends its cooldown on a river rather than on empty road', () => {
    // The same clock with nothing in the lane: no wall, however long it waits.
    const tuning = testBalance();
    tuning.evolutions.frost.glacier.intervalSeconds = 0.5;
    tuning.squad.fireRate = 0;
    const run = new Run(
      level({ startCount: 10, runSpeed: 0, rows: [] }),
      tuning,
      withStaff('frost', 4),
    );
    const events = play(run, 3, 0);
    expect(countOf(events, 'glacier')).toBe(0);
    expect(run.state.ice).toBeNull();
  });
});
