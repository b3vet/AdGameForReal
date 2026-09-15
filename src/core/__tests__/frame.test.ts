/**
 * The frame loop across a pause.
 *
 * The bug this exists to stop is invisible on a desktop and certain on a phone.
 * `requestAnimationFrame` stops firing while a page is backgrounded, so a run
 * interrupted by a phone call resumes on a frame whose timestamp is minutes
 * after the last one. If the loop hands that delta to anything, the player
 * comes back to a run that has already happened: the sim would step through a
 * gate row it never touched, and the result screen's beat — which rides the
 * *unclamped* `realDt` on purpose, so a slow rasteriser still counts a beat as
 * a beat — would skip the whole ending in one frame.
 *
 * So what is asserted is the two halves of "drop it, do not catch up": nothing
 * ticks while the app is away, and the first frame back reports no time at all.
 *
 * The loop is driven by hand. `requestAnimationFrame` is stubbed into a slot
 * holding the next callback, which is what lets a test say "now it is four
 * minutes later" without waiting, and which is also the only way to prove that
 * a paused loop asked for no frame at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GameAudio } from '@/audio';
import type { PhysicsLayer } from '@/physics';
import type { Renderer } from '@/render/Renderer';
import type { RunState, SimEvent } from '@/sim';
import type { Overlay } from '@/ui';

import { FrameDriver } from '../frame';
import type { FrameHost } from '../frame';
import type { Juice } from '../juice';
import type { RunSession } from '../session';

/** The callback the loop is waiting on, or null when it has asked for none. */
let pending: FrameRequestCallback | null = null;
let nextHandle = 1;
/** Handles passed to `cancelAnimationFrame`, so a stop can be proved. */
let cancelled: number[] = [];

/** Every `tick` the driver made, as its `dt`. */
let ticks: number[] = [];
/** Every `(frameDt, realDt)` pair `onFrameEnd` was handed. */
let frameEnds: { frameDt: number; realDt: number }[] = [];

const NO_EVENTS: SimEvent[] = [];

/**
 * Enough of a session for the loop: a `run.tick` that records its step and a
 * `state` nothing in the stubs below reads. The driver is the subject here, so
 * everything around it is the smallest thing that satisfies the type.
 */
function fakeSession(): RunSession {
  return {
    steer: (): void => undefined,
    state: {} as RunState,
    run: {
      tick: (dt: number): SimEvent[] => {
        ticks.push(dt);
        return NO_EVENTS;
      },
    },
    absorb: (): void => undefined,
  } as unknown as RunSession;
}

function fakeHost(session: RunSession): FrameHost {
  return {
    renderer: {
      update: (): void => undefined,
      absorbEvents: (): void => undefined,
      drainFallenUnits: (): void => undefined,
      drawCalls: 0,
      chargerBodies: 0,
    } as unknown as Renderer,
    overlay: { updateHud: (): void => undefined, debugEnabled: false } as unknown as Overlay,
    audio: { onEvents: (): void => undefined } as unknown as GameAudio,
    juice: {
      advance: (): void => undefined,
      apply: (): void => undefined,
      beginFrame: (): void => undefined,
      scan: (): void => undefined,
      scale: 1,
    } as unknown as Juice,
    turbo: 1,
    activeSession: (): RunSession | null => session,
    previewSession: (): RunSession | null => null,
    physics: (): PhysicsLayer | null => null,
    phaseName: (): string => 'playing',
    onFrameEnd: (frameDt: number, realDt: number): void => {
      frameEnds.push({ frameDt, realDt });
    },
  };
}

/** Runs the frame the loop is waiting on, at `time` milliseconds. */
function step(time: number): void {
  const frame = pending;
  if (frame === null) throw new Error('no frame was requested');
  pending = null;
  frame(time);
}

beforeEach(() => {
  pending = null;
  nextHandle = 1;
  cancelled = [];
  ticks = [];
  frameEnds = [];

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    pending = callback;
    return nextHandle++;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
    cancelled.push(handle);
    pending = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FrameDriver across a pause', () => {
  it('drops the time spent in the background instead of catching up', () => {
    const driver = new FrameDriver(fakeHost(fakeSession()));
    driver.start();

    // Two ordinary frames at 60 Hz. The first reports nothing, because there is
    // no previous timestamp to subtract.
    step(1000);
    step(1016.67);
    expect(ticks).toEqual([0, expect.closeTo(0.01667, 5)]);

    driver.pause();
    expect(driver.isSuspended).toBe(true);
    // The loop asked for no further frame, so there is nothing left to run.
    expect(cancelled).toHaveLength(1);
    expect(pending).toBeNull();

    const ticksAtPause = ticks.length;
    const endsAtPause = frameEnds.length;

    // Four minutes of phone call. Nothing can happen: a backgrounded page gets
    // no callbacks, and this loop has not asked for one either.
    driver.resume();
    expect(driver.isSuspended).toBe(false);
    expect(ticks).toHaveLength(ticksAtPause);
    expect(frameEnds).toHaveLength(endsAtPause);

    // The first frame back, four minutes later on the wall clock.
    step(241_016.67);
    expect(ticks).toHaveLength(ticksAtPause + 1);
    // Zero, not 240 seconds and not the 0.05 s clamp: the elapsed time is
    // dropped, not spread over the frames to come.
    expect(ticks.at(-1)).toBe(0);
    const back = frameEnds.at(-1);
    expect(back).toEqual({ frameDt: 0, realDt: 0 });

    // And the frame after it is an ordinary one again.
    step(241_033.34);
    expect(ticks.at(-1)).toBeCloseTo(0.01667, 5);
  });

  /**
   * `pause` and `stop` have different owners — the phone, and the smoke test
   * holding a frame still while it photographs it — so neither may undo the
   * other. A run that ends or a level that loads while the app is away calls
   * `start`, and the loop must stay down until the app is back.
   */
  it('refuses to start while the app is away, and comes back when it returns', () => {
    const driver = new FrameDriver(fakeHost(fakeSession()));
    driver.start();
    step(1000);

    driver.pause();
    driver.start();
    expect(pending).toBeNull();

    driver.resume();
    expect(pending).not.toBeNull();
  });

  /** A page backgrounded while the loop was already stopped comes back stopped. */
  it('does not start a loop the pause did not interrupt', () => {
    const driver = new FrameDriver(fakeHost(fakeSession()));
    driver.start();
    step(1000);
    driver.stop();

    driver.pause();
    driver.resume();
    expect(pending).toBeNull();
  });

  /** Both are idempotent: iOS delivers the same transition more than once. */
  it('takes a second pause and a second resume', () => {
    const driver = new FrameDriver(fakeHost(fakeSession()));
    driver.start();
    step(1000);

    driver.pause();
    driver.pause();
    expect(cancelled).toHaveLength(1);

    driver.resume();
    driver.resume();
    expect(pending).not.toBeNull();
    // One loop, not two: a second `resume` that started another would double
    // every tick from here on.
    step(2000);
    expect(ticks).toHaveLength(2);
  });
});
