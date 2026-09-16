/**
 * What a finger and a canvas resize do to a run.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md), on a
 * seam the file already had: `./input.ts` is the *gesture* — pointers, drags,
 * the pixels they cover — and this is what those pixels mean to the game. The
 * state machine keeps only the detach handle.
 */

import { balance } from '@/data';
import type { Renderer } from '@/render/Renderer';

import { attachInput } from './input';
import type { DetachInput } from './input';
import type { RunSession } from './session';

export interface AppInputDeps {
  canvas: HTMLCanvasElement;
  renderer: Renderer;
  /** The run on the road, or null on any screen that is not one. */
  session: () => RunSession | null;
  /** True only while a run is being played by a finger rather than a bot. */
  steerable: () => boolean;
  /**
   * The canvas's backing store changed size, which clears it, so whatever is
   * on it is stale (`./frame.ts`).
   */
  markDirty: () => void;
}

/** Everything the app has to take off again when it is disposed. */
export interface AppInput {
  detach: () => void;
}

export function attachAppInput(deps: AppInputDeps): AppInput {
  /**
   * Pixels to road metres: a full screen width of drag moves the squad
   * `balance.input.sensitivity` metres. Tuning stays in `src/data`.
   */
  const onDrag = (deltaXPixels: number): void => {
    const session = deps.session();
    if (session === null || !deps.steerable()) return;
    const width = deps.canvas.clientWidth || window.innerWidth || 1;
    const metres = (deltaXPixels / width) * balance.input.sensitivity;
    session.run.setTargetX(session.state.squad.targetX + metres);
  };

  // The renderer keeps the backing store the canvas's shape on its own, from
  // the moment its engine exists (`src/render/backingStore.ts`). It used to be
  // this file's window `resize` listener that asked it to — attached only once
  // the boot was over, which is how a web view resized during the boot left the
  // first device build drawing a square frame for a whole session
  // (docs/27-device-playtest-fixes.md). What is left here is the frame loop's
  // half: a resized canvas is a cleared one.
  deps.renderer.setResizeListener(deps.markDirty);
  // A scripted bot owns `targetX`; a stray drag must not fight it.
  const detachInput: DetachInput = attachInput(deps.canvas, onDrag, {
    enabled: deps.steerable,
  });

  return {
    detach: () => {
      detachInput();
      deps.renderer.setResizeListener(null);
    },
  };
}
