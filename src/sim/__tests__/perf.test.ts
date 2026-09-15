import { describe, expect, it } from 'vitest';

import { level, row, runOf, staffRow, testBalance, wall } from './fixtures';
import { emptyPlayer, maxStaffTier, maxUpgradeLevel, upgradeIds } from '../player';
import { weaponIds } from '../weapons';
import type { RowDef } from '../level';
import { Run } from '../Run';
import type { StreamDef } from '../types';
import { balance } from '@/data';
import type { Balance } from '@/data/types';

/** A 300-unit squad is the worst case the game allows before the count cap. */
const UNITS = 300;
const TICKS = 600;

/** The plan's budget: three hundred bodies plus three hundred units, 8 ms a tick. */
const TICK_BUDGET_MS = 8;

/** Milestone 6's budget for the crowd itself: five hundred agents, half a
 *  millisecond a step (docs/18-milestone-6-plan.md, "Definition of done"). */
const CROWD_BUDGET_MS = 0.5;

/** Rows are 18 m apart now, so the busy level runs longer for the same count. */
const SPACING = balance.level.rowSpacing;

function busyLevel(): RowDef[] {
  const rows: RowDef[] = [];
  for (let i = 1; i <= 12; i++) {
    rows.push(
      i % 2 === 0
        ? row(
            i * SPACING,
            [null, { kind: 'add', value: 5 }, null],
            [
              { kind: 'grunt', lane: -1, units: 40 },
              { kind: 'brute', lane: 1, units: 20 },
            ],
          )
        : row(i * SPACING, [
            { kind: 'mul', value: 2 },
            { kind: 'sub', value: 40 },
            { kind: 'add', value: 6 },
          ]),
    );
  }
  return rows;
}

/**
 * Three streams whose bodies nothing can kill, so the road saturates at the
 * live ceiling and stays there for the whole measurement. This is the shape the
 * lane lists have to survive: three hundred entries, resorted every step, swept
 * ten times a step, splashed and chained through.
 */
function saturatedStreams(): RowDef[] {
  const def = (lane: StreamDef['lane']): StreamDef => ({
    lane,
    kind: 'grunt',
    count: 4000,
    durationSeconds: 40,
    hpPerEnemy: 1e9,
    speed: balance.streams.speed,
    jitter: balance.streams.jitter,
  });
  return [{ z: 20, gates: [null, null, null], enemies: [], streams: [def(-1), def(0), def(1)] }];
}

/**
 * Tuning for the saturated runs: the squad cannot grow past 300 and cannot be
 * thinned by what walks into it, so the load stays at its worst for the whole
 * measurement. What is being timed is the cost of three hundred live bodies —
 * the lane lists, the sweeps, the splash and the chain — not the cost of losing
 * to them, which would end the run in the first two seconds.
 */
function saturatedTuning(): Balance {
  const tuning = testBalance();
  tuning.squad.maxCount = UNITS;
  tuning.enemies.contactDistance = 0;
  return tuning;
}

function measure(run: Run): number {
  const started = performance.now();
  for (let i = 0; i < TICKS; i++) {
    run.setTargetX(((i % 120) / 120) * 4 - 2);
    run.tick(1 / 60);
  }
  return (performance.now() - started) / TICKS;
}

describe('the crowd', () => {
  it('moves five hundred agents inside half a millisecond a step', () => {
    // The agents and nothing else: no fire, no bodies, no gates. What is being
    // timed is the seek, the spatial hash, the separation, the body projection
    // and the fence and arch tests, at the biggest crowd the game allows, with
    // the head whipping from side to side the whole time so the chain never
    // settles (D43).
    const tuning = testBalance();
    tuning.squad.fireRate = 0;
    const run = runOf(level({ startCount: 500, rows: [], arenaZ: 40_000 }), tuning);
    for (let i = 0; i < 120; i++) run.tick(1 / 60);
    expect(run.state.squad.count).toBe(500);

    const perStep = measure(run);
    // Reported rather than merely asserted: the number is the milestone's, and
    // a future change that doubles it should be visible in the run log.
    console.log(`crowd: 500 agents, ${perStep.toFixed(3)} ms a step`);
    expect(perStep).toBeLessThan(CROWD_BUDGET_MS);
  });

  it('holds the budget with a river shoving it and a fence to jam against', () => {
    // The same crowd with everything that touches it at once: a wall to pile
    // against, a straggler group of its own, and three hundred bodies in the
    // shove test.
    const tuning = saturatedTuning();
    tuning.squad.maxCount = 500;
    const run = runOf(
      level({
        startCount: 500,
        rows: saturatedStreams(),
        arenaZ: 40_000,
        walls: [wall(1, 20, 30_000)],
      }),
      tuning,
    );
    for (let i = 0; i < 600; i++) {
      run.setTargetX(1);
      run.tick(1 / 60);
    }
    expect(run.state.squad.count).toBe(500);
    const perStep = measure(run);
    console.log(`crowd under load: 500 agents + 300 bodies, ${perStep.toFixed(3)} ms a tick`);
    expect(perStep).toBeLessThan(TICK_BUDGET_MS);
  });
});

describe('hot loop', () => {
  it('holds 300 bodies and 300 units inside the frame budget', () => {
    const tuning = saturatedTuning();
    const run = runOf(
      level({ startCount: UNITS, rows: saturatedStreams(), arenaZ: 40_000 }),
      tuning,
    );

    // Let the road fill to the ceiling before the clock starts. It sits a body
    // or two under it: the spawn burst is capped per step, so the ceiling is
    // refilled a step behind the ones that walk off the back.
    for (let i = 0; i < 600; i++) run.tick(1 / 60);
    const floor = tuning.enemies.maxLive - 5;
    expect(run.state.enemies.filter((e) => e.alive).length).toBeGreaterThanOrEqual(floor);

    const perTick = measure(run);
    expect(run.state.status).toBe('running');
    expect(run.state.squad.count).toBe(UNITS);
    expect(run.state.enemies.filter((e) => e.alive).length).toBeGreaterThanOrEqual(floor);
    expect(perTick).toBeLessThan(TICK_BUDGET_MS);
  });

  it('holds the same load with a staff that splashes, chains and slows', () => {
    for (const staff of ['ember', 'storm', 'frost'] as const) {
      const tuning = saturatedTuning();
      const rows = [staffRow(1, staff), ...saturatedStreams()];
      const run = runOf(level({ startCount: UNITS, rows, arenaZ: 40_000 }), tuning);
      for (let i = 0; i < 600; i++) run.tick(1 / 60);

      expect(`${staff}: ${(measure(run) < TICK_BUDGET_MS).toString()}`).toBe(`${staff}: true`);
    }
  });

  it('holds the same load with every upgrade bought, an evolved staff and a wisp', () => {
    // The worst case the meta layer can build: three hundred bodies, three
    // hundred units, a burn ticking on everything the squad touches and a
    // familiar picking its own targets out of the same lane lists.
    const player = emptyPlayer();
    for (const id of upgradeIds) player.upgrades[id] = maxUpgradeLevel;
    player.staffs.ember = { unlocked: true, tier: 2 };
    player.familiar = { unlocked: true, tier: 3 };

    const tuning = saturatedTuning();
    const run = new Run(
      level({ startCount: UNITS, rows: saturatedStreams(), arenaZ: 40_000 }),
      tuning,
      player,
    );
    for (let i = 0; i < 600; i++) run.tick(1 / 60);
    expect(run.state.familiar).not.toBeNull();
    expect(run.state.enemies.filter((e) => e.alive).length).toBeGreaterThanOrEqual(
      tuning.enemies.maxLive - 5,
    );
    expect(measure(run)).toBeLessThan(TICK_BUDGET_MS);
  });

  it('holds the same load with a whole evolution ladder bought', () => {
    // The test above is the Milestone 4 loadout — one evolution, the burn. D54
    // put six more mechanics in the hot loop and three of them scan the lane
    // lists on a clock of their own: the wildfire hands fire on at every step
    // the squad is feeding one, the meteor blasts a crater every few seconds,
    // and the glacier grinds whatever its wall is holding on every step of the
    // hold. This is the loadout a player who has bought out a ladder walks a
    // river with, which is the one that has to hold the budget.
    for (const staff of weaponIds) {
      const player = emptyPlayer();
      for (const id of upgradeIds) player.upgrades[id] = maxUpgradeLevel;
      player.staffs[staff] = { unlocked: true, tier: maxStaffTier };
      player.selectedStaff = staff;
      player.familiar = { unlocked: true, tier: 3 };

      const tuning = saturatedTuning();
      const run = new Run(
        level({ startCount: UNITS, rows: saturatedStreams(), arenaZ: 40_000 }),
        tuning,
        player,
      );
      for (let i = 0; i < 600; i++) run.tick(1 / 60);
      expect(`${staff}: ${(measure(run) < TICK_BUDGET_MS).toString()}`).toBe(`${staff}: true`);
    }
  });

  it('runs a road of gates and blocks with 300 units well inside the budget', () => {
    const run = runOf(level({ startCount: UNITS, rows: busyLevel(), arenaZ: 4000 }));
    expect(measure(run)).toBeLessThan(TICK_BUDGET_MS);
    expect(run.state.status).toBe('running');
  });

  it('re-uses the event array and the projectile pool instead of allocating', () => {
    const run = runOf(level({ startCount: UNITS, rows: busyLevel(), arenaZ: 4000 }));

    const first = run.tick(1 / 60);
    const second = run.tick(1 / 60);
    expect(second).toBe(first);

    const seen = new Set<number>();
    for (let i = 0; i < TICKS; i++) {
      run.tick(1 / 60);
      for (const projectile of run.state.projectiles) seen.add(projectile.id);
    }
    // Ids are pool slots: a fresh object per shot would blow far past the cap.
    expect(seen.size).toBeLessThanOrEqual(400);
  });

  it('re-uses retired stream bodies instead of allocating one per spawn', () => {
    const tuning = saturatedTuning();
    tuning.enemies.maxLive = 40;
    const run = runOf(
      level({ startCount: UNITS, rows: saturatedStreams(), arenaZ: 40_000 }),
      tuning,
    );

    const ids = new Set<number>();
    const objects = new Set<object>();
    for (let i = 0; i < 60 * 30; i++) {
      run.tick(1 / 60);
      for (const enemy of run.state.enemies) {
        ids.add(enemy.id);
        objects.add(enemy);
      }
    }
    // Hundreds of bodies came and went; the objects behind them did not.
    expect(ids.size).toBeGreaterThan(200);
    expect(objects.size).toBeLessThan(ids.size / 2);
  });
});
