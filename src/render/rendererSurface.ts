/**
 * What the scene is drawn *onto*: the canvas, its backing store and the pixel
 * ratio it is kept at, and the GPU context behind it, which iOS may take away.
 *
 * Split out of `./Renderer.ts` in the performance pass after the second device
 * playtest (docs/28, note 5), which had left that file at 580 lines. The seam
 * is the one the file already had: everything here is about the surface and
 * would be the same for any scene, and everything left there is about *this*
 * scene — its views, its level, its frame.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';

import { clearReadout } from './backingFit';
import type { CanvasReadout } from './backingFit';
import { BackingStore } from './backingStore';
import { watchContextLoss } from './contextLoss';
import { effectivePixelRatio } from './rendererQuality';

export interface SurfaceHooks {
  /**
   * The GPU took the context away, and gave it back (`./contextLoss.ts`): for
   * the owner of the frame loop, which has to stop *asking* for frames and
   * start again.
   */
  onContextLost?: (() => void) | undefined;
  onContextRestored?: (() => void) | undefined;
  /**
   * Babylon has rebuilt its side; what the scene has to redo itself before the
   * first frame back (`Renderer.restoreScene`).
   */
  restoreScene: () => void;
}

export class RendererSurface {
  private maxPixelRatio: number;
  /**
   * Keeps the backing store the canvas's shape (`./backingStore.ts`). Set the
   * moment the engine exists, well before the scene is built: the boot is
   * exactly the window it has to cover.
   */
  private backing: BackingStore | null = null;
  /** Told when the backing store changes size; see `setResizeListener`. */
  private resizeListener: (() => void) | null = null;
  /** True between `webglcontextlost` and the end of Babylon's rebuild. */
  private contextLost = false;
  /** Takes the two listeners and the observer off again; see `./contextLoss.ts`. */
  private unwatch: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    maxPixelRatio: number,
    private readonly hooks: SurfaceHooks,
  ) {
    this.maxPixelRatio = maxPixelRatio;
  }

  /** What the scene renders at: the screen's ratio under the ladder's cap. */
  get effectiveRatio(): number {
    return effectivePixelRatio(this.maxPixelRatio);
  }

  /**
   * True while the GPU context is gone. The frame loop is paused by the app in
   * that window, and the renderer draws nothing even if something asks.
   */
  get isContextLost(): boolean {
    return this.contextLost;
  }

  /** The engine exists: start keeping its backing store the canvas's shape. */
  attachEngine(engine: Engine): void {
    if (this.disposed) return;
    this.backing = new BackingStore(this.canvas, engine, {
      wantedRatio: () => effectivePixelRatio(this.maxPixelRatio),
      onResized: () => {
        this.resizeListener?.();
      },
    });
  }

  /**
   * The scene exists: watch the context. Before the warm-up rather than after
   * it — a context lost during the boot pass is exactly the case a phone under
   * memory pressure produces, and an unwatched loss there is a black screen
   * with no way back.
   */
  watchContext(engine: Engine): void {
    if (this.disposed) return;
    this.unwatch = watchContextLoss(this.canvas, engine, {
      onLost: () => {
        this.handleLost();
      },
      onRestored: () => {
        this.handleRestored();
      },
    });
  }

  /** The per-frame guard on the backing store's shape (`BackingStore.check`). */
  check(): void {
    this.backing?.check();
  }

  /**
   * Degrade ladder rung: the backing store is what a fill-rate-bound phone
   * feels first. `src/core/quality.ts` owns when this is called; the store
   * applies it at the screen's ratio under this cap and under whatever the
   * browser will allocate (`./backingStore.ts`).
   */
  setMaxPixelRatio(ratio: number): void {
    const clamped = Math.max(1, ratio);
    if (clamped === this.maxPixelRatio) return;
    this.maxPixelRatio = clamped;
    this.backing?.fit();
  }

  /**
   * Looks at the canvas again and fits the backing store to it. The store
   * already does this on its own for every change it can see; this is for a
   * caller that knows of one it cannot.
   */
  resize(): void {
    this.backing?.refit();
  }

  /**
   * Who to tell when the backing store changes size, which clears the canvas:
   * the frame loop, which may be holding a settled frame it would otherwise
   * never draw again. One listener; `null` takes it off.
   */
  setResizeListener(listener: (() => void) | null): void {
    this.resizeListener = listener;
  }

  /**
   * The canvas's CSS box, backing store and drawing buffer, and whether they
   * are one shape, written into `out`; zeroes before the engine exists. The
   * debug panel's per-frame copy, so nothing is allocated.
   */
  readCanvas(out: CanvasReadout): void {
    if (this.backing === null) clearReadout(out);
    else this.backing.readout(out);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unwatch?.();
    this.unwatch = null;
    this.backing?.dispose();
    this.backing = null;
    this.resizeListener = null;
  }

  /**
   * The GPU took the context away. Every frame from here is dropped, and the
   * app is told so it can stop asking for frames; the scene graph, the pools
   * and the run itself are untouched, because none of them is on the GPU.
   */
  private handleLost(): void {
    if (this.contextLost) return;
    this.contextLost = true;
    // Not `console.error`: a lost context is a normal thing for iOS to do, and
    // an error would fail the smoke test (`scripts/smoke-browser.mjs`).
    console.warn('[arcane-rush] WebGL context lost; frames are paused');
    this.hooks.onContextLost?.();
  }

  /**
   * Babylon has rebuilt its side (`./contextLoss.ts` lists what that covers).
   * The backing store's size is ours to redo — it is set through the engine
   * rather than the canvas, and the shell may have changed it while the
   * context was gone — and so is whatever the scene cannot restore itself.
   */
  private handleRestored(): void {
    if (!this.contextLost || this.disposed) return;
    this.contextLost = false;
    this.backing?.refit();
    this.hooks.restoreScene();
    this.hooks.onContextRestored?.();
  }
}
