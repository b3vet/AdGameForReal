/**
 * The backing store keeper (docs/27-device-playtest-fixes.md, section A),
 * driven with a fake canvas and a fake engine that does Babylon's resize
 * arithmetic and a browser's clamp.
 *
 * Vitest runs in Node, so there is no window: the store's listeners are not
 * attached and every change is found the way the per-frame guard finds one the
 * events missed. That is the path the first device build needed.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackingStore } from '../backingStore';
import type { CanvasReadout } from '../backingFit';

/** The owner's phone. */
const SCREEN_WIDTH = 440;
const SCREEN_HEIGHT = 956;
const DPR = 3;
/** Frames between the guard's looks at the box, as `backingStore.ts` has it. */
const LOOK_FRAMES = 60;

interface FakeCanvas {
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
}

/**
 * Just enough of `Engine` for the store: Babylon's `resize`/`setSize`
 * arithmetic, and a drawing buffer that is the canvas clamped per side, as
 * WebKit's `clampedCanvasSize` does it.
 */
class FakeEngine {
  level = 1 / DPR;
  bufferWidth = 0;
  bufferHeight = 0;
  lost = false;
  /** Canvas reallocations, which is what a refit costs. */
  allocations = 0;

  constructor(
    private readonly canvas: FakeCanvas,
    private readonly clampWidth = 16384,
    private readonly clampHeight = 16384,
    private readonly maxTexture = 16384,
  ) {
    this.resize();
  }

  getCaps(): { maxTextureSize: number; maxRenderTextureSize: number } {
    return { maxTextureSize: this.maxTexture, maxRenderTextureSize: this.maxTexture };
  }

  getHardwareScalingLevel(): number {
    return this.level;
  }

  setHardwareScalingLevel(level: number): void {
    this.level = level;
    this.resize();
  }

  /** Babylon falls back to the current size for a box that is not laid out. */
  resize(): void {
    const width = this.canvas.clientWidth || this.canvas.width * this.level;
    const height = this.canvas.clientHeight || this.canvas.height * this.level;
    this.setSize(width / this.level, height / this.level);
  }

  setSize(width: number, height: number): void {
    const w = width | 0;
    const h = height | 0;
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.allocations++;
    this.reallocate();
  }

  /** What the browser does to the buffer when the canvas's attributes change. */
  reallocate(): void {
    this.bufferWidth = Math.min(this.canvas.width, this.clampWidth);
    this.bufferHeight = Math.min(this.canvas.height, this.clampHeight);
  }

  getRenderWidth(_useScreen?: boolean): number {
    return this.lost ? 0 : this.bufferWidth;
  }

  getRenderHeight(_useScreen?: boolean): number {
    return this.lost ? 0 : this.bufferHeight;
  }
}

interface Harness {
  canvas: FakeCanvas;
  engine: FakeEngine;
  store: BackingStore;
  resized: () => number;
  wanted: { ratio: number };
  frames: (count: number) => void;
}

function harness(
  box: [number, number],
  clamp: [number, number] = [16384, 16384],
  maxTexture = 16384,
): Harness {
  const canvas: FakeCanvas = { clientWidth: box[0], clientHeight: box[1], width: 300, height: 150 };
  const engine = new FakeEngine(canvas, clamp[0], clamp[1], maxTexture);
  const wanted = { ratio: DPR };
  let resizes = 0;
  const store = new BackingStore(
    canvas as unknown as HTMLCanvasElement,
    engine as unknown as Engine,
    {
      wantedRatio: () => wanted.ratio,
      onResized: () => {
        resizes++;
      },
    },
  );
  return {
    canvas,
    engine,
    store,
    resized: () => resizes,
    wanted,
    frames: (count) => {
      for (let i = 0; i < count; i++) store.check();
    },
  };
}

function emptyReadout(): CanvasReadout {
  return {
    cssWidth: 0,
    cssHeight: 0,
    backingWidth: 0,
    backingHeight: 0,
    bufferWidth: 0,
    bufferHeight: 0,
    inShape: false,
  };
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('BackingStore', () => {
  it('starts in shape on a phone that booted at its real size', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    const out = emptyReadout();
    h.store.readout(out);

    expect(out).toEqual({
      cssWidth: 440,
      cssHeight: 956,
      backingWidth: 1320,
      backingHeight: 2868,
      bufferWidth: 1320,
      bufferHeight: 2868,
      inShape: true,
    });
  });

  /**
   * The first device build: the web view was square when the engine was made
   * and the screen's shape a moment later, and nothing told the engine. The
   * guard's next look finds it, with no event at all.
   */
  it('fixes a square boot that nothing announced, within a second of frames', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_WIDTH]);
    expect([h.canvas.width, h.canvas.height]).toEqual([1320, 1320]);

    h.canvas.clientHeight = SCREEN_HEIGHT;
    h.frames(LOOK_FRAMES);

    expect([h.canvas.width, h.canvas.height]).toEqual([1320, 2868]);
    expect([h.engine.bufferWidth, h.engine.bufferHeight]).toEqual([1320, 2868]);
    // A resized canvas is a cleared one: the frame loop has to be told.
    expect(h.resized()).toBe(1);
  });

  it('refits at once when an event says the box changed', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_WIDTH]);
    h.canvas.clientHeight = SCREEN_HEIGHT;
    h.store.refit();

    expect([h.canvas.width, h.canvas.height]).toEqual([1320, 2868]);
  });

  it('puts back a backing store someone else resized', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    h.engine.setSize(1320, 1320);
    h.store.check();

    expect([h.canvas.width, h.canvas.height]).toEqual([1320, 2868]);
  });

  it('follows the ladder when the wanted ratio moves', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    h.wanted.ratio = 2;
    h.store.check();

    expect([h.canvas.width, h.canvas.height]).toEqual([880, 1912]);
    expect(h.engine.level).toBe(0.5);
  });

  it('does nothing at all on a frame where nothing changed', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    const before = h.engine.allocations;
    h.frames(LOOK_FRAMES * 3);

    expect(h.engine.allocations).toBe(before);
    expect(h.resized()).toBe(0);
  });

  /**
   * A browser that will not allocate the height asked for clamps the height
   * alone. The store hears it in the buffer's size and brings the ratio down
   * until both sides fit, so the frame is softer and the right shape.
   */
  it('lowers the ratio rather than keeping a clamped buffer', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT], [16384, 2048]);
    const out = emptyReadout();
    h.store.readout(out);

    expect(out.inShape).toBe(true);
    expect(out.bufferHeight).toBeLessThanOrEqual(2048);
    expect(out.bufferWidth).toBe(out.backingWidth);
    expect(out.bufferHeight).toBe(out.backingHeight);
    expect(1 / h.engine.level).toBeLessThan(DPR);
    expect(warn).toHaveBeenCalledTimes(1);

    // And it stays settled: the limit is remembered, nothing refits per frame.
    const allocations = h.engine.allocations;
    h.frames(LOOK_FRAMES * 3);
    expect(h.engine.allocations).toBe(allocations);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('fits under the texture ceiling the context reports without having to learn it', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT], [2048, 2048], 2048);
    const out = emptyReadout();
    h.store.readout(out);

    expect(out.inShape).toBe(true);
    expect(out.backingHeight).toBeLessThanOrEqual(2048);
    // Nothing was clamped, so nothing had to be learned.
    expect(warn).not.toHaveBeenCalled();
  });

  it('goes back to the full ratio for a later box that fits under what it learned', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT], [16384, 2048]);
    h.canvas.clientWidth = SCREEN_HEIGHT;
    h.canvas.clientHeight = SCREEN_WIDTH;
    h.store.refit();

    // Landscape now: 956 wide fits 2048 at the full ratio, 440 tall likewise.
    expect([h.canvas.width, h.canvas.height]).toEqual([2868, 1320]);
    expect(h.engine.bufferWidth).toBe(2868);
  });

  it('does not learn a limit from a lost context, and refits once it is back', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    h.engine.lost = true;
    h.canvas.clientHeight = SCREEN_WIDTH;
    h.store.refit();
    expect(warn).not.toHaveBeenCalled();

    h.canvas.clientHeight = SCREEN_HEIGHT;
    h.engine.lost = false;
    h.frames(LOOK_FRAMES);

    expect([h.canvas.width, h.canvas.height]).toEqual([1320, 2868]);
    expect([h.engine.bufferWidth, h.engine.bufferHeight]).toEqual([1320, 2868]);
  });

  it('keeps the last real size while the canvas is not laid out', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    h.canvas.clientWidth = 0;
    h.canvas.clientHeight = 0;
    h.store.refit();
    h.frames(LOOK_FRAMES);

    expect([h.canvas.width, h.canvas.height]).toEqual([1320, 2868]);
  });

  it('can be disposed twice without a page to detach from', () => {
    const h = harness([SCREEN_WIDTH, SCREEN_HEIGHT]);
    h.store.dispose();
    h.store.dispose();
  });
});
