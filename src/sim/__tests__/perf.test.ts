import { describe, expect, it } from 'vitest';

import { level, row, runOf, staffRow } from './fixtures';
import type { RowDef } from '../level';

/** A 300-unit squad is the worst case the game allows before the count cap. */
const UNITS = 300;
const TICKS = 600;
const BUDGET_MS = 300;

/** Rows sit 11 m apart now, so the busy level packs more into the same run. */
const SPACING = 11;

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

describe('hot loop', () => {
  it('runs 600 ticks with 300 units well inside a frame budget', () => {
    const run = runOf(level({ startCount: UNITS, rows: busyLevel(), arenaZ: 4000 }));

    const started = performance.now();
    for (let i = 0; i < TICKS; i++) {
      run.setTargetX(((i % 120) / 120) * 4 - 2);
      run.tick(1 / 60);
    }
    const elapsed = performance.now() - started;

    expect(run.state.status).toBe('running');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  it('stays inside the budget with a staff that splashes, chains and slows', () => {
    // Every weapon effect on the same hot loop: the worst case the game allows.
    for (const staff of ['ember', 'storm', 'frost'] as const) {
      const rows = [staffRow(1, staff), ...busyLevel()];
      const run = runOf(level({ startCount: UNITS, rows, arenaZ: 4000 }));

      const started = performance.now();
      for (let i = 0; i < TICKS; i++) {
        run.setTargetX(((i % 120) / 120) * 4 - 2);
        run.tick(1 / 60);
      }
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    }
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
});
