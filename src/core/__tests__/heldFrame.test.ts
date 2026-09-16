/**
 * The frozen frame behind the pause menu (docs/27, section B).
 *
 * What is asserted is the four ways a redraw can go wrong: drawing when the
 * pause is already over (a second frame of the run, from outside the loop),
 * drawing into a context that is still gone, drawing only once after a restore
 * while the scene is still coming back — which leaves every mesh that is not
 * ready out of the only frame the player sees — and never stopping when the
 * scene never comes back.
 *
 * `requestAnimationFrame` is a slot the test fires by hand, as in
 * `./frame.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RunState, SimEvent } from '@/sim';

import { HeldFrame } from '../heldFrame';
import type { HeldFrameDeps } from '../heldFrame';
import type { RunSession } from '../session';

let pending: FrameRequestCallback | null = null;
let requests = 0;
let cancelled = 0;

/** Every draw: the delta it was handed and how many events came with it. */
let draws: { dt: number; events: number }[] = [];
let held = true;
let contextLost = false;
let warming = false;
let ready = true;
let clock = 0;
let session: RunSession | null = null;

const STATE = {} as RunState;

function heldFrame(): HeldFrame {
  const renderer = {
    update: (_state: RunState, events: readonly SimEvent[], dt: number): void => {
      draws.push({ dt, events: events.length });
    },
    get isContextLost(): boolean {
      return contextLost;
    },
    get shaderStats(): { warming: boolean } {
      return { warming };
    },
  } as unknown as HeldFrameDeps['renderer'];
  return new HeldFrame({
    renderer,
    sceneReady: () => ready,
    session: () => session,
    held: () => held,
  });
}

/** Runs the frame the redraw is waiting on, if any. */
function fire(): void {
  const callback = pending;
  pending = null;
  callback?.(0);
}

beforeEach(() => {
  pending = null;
  requests = 0;
  cancelled = 0;
  draws = [];
  held = true;
  contextLost = false;
  warming = false;
  ready = true;
  clock = 0;
  session = { state: STATE } as RunSession;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    pending = callback;
    requests++;
    return requests;
  });
  vi.stubGlobal('cancelAnimationFrame', (): void => {
    pending = null;
    cancelled++;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('HeldFrame', () => {
  it('draws the run as it stands, once, with nothing moving', () => {
    const frame = heldFrame();
    frame.request();
    frame.request();
    expect(requests).toBe(1);
    fire();
    expect(draws).toEqual([{ dt: 0, events: 0 }]);
    // Nothing more is asked for: the loop is stopped and so is this.
    expect(pending).toBeNull();
  });

  it('draws nothing once the pause is over', () => {
    const frame = heldFrame();
    frame.request();
    held = false;
    fire();
    expect(draws).toEqual([]);
  });

  it('draws nothing without a run', () => {
    const frame = heldFrame();
    session = null;
    frame.request();
    fire();
    expect(draws).toEqual([]);
  });

  it('waits for the restore rather than drawing into a lost context', () => {
    const frame = heldFrame();
    contextLost = true;
    frame.request();
    fire();
    expect(draws).toEqual([]);
    expect(pending).toBeNull();
  });

  it('keeps drawing while the materials warm up, and once after', () => {
    const frame = heldFrame();
    warming = true;
    frame.request();
    fire();
    fire();
    expect(draws).toHaveLength(2);
    warming = false;
    fire();
    expect(draws).toHaveLength(3);
    fire();
    expect(draws).toHaveLength(3);
  });

  /** The restore case, as measured: the warm-up is done long before the scene. */
  it('keeps drawing until the scene is ready, and once after', () => {
    const frame = heldFrame();
    ready = false;
    frame.request();
    fire();
    fire();
    fire();
    expect(draws).toHaveLength(3);
    ready = true;
    fire();
    expect(draws).toHaveLength(4);
    expect(pending).toBeNull();
  });

  it('gives up on a scene that never comes back', () => {
    const frame = heldFrame();
    ready = false;
    frame.request();
    fire();
    clock = 9_000;
    fire();
    expect(pending).not.toBeNull();
    clock = 10_001;
    fire();
    expect(draws).toHaveLength(3);
    expect(pending).toBeNull();
    // A later request, a resize say, starts a fresh window.
    frame.request();
    fire();
    expect(draws).toHaveLength(4);
    expect(pending).not.toBeNull();
  });

  it('drops a waiting redraw on dispose', () => {
    const frame = heldFrame();
    frame.request();
    frame.cancel();
    expect(cancelled).toBe(1);
    frame.cancel();
    expect(cancelled).toBe(1);
    // And can be asked again afterwards.
    frame.request();
    fire();
    expect(draws).toHaveLength(1);
  });
});
