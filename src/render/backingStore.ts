/**
 * Keeps the canvas's backing store the shape of the canvas, whatever the shell
 * does to the page (docs/27-device-playtest-fixes.md, section A).
 *
 * ## The fault this exists for
 *
 * Babylon sizes the backing store from the canvas's CSS box when it is created
 * and whenever `engine.resize()` is called, and at no other time; it listens to
 * nothing. Until this file, the only caller was a window `resize` listener that
 * the app attaches once the renderer has finished booting — after the fonts,
 * the models and the shader warm-up, which on a phone is seconds.
 *
 * The first run in the iOS app had a 440×956 canvas over a 1320×1320 buffer.
 * The simulator (iOS 26.3) never produced it; the owner's phone runs iOS 27.0.
 * What the simulator did show is the mechanism: a web view whose frame is
 * square when the engine is created and becomes the screen's shape a second
 * later fires its `resize` while nobody is listening yet, and the square buffer
 * is kept for the whole session — road a strip, wizards tall blobs, exactly the
 * owner's screenshot, down to its vertical blur. Whatever the new OS does
 * to the frame at launch, a size change the page was never told about, or was
 * told about too early, must not be able to leave the scene the wrong shape.
 *
 * ## What keeps it right
 *
 *   - It starts watching the moment the engine exists (`./rendererBoot.ts`),
 *     not when the app is ready.
 *   - A `ResizeObserver` on the canvas itself, which fires for any change to
 *     the box — a web view frame, a safe-area or viewport-unit change, a
 *     rotation — whether or not the window fired anything.
 *   - The window's `resize` (the screen's own ratio can change without the box
 *     changing, on a desktop zoom) and a return to the foreground.
 *   - A per-frame guard (`check`), which compares plain numbers and reads no
 *     layout, plus one fresh look at the box a second. The look is a
 *     `clientWidth` read, which forces a layout if the HUD has written text
 *     this frame; once a second, over a page this small, is a fraction of a
 *     millisecond, and it is the net under every event above for a shell that
 *     changes the web view and tells nobody.
 *   - Where the browser hands back a smaller drawing buffer than it was asked
 *     for, the ratio comes down until both sides fit (`./backingFit.ts`), so a
 *     clamp costs sharpness instead of shape.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';

import { fittedPixelRatio, learnedLimit, readoutInShape } from './backingFit';
import type { CanvasReadout } from './backingFit';
import { applyPixelRatio } from './rendererQuality';

/**
 * Frames between fresh looks at the canvas's box: a second at 60 fps, half of
 * one on a 120 Hz phone. See the file note for what one look costs.
 */
const LOOK_EVERY_FRAMES = 60;

export interface BackingStoreOptions {
  /**
   * The ratio the screen and the degrade ladder allow right now. The store may
   * render under it, when the browser insists, and never over it.
   */
  wantedRatio: () => number;
  /**
   * The backing store changed size. Resizing a canvas clears it, so whatever
   * the frame loop was holding on screen is gone and has to be drawn again.
   */
  onResized: () => void;
}

export class BackingStore {
  private readonly canvas: HTMLCanvasElement;
  private readonly engine: Engine;
  private readonly options: BackingStoreOptions;

  /** The box as last looked at, in CSS pixels. */
  private cssWidth = 0;
  private cssHeight = 0;

  /**
   * The largest buffer this browser will give, per side. Starts at what the
   * context says it supports and comes down if an allocation says otherwise; a
   * device's ceiling does not go back up, so it is never raised again.
   */
  private limitWidth = Number.POSITIVE_INFINITY;
  private limitHeight = Number.POSITIVE_INFINITY;

  /** What the last `fit` saw and left behind; `check` compares against these. */
  private settledCssWidth = -1;
  private settledCssHeight = -1;
  private settledWanted = -1;
  private settledBackingWidth = -1;
  private settledBackingHeight = -1;
  private settledBufferWidth = -1;
  private settledBufferHeight = -1;

  private framesSinceLook = 0;
  private observer: ResizeObserver | null = null;
  private attached = false;

  /** Bound once: the listeners are added in the constructor and taken off in
   *  `dispose`, so they have to be the same function objects both times. */
  private readonly refitNow = (): void => {
    this.refit();
  };
  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') this.refit();
  };

  constructor(canvas: HTMLCanvasElement, engine: Engine, options: BackingStoreOptions) {
    this.canvas = canvas;
    this.engine = engine;
    this.options = options;

    // `MAX_TEXTURE_SIZE` and `MAX_RENDERBUFFER_SIZE` are the ceilings WebKit
    // clamps a drawing buffer to, side by side; knowing them up front saves the
    // one wasted allocation it would take to discover them.
    const caps = engine.getCaps();
    const ceiling = Math.min(caps.maxTextureSize || Infinity, caps.maxRenderTextureSize || Infinity);
    this.limitWidth = ceiling;
    this.limitHeight = ceiling;

    this.attach();
    this.refit();
  }

  /** Looks at the box afresh and fits the backing store to it. */
  refit(): void {
    this.look();
    this.fit();
  }

  /**
   * Sizes the backing store to the box at the highest ratio that fits, and
   * tells the owner if that changed its size.
   */
  fit(): void {
    const canvas = this.canvas;
    const engine = this.engine;
    if (this.cssWidth <= 0 || this.cssHeight <= 0) return;
    const beforeWidth = canvas.width;
    const beforeHeight = canvas.height;
    const wanted = this.options.wantedRatio();

    // Babylon's own resize first: it reads the box itself, and folds any change
    // in the screen's ratio into its scaling level (`adaptToDeviceRatio`), which
    // the ratio below then overrides. It does nothing if the size is unchanged.
    engine.resize();
    applyPixelRatio(engine, this.fittedRatio(wanted));

    // What the browser actually allocated. Smaller than asked is a clamp: learn
    // the ceiling and come down to a ratio under it, both sides together.
    const bufferWidth = engine.getRenderWidth(true);
    const bufferHeight = engine.getRenderHeight(true);
    if (bufferWidth > 0 && bufferHeight > 0) {
      const limitWidth = learnedLimit(canvas.width, bufferWidth, this.limitWidth);
      const limitHeight = learnedLimit(canvas.height, bufferHeight, this.limitHeight);
      if (limitWidth !== this.limitWidth || limitHeight !== this.limitHeight) {
        // A warning, not an error: it is a fact about the device, and the smoke
        // treats any console error as a failure.
        console.warn(
          `[arcane-rush] drawing buffer clamped to ${String(bufferWidth)}x${String(bufferHeight)}` +
            ` for a ${String(canvas.width)}x${String(canvas.height)} canvas; lowering the pixel ratio`,
        );
        this.limitWidth = limitWidth;
        this.limitHeight = limitHeight;
        applyPixelRatio(engine, this.fittedRatio(wanted));
      }
    }

    this.settledCssWidth = this.cssWidth;
    this.settledCssHeight = this.cssHeight;
    this.settledWanted = wanted;
    this.settledBackingWidth = canvas.width;
    this.settledBackingHeight = canvas.height;
    this.settledBufferWidth = engine.getRenderWidth(true);
    this.settledBufferHeight = engine.getRenderHeight(true);

    if (canvas.width !== beforeWidth || canvas.height !== beforeHeight) this.options.onResized();
  }

  /**
   * The per-frame guard. Refits when the box, the wanted ratio, the backing
   * store or the drawing buffer is no longer what the last fit left — whoever
   * changed it. Everything compared here is a number already in hand or a
   * getter that reads no layout; the one layout read is the look every
   * `LOOK_EVERY_FRAMES`.
   *
   * A fit that could not do better (a buffer clamped even at the lowest ratio)
   * is recorded as settled like any other, so an unfixable state costs one fit,
   * not one a frame.
   */
  check(): void {
    if (++this.framesSinceLook >= LOOK_EVERY_FRAMES) this.look();
    const engine = this.engine;
    const canvas = this.canvas;
    if (
      this.cssWidth !== this.settledCssWidth ||
      this.cssHeight !== this.settledCssHeight ||
      this.options.wantedRatio() !== this.settledWanted ||
      canvas.width !== this.settledBackingWidth ||
      canvas.height !== this.settledBackingHeight ||
      engine.getRenderWidth(true) !== this.settledBufferWidth ||
      engine.getRenderHeight(true) !== this.settledBufferHeight
    ) {
      this.fit();
    }
  }

  /**
   * The three sizes and the verdict, written into `out` so the debug panel's
   * per-frame copy allocates nothing. The box is the last look rather than a
   * fresh read, for the reason in the file note; it is at most a second old.
   */
  readout(out: CanvasReadout): void {
    out.cssWidth = this.cssWidth;
    out.cssHeight = this.cssHeight;
    out.backingWidth = this.canvas.width;
    out.backingHeight = this.canvas.height;
    out.bufferWidth = this.engine.getRenderWidth(true);
    out.bufferHeight = this.engine.getRenderHeight(true);
    out.inShape = readoutInShape(out);
  }

  dispose(): void {
    if (!this.attached) return;
    this.attached = false;
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('resize', this.refitNow);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * The box, as layout has it. A zero is a canvas that is not laid out (a
   * hidden page on some engines); the last real size is kept rather than
   * fitting a buffer to nothing.
   */
  private look(): void {
    this.framesSinceLook = 0;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width > 0 && height > 0) {
      this.cssWidth = width;
      this.cssHeight = height;
    }
  }

  private fittedRatio(wanted: number): number {
    return fittedPixelRatio(this.cssWidth, this.cssHeight, wanted, this.limitWidth, this.limitHeight);
  }

  /**
   * The listeners, where there is a page to listen to; the unit tests drive
   * `fit` and `check` by hand in Node, where there is not.
   */
  private attach(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    this.attached = true;
    // The observer's own callback runs after layout, so the `clientWidth` read
    // inside `refit` costs nothing there.
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.refitNow);
      this.observer.observe(this.canvas);
    }
    window.addEventListener('resize', this.refitNow);
    document.addEventListener('visibilitychange', this.onVisibility);
  }
}
