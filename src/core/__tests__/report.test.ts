/**
 * The device report (Milestone 9, plan section D).
 *
 * Two things are tested, and the second is the one that matters. The first is
 * that every section reaches the page with the numbers it was given. The second
 * is that *nothing* throws: the report is what a broken build is reported with,
 * and it is asked for on a phone that may have no engine yet, no capture, no
 * run and a save that has never been written. A report with dashes in it is a
 * report; an exception is silence.
 */

import { describe, expect, it } from 'vitest';

import type { RunState } from '@/sim';
import type { CaptureSummary, Spread } from '@/ui';

import { APP_VERSION, BUILD_KIND, buildReport, collectReport, readGl } from '../report';
import type { ReportInput } from '../report';

function spread(median: number, p95: number): Spread {
  return { min: median / 2, median, p95, max: p95 * 2 };
}

function capture(): CaptureSummary {
  return {
    seconds: 30,
    frames: 1783,
    frameMs: spread(16.6, 24.4),
    fpsMedian: 60.2,
    fpsP95: 41,
    over20: 12,
    drawPeak: 38,
    rungPeak: 1,
    pixelRatio: 3,
    devicePixelRatio: 3,
    sim: spread(1.1, 2.4),
    render: spread(8.2, 14.1),
    physics: spread(0.9, 2),
    run: { level: 20, squadMin: 40, squadMax: 212 },
    text: 'the panel-sized block',
  };
}

/** Only the fields the report reads; the sim's state is far larger. */
function runState(over: Partial<RunState> = {}): Readonly<RunState> {
  const state = {
    levelIndex: 20,
    seed: 4242,
    status: 'won',
    time: 92.4,
    squad: { count: 148 },
    peakCount: 212,
    survivors: 148,
    ...over,
  };
  return state as unknown as RunState;
}

function full(): ReportInput {
  return {
    version: '0.1.0',
    build: 'native',
    platform: 'ios',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)',
    screen: { width: 390, height: 844, pixelRatio: 3 },
    gpu: { vendor: 'Apple Inc.', renderer: 'Apple GPU', version: 'WebGL 2.0' },
    quality: { rung: 0, reason: 'start 3x', pixelRatio: 3, devicePixelRatio: 3, physics: 2 },
    capture: capture(),
    run: runState(),
    save: {
      bestLevel: 21,
      coins: 4820,
      streakDays: 6,
      missionsDone: 2,
      missionsTotal: 3,
      tiers: 7,
    },
  };
}

describe('buildReport', () => {
  it('renders every section with the numbers it was given', () => {
    const report = buildReport(full());

    expect(report).toContain('arcane-rush 0.1.0 report');
    for (const heading of ['device', 'quality', 'capture', 'run', 'save']) {
      expect(report).toContain(`\n${heading}\n`);
    }

    // Device: what the phone is.
    expect(report).toContain('build      native');
    expect(report).toContain('platform   ios');
    expect(report).toContain('screen     390x844 css, dpr 3');
    expect(report).toContain('gpu        Apple GPU');
    expect(report).toContain('vendor     Apple Inc.');
    expect(report).toContain('gl         WebGL 2.0');
    expect(report).toContain('CPU iPhone OS 18_2');

    // Quality: the ladder's rung, what it renders at, what physics is on.
    expect(report).toContain('rung       0 (start 3x)');
    expect(report).toContain('pixels     3 of 3');
    expect(report).toContain('physics    2');

    // Capture: the frame rate twice, the hitch count, the draw peak, the split.
    expect(report).toContain('window     30.0s, 1783 frames');
    expect(report).toContain('fps        med 60 p95 41');
    expect(report).toContain('frame p95  24.4 ms (med 16.6)');
    expect(report).toContain('>20ms      12');
    expect(report).toContain('draws      peak 38, rung peak 1');
    expect(report).toContain('render     med 8.20 p95 14.10 ms');

    // Run: which road, how it ended, and what walked it.
    expect(report).toContain('road       level 20');
    expect(report).toContain('status     won, 92.4s');
    expect(report).toContain('squad      count 148, peak 212');
    expect(report).toContain('survivors  148');
    expect(report).toContain('seed       4242');

    // Save: the headline, and nothing that identifies anybody.
    expect(report).toContain('best       level 21');
    expect(report).toContain('coins      4820');
    expect(report).toContain('streak     6 days');
    expect(report).toContain('missions   2/3 done');
    expect(report).toContain('tiers      7 tints held');
  });

  it('reports an endless walk in metres rather than as a level', () => {
    const input = full();
    input.run = runState({ levelIndex: 0, endless: { metres: 1840.6 } } as Partial<RunState>);

    expect(buildReport(input)).toContain('road       endless 1841 m');
  });

  it('prints a dash for every part the device could not answer', () => {
    const report = buildReport({
      version: '',
      build: '',
      platform: '',
      userAgent: '',
      screen: null,
      gpu: null,
      quality: null,
      capture: null,
      run: null,
      save: null,
    });

    // Every heading is still there: "no capture was taken" has to be legible,
    // and an absent section reads as an older build instead.
    for (const heading of ['device', 'quality', 'capture', 'run', 'save']) {
      expect(report).toContain(`\n${heading}\n`);
    }
    expect(report).toContain('arcane-rush - report');
    expect(report).toContain('ua         -');
    expect(report).not.toContain('undefined');
    expect(report).not.toContain('NaN');
  });

  it('prints a dash rather than NaN for a number the browser fumbled', () => {
    const input = full();
    input.screen = { width: Number.NaN, height: 844, pixelRatio: Number.NaN };
    input.quality = {
      rung: 0,
      reason: 'start',
      pixelRatio: Number.NaN,
      devicePixelRatio: 2,
      physics: 2,
    };

    const report = buildReport(input);

    expect(report).not.toContain('NaN');
    expect(report).toContain('-x844');
  });
});

describe('readGl', () => {
  it('reads the unmasked strings off an engine that has them', () => {
    const engine = {
      getGlInfo: () => ({ vendor: 'Apple Inc.', renderer: 'Apple GPU', version: 'WebGL 2.0' }),
    };

    expect(readGl(engine)).toEqual({
      vendor: 'Apple Inc.',
      renderer: 'Apple GPU',
      version: 'WebGL 2.0',
    });
  });

  it('is null for no engine, a foreign engine, and a lost context', () => {
    expect(readGl(null)).toBeNull();
    expect(readGl(undefined)).toBeNull();
    expect(readGl({})).toBeNull();
    expect(readGl({ getGlInfo: 'not a function' })).toBeNull();
    expect(readGl({ getGlInfo: () => undefined })).toBeNull();
    expect(
      readGl({
        getGlInfo: () => {
          throw new Error('context lost');
        },
      }),
    ).toBeNull();
  });

  it('fills a string field the engine left out rather than printing undefined', () => {
    expect(readGl({ getGlInfo: () => ({ renderer: 'Mali-G72' }) })).toEqual({
      vendor: '',
      renderer: 'Mali-G72',
      version: '',
    });
  });
});

describe('collectReport', () => {
  it('works with no window, no engine, no capture and no run', () => {
    const report = collectReport(
      {
        platform: () => 'web',
        gl: () => null,
        quality: () => ({
          rung: 2,
          reason: 'p95 1.5x',
          pixelRatio: 1.5,
          devicePixelRatio: 3,
          physics: 2,
        }),
        save: () => ({
          bestLevel: 1,
          coins: 0,
          streakDays: 0,
          missionsDone: 0,
          missionsTotal: 3,
          tiers: 0,
        }),
      },
      null,
      null,
    );

    // Vitest's node environment has no `window` and no `navigator.userAgent`
    // worth printing, which is the same shape as a build that has not booted.
    expect(report).toContain(`arcane-rush ${APP_VERSION} report`);
    expect(report).toContain('rung       2 (p95 1.5x)');
    expect(report).toContain('pixels     1.50 of 3');
    expect(report).not.toContain('undefined');
  });

  it('says `native` inside the app whatever bundler made the build', () => {
    const deps = {
      platform: () => 'ios',
      gl: () => null,
      quality: () => ({
        rung: 0,
        reason: 'start 3x',
        pixelRatio: 3,
        devicePixelRatio: 3,
        physics: 2,
      }),
      save: () => ({
        bestLevel: 1,
        coins: 0,
        streakDays: 0,
        missionsDone: 0,
        missionsTotal: 3,
        tiers: 0,
      }),
    };

    expect(collectReport(deps, null, null)).toContain('build      native');
    expect(collectReport({ ...deps, platform: () => 'web' }, null, null)).toContain(
      `build      ${BUILD_KIND}`,
    );
  });

  /**
   * Every source is a getter into live state — the renderer's ratios read the
   * engine, the save's headline reads the purse — and the report is read at the
   * two worst moments there are: a boot that has not finished, and a phone that
   * has just lost its GPU context. A source that throws must cost its own
   * section a dash and nothing else, because this is the button a broken build
   * is reported *with*.
   */
  it('prints a dash for a source that throws, and keeps the rest', () => {
    const boom = (): never => {
      throw new Error('read before init()');
    };

    const report = collectReport(
      {
        platform: () => 'ios',
        gl: boom,
        quality: boom,
        save: boom,
      },
      null,
      null,
    );

    expect(report).toContain(`arcane-rush ${APP_VERSION} report`);
    // The section that could be read is still there...
    expect(report).toContain('platform   ios');
    expect(report).toContain('build      native');
    // ...and the three that could not are a dash apiece, not an exception.
    expect(report).toContain('gpu        -');
    // An empty section is its heading and one dash row (`pushSection`), so the
    // owner can tell "nothing to report" from "this build is older than the
    // section".
    expect(report).toContain(`\nquality\n${' '.repeat(13)}-`);
    expect(report).toContain(`\nsave\n${' '.repeat(13)}-`);
    expect(report).not.toContain('undefined');
  });
});
