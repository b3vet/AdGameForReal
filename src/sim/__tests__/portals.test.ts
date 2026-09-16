import { describe, expect, it } from 'vitest';

import { level, play, runOf } from './fixtures';
import type { RowDef } from '../level';
import { portalWindow } from '../pressure';
import type { EnemyState, SimEvent, StreamDef } from '../types';
import { balance } from '@/data';

const RUN = balance.squad.runSpeed;
const WALK = balance.streams.speed;
const STOP = balance.enemies.portal.stopGap;

function portal(overrides: Partial<StreamDef> = {}): StreamDef {
  return {
    lane: 0,
    kind: 'grunt',
    count: 40,
    durationSeconds: 4,
    hpPerEnemy: 1e6,
    speed: WALK,
    jitter: 0,
    anchorZ: 120,
    openAt: 50,
    ...overrides,
  };
}

function portalRun(def: StreamDef, count = 400): ReturnType<typeof runOf> {
  const row: RowDef = { z: 108, gates: [null, null, null], enemies: [], streams: [def] };
  return runOf(level({ startCount: count, rows: [row], arenaZ: 100_000 }));
}

function bodies(run: ReturnType<typeof runOf>): EnemyState[] {
  return run.state.enemies.filter((e) => e.streamId !== undefined);
}

describe('portals on the road', () => {
  it('stands the stream at the portal, not at the row that carries it', () => {
    const run = portalRun(portal());
    const stream = run.state.streams[0];
    expect(stream?.z).toBe(120);
    expect(stream?.anchorZ).toBe(120);
    expect(stream?.headZ).toBe(120);
  });

  it('opens when the squad is `openAt` short of the portal, not before', () => {
    const run = portalRun(portal());
    // The squad reaches 120 - 50 = 70 m after 14 s.
    play(run, 13.9);
    expect(run.state.streams[0]?.started).toBe(false);
    expect(bodies(run)).toHaveLength(0);
    const events: SimEvent[] = play(run, 0.3);
    expect(run.state.streams[0]?.started).toBe(true);
    expect(events.some((e) => e.type === 'streamStarted')).toBe(true);
  });

  it('releases every body at the portal', () => {
    const run = portalRun(portal());
    play(run, 14.1);
    const first = bodies(run);
    expect(first.length).toBeGreaterThan(0);
    for (const body of first) expect(body.z).toBeGreaterThan(120 - WALK * 0.2);
    for (const body of first) expect(body.z).toBeLessThanOrEqual(120);
  });

  it('stops pouring once the squad is inside the stop gap, dropping the rest', () => {
    // Twenty seconds of pour asked for, far more than the approach allows.
    const run = portalRun(portal({ count: 200, durationSeconds: 20 }));
    const openAt = (120 - 50) / RUN;
    const stopAt = (120 - STOP) / RUN;
    play(run, stopAt + 0.1);
    const stream = run.state.streams[0];
    expect(stream?.cut).toBe(true);
    const poured = stream?.spawned ?? 0;
    expect(stream?.count).toBe(poured);
    // About the pour rate times the seconds the approach left it.
    expect(poured).toBeGreaterThan((200 / 20) * (stopAt - openAt) - 3);
    expect(poured).toBeLessThan((200 / 20) * (stopAt - openAt) + 3);
    play(run, 1);
    expect(stream?.spawned).toBe(poured);
  });

  it('finishes a portal the squad reached before it ever opened, without a word', () => {
    // Opened only inside the stop gap: it can never pour.
    const run = portalRun(portal({ openAt: STOP - 1 }));
    const events = play(run, (120 - STOP) / RUN + 1);
    const stream = run.state.streams[0];
    expect(stream?.started).toBe(false);
    expect(stream?.done).toBe(true);
    expect(events.some((e) => e.type === 'streamStarted' || e.type === 'streamCleared')).toBe(false);
  });

  it('keeps a stream without an anchor on the moving spawner', () => {
    const { anchorZ: _anchor, openAt: _open, ...moving } = portal();
    const run = portalRun(moving);
    play(run, (108 - balance.streams.spawnAhead) / RUN + 0.2);
    const first = bodies(run)[0];
    expect(run.state.streams[0]?.anchorZ).toBeUndefined();
    expect(first?.z ?? 0).toBeGreaterThan(108 - 1);
  });
});

describe('the portal window', () => {
  const base = { at: -10, open: 50, seconds: 4, screened: false, speed: WALK };

  it('matches the arithmetic for an unscreened portal', () => {
    const shape = portalWindow(base);
    const closing = RUN + WALK;
    const range = balance.projectiles.range;
    // First body in range at (open - range) / closing, last body arrives at
    // (open + speed * seconds) / closing.
    const expected = (50 + WALK * 4) / closing - (50 - range) / closing;
    expect(shape.pour).toBe(4);
    expect(shape.window).toBeCloseTo(expected, 6);
  });

  it('is shorter, and costs more of the river, behind a panel that stops shots', () => {
    const open = portalWindow({ ...base, at: 8 });
    const screened = portalWindow({ ...base, at: 8, screened: true });
    expect(screened.window).toBeLessThan(open.window);
    expect(screened.tollShare).toBeGreaterThan(open.tollShare);
  });

  it('only screens a portal that stands behind the panel', () => {
    expect(portalWindow({ ...base, screened: true })).toEqual(portalWindow(base));
  });

  it('pours no longer than the approach leaves before the stop gap', () => {
    const shape = portalWindow({ ...base, open: 20, seconds: 10 });
    expect(shape.pour).toBeCloseTo((20 - STOP) / RUN, 9);
    expect(portalWindow({ ...base, open: STOP }).window).toBe(0);
  });
});
