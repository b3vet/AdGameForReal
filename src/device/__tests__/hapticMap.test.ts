/**
 * The haptic map, on a fake device.
 *
 * Its sibling `./haptics.test.ts` proves the module does *nothing* in a
 * browser, which is the case every web build runs. This one is the other half:
 * with `Capacitor` mocked into saying "ios" and the Taptic Engine mocked into a
 * list of strings, which event produces which buzz, and how many of them a
 * clustered tick is allowed to produce.
 *
 * Both halves matter for the same reason. Nobody here is holding the phone: the
 * only way a wrong buzz is caught before the product owner's playtest is a test
 * that reads the mapping back.
 *
 * `vi.mock` is hoisted and Vitest gives every test file its own module graph,
 * so the platform is decided before `../haptics` is imported and the mock does
 * not leak into the sibling file.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SimEvent } from '@/sim';

const impacts: string[] = [];
const notifications: string[] = [];

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: (): string => 'ios',
    isNativePlatform: (): boolean => true,
  },
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: {
    impact: (options: { style: string }): Promise<void> => {
      impacts.push(options.style);
      return Promise.resolve();
    },
    notification: (options: { type: string }): Promise<void> => {
      notifications.push(options.type);
      return Promise.resolve();
    },
  },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
}));

const { feedSimEvents, hapticsActive, onRunAwards } = await import('../haptics');

/** The gap `haptics.ts` holds between two impacts. */
const GAP_MS = 120;

/**
 * The wall clock the throttle reads. Driven by hand so "120 ms later" is a
 * fact rather than a sleep, and so a slow machine cannot make the test flaky.
 *
 * It only ever goes forward, including between tests: `haptics.ts` keeps one
 * module-level timestamp for the whole page (there is one Taptic Engine), so a
 * clock that rewound to the same start each time would leave the next test's
 * first buzz inside the gap the last test had already spent.
 */
let clock = 1_000_000;
vi.spyOn(performance, 'now').mockImplementation(() => clock);

/** One event at a time, each a full gap after the last, so nothing is throttled. */
function unthrottled(event: SimEvent): void {
  clock += GAP_MS;
  feedSimEvents([event]);
}

beforeEach(() => {
  impacts.length = 0;
  notifications.length = 0;
  // Well past any gap, so each test starts with the engine free.
  clock += 10_000;
});

describe('haptics on a device', () => {
  it('is active', () => {
    expect(hapticsActive()).toBe(true);
  });

  it('taps light on a gate pass', () => {
    unthrottled({
      type: 'gatePassed',
      gateId: 1,
      kind: 'add',
      value: 5,
      countBefore: 10,
      countAfter: 15,
    });
    expect(impacts).toEqual(['LIGHT']);
  });

  it('taps medium on a shield break and on a charger', () => {
    unthrottled({ type: 'shieldBreak', enemyId: 4, x: 0, z: 20 });
    unthrottled({ type: 'charge', enemyId: 5, kind: 'charger', lane: 0 });
    expect(impacts).toEqual(['MEDIUM', 'MEDIUM']);
  });

  it('taps heavy on a meteor and on the boss winding up to charge', () => {
    unthrottled({ type: 'meteor', x: 0, z: 30, radius: 3 });
    unthrottled({ type: 'charge', enemyId: 9, kind: 'boss', lane: 1 });
    expect(impacts).toEqual(['HEAVY', 'HEAVY']);
  });

  it('keeps Milestone 4s three: the stomp, the boss dying and the win', () => {
    unthrottled({ type: 'bossStomp', x: 0, z: 30 });
    unthrottled({ type: 'bossKilled' });
    unthrottled({ type: 'runEnded', status: 'won', survivors: 40, peakCount: 120 });
    expect(impacts).toEqual(['MEDIUM', 'HEAVY']);
    expect(notifications).toEqual(['SUCCESS']);
  });

  it('warns on the wipe', () => {
    unthrottled({ type: 'runEnded', status: 'lost', survivors: 0, peakCount: 88 });
    expect(notifications).toEqual(['WARNING']);
    expect(impacts).toEqual([]);
  });

  it('says nothing during ordinary shooting', () => {
    // Every event a second of play is mostly made of, plus the three evolution
    // effects that fire several times a second once a staff is upgraded (D54).
    unthrottled({ type: 'projectileFired', x: 0, z: 2 });
    unthrottled({ type: 'projectileHit', weaponId: 'ember', x: 0, z: 12 });
    unthrottled({ type: 'enemyHit', enemyId: 1, damage: 3, hp: 5, x: 0, z: 12 });
    unthrottled({ type: 'enemyKilled', enemyId: 1, kind: 'grunt', x: 0, z: 12 });
    unthrottled({ type: 'enemyShattered', enemyId: 1, x: 0, z: 12 });
    unthrottled({ type: 'gateHit', gateId: 2, kind: 'add', value: 4 });
    unthrottled({ type: 'overcharge', x: 0, z: 14, radius: 6, targets: 9 });
    unthrottled({ type: 'freezePulse', x: 0, z: 14, radius: 4 });
    unthrottled({ type: 'glacier', lane: 1, z: 18, until: 9 });
    unthrottled({ type: 'unitsLost', amount: 3, reason: 'contact' });
    expect(impacts).toEqual([]);
    expect(notifications).toEqual([]);
  });

  /**
   * The reason the gap exists. A gate row is several gates wide, a Frostfell
   * wave sets off two chargers within a stride, and `?turbo` runs sixty sim
   * seconds inside one frame — so a tick can carry a dozen buzz-worthy events
   * and the engine must still be asked once.
   */
  it('allows one impact per 120 ms, whatever the tick carried', () => {
    feedSimEvents([
      { type: 'gatePassed', gateId: 1, kind: 'add', value: 5, countBefore: 1, countAfter: 6 },
      { type: 'gatePassed', gateId: 2, kind: 'add', value: 5, countBefore: 6, countAfter: 11 },
      { type: 'shieldBreak', enemyId: 4, x: 0, z: 20 },
      { type: 'meteor', x: 0, z: 30, radius: 3 },
      { type: 'bossStomp', x: 0, z: 30 },
    ]);
    expect(impacts).toEqual(['LIGHT']);

    // One millisecond short of the gap: still the same buzz.
    clock += GAP_MS - 1;
    feedSimEvents([{ type: 'bossStomp', x: 0, z: 30 }]);
    expect(impacts).toEqual(['LIGHT']);

    clock += 1;
    feedSimEvents([{ type: 'bossStomp', x: 0, z: 30 }]);
    expect(impacts).toEqual(['LIGHT', 'MEDIUM']);
  });

  /**
   * The three verdicts happen once a run and must never be swallowed — the win
   * lands in the same tick the boss died in, which is exactly the tick the gap
   * would have eaten it in.
   */
  it('never throttles the verdict away', () => {
    feedSimEvents([
      { type: 'bossKilled' },
      { type: 'runEnded', status: 'won', survivors: 40, peakCount: 120 },
    ]);
    expect(impacts).toEqual(['HEAVY']);
    expect(notifications).toEqual(['SUCCESS']);
  });

  it('buzzes once for what the sheet paid, and not at all for an empty payout', () => {
    onRunAwards(0, 0);
    expect(notifications).toEqual([]);

    onRunAwards(1, 0);
    onRunAwards(0, 2);
    expect(notifications).toEqual(['SUCCESS', 'SUCCESS']);
  });
});
