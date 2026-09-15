/**
 * What a finger and a window resize do to a run.
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
  /** The canvas changed size, so whatever is on it is stale (`./frame.ts`). */
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

  const onResize = (): void => {
    deps.renderer.resize();
    deps.markDirty();
  };

  window.addEventListener('resize', onResize);
  // A scripted bot owns `targetX`; a stray drag must not fight it.
  const detachInput: DetachInput = attachInput(deps.canvas, onDrag, {
    enabled: deps.steerable,
  });

  return {
    detach: () => {
      detachInput();
      window.removeEventListener('resize', onResize);
    },
  };
}
