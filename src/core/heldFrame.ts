/**
 * The frozen frame behind the pause menu (docs/27, section B).
 *
 * A paused run stops the frame loop outright (`./appLifecycle.ts`), which is
 * what keeps a phone that has been left on the menu cool: nothing is asked for
 * a hundred and twenty times a second to draw a picture that has not changed.
 * The picture stays on the glass without it. A canvas made with
 * `preserveDrawingBuffer: false` only clears the buffer it is drawn *into*; the
 * compositor keeps showing the last frame it was handed until it is handed
 * another, which is the same thing the Academy's backdrop has relied on since
 * it learned to draw once and hold (`FrameDriver.markPreviewDirty`).
 *
 * Three things do take that picture away, and each of them asks for it again
 * through here:
 *
 *   - a resize, because setting a canvas's size clears it;
 *   - a restored GPU context, which starts from an empty buffer;
 *   - a return from the background, where a web view may have thrown away what
 *     it was showing even when the context survived.
 *
 * The frame is the run's own state drawn at a delta of nothing and with no
 * events, so nothing moves and nothing starts: it is the frame the player
 * paused on, drawn again.
 *
 * One draw is enough when the scene is ready, and after a restore it is not.
 * Babylon rebuilds its programs over the frames that follow and leaves out of
 * each frame every mesh whose program is not back yet — measured under
 * SwiftShader, the roadside and the crowd were missing from every frame for
 * four seconds and came back on exactly the frame `Scene.isReady` turned true,
 * long after the renderer's own warm-up pass had reported done. So a redraw
 * keeps drawing, one frame at a time, until the scene says it is ready (and
 * once more, for the frame that turned it), and gives up after
 * `SETTLE_LIMIT_MS` rather than keep a phone drawing behind a menu for a mesh
 * that will never be ready.
 */

import type { Renderer } from '@/render/Renderer';

import { NO_EVENTS } from './frame';
import type { RunSession } from './session';

/**
 * The longest a redraw keeps drawing while the scene is still coming back.
 * Four seconds was the software rasteriser's figure; a phone's GPU rebuilds in
 * a fraction of that, and a frame that is still missing a mesh after this is
 * one the next Resume will finish anyway.
 */
const SETTLE_LIMIT_MS = 10_000;

/** Wall clock, for the limit above only. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

export interface HeldFrameDeps {
  renderer: Pick<Renderer, 'update' | 'isContextLost' | 'shaderStats'>;
  /** Whether every mesh in the scene can be drawn (`Scene.isReady`). */
  sceneReady: () => boolean;
  /** The run on the road, or null. */
  session: () => RunSession | null;
  /** Whether a frame is still being held. A request that outlived the pause draws nothing. */
  held: () => boolean;
}

export class HeldFrame {
  private readonly deps: HeldFrameDeps;
  private rafId: number | null = null;
  /** When the current burst of redraws stops waiting for the scene. */
  private settleBy = 0;

  constructor(deps: HeldFrameDeps) {
    this.deps = deps;
  }

  /**
   * Draws the held frame on the next animation frame, and on the ones after it
   * while the scene is still coming back. Requests made before it lands are one
   * draw, not several.
   */
  request(): void {
    this.settleBy = now() + SETTLE_LIMIT_MS;
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.draw);
  }

  /** `App.dispose`. */
  cancel(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** A field, not a closure made per request (CLAUDE.md, no per-frame allocations). */
  private readonly draw = (): void => {
    this.rafId = null;
    const deps = this.deps;
    const session = deps.session();
    // The pause is over and the loop is drawing again; or there is no run to
    // draw. Either way this frame is not ours.
    if (session === null || !deps.held()) return;
    // A context that is still gone draws nothing (`Renderer.update`); its
    // restore will ask again.
    const renderer = deps.renderer;
    if (renderer.isContextLost) return;
    // Read before the draw, so the frame that finds the scene ready is drawn
    // too: it is the first one with everything in it.
    const settling = renderer.shaderStats.warming || !deps.sceneReady();
    renderer.update(session.state, NO_EVENTS, 0);
    if (settling && now() < this.settleBy) {
      this.rafId = requestAnimationFrame(this.draw);
    }
  };
}
