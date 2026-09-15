/**
 * WebGL context loss and restore (`docs/25-milestone-9-plan.md`, section B).
 *
 * iOS takes the GPU context away from a backgrounded WKWebView under memory
 * pressure, and gives it back when the app comes forward. It is not an error
 * and it is not rare: on a phone with a browser and a map open behind the game
 * it is what a two-minute phone call looks like. What the player must not see
 * is a black rectangle where the road was, and what they must not lose is the
 * run.
 *
 * ## What Babylon already does, and what is left
 *
 * The engine registers its own `webglcontextlost` and `webglcontextrestored`
 * handlers when it is created (`ThinEngine._initGLContext`,
 * `AbstractEngine._restoreEngineAfterContextLost`) and rebuilds most of it
 * itself, one deferred task after the browser hands the context back: effects,
 * uniform buffers, geometries, vertex and index buffers, and every texture in
 * the scene. A `DynamicTexture._rebuild` is `update()`, and the 2D canvas
 * behind it is untouched by a lost context, so the glyph atlas, the cloud sheet
 * and the painted stone come back exactly as they were drawn.
 *
 * What it does *not* do is four things this game needs:
 *
 *   1. stop asking for frames in between. A `scene.render` against a dead
 *      context is a frame of nothing at best;
 *   2. put back a thin-instance matrix buffer that was written once. See
 *      `reuploadThinInstances` below — that is the one that was *measured*, and
 *      it is most of the scenery;
 *   3. re-arm anything the app had settled. The title backdrop is drawn once
 *      and then held (`FrameDriver.markPreviewDirty`), so a restore on the
 *      Academy would leave a screen that is never redrawn again;
 *   4. warm the materials back up. Babylon recompiles them lazily, which means
 *      the first frames after a restore pay for shader compilation — the exact
 *      stall `./warmup.ts` exists to keep out of a run.
 *
 * So this module is the sequencing plus the one rebuild: tell the owner the
 * context is gone, and tell it again once Babylon has finished putting it back.
 * The owner is `./Renderer.ts`, and through it `src/core/App.ts`, which pauses
 * and resumes the frame loop without touching the session — the sim state is
 * plain numbers in `src/sim` and never noticed.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side-effect import: this is what puts `thinInstance*` on `Mesh.prototype`
// (`./instanceBuffer.ts` says the same).
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

/**
 * Re-uploads every thin-instance matrix buffer in the scene. Answers how many
 * meshes it touched, for the log.
 *
 * ## Why this is needed, exactly
 *
 * Babylon keeps a CPU copy of a buffer's contents so it can recreate it after a
 * context loss (`Buffer._rebuild`) — but only for as long as it still has one.
 * `Buffer.updateDirectly(data, offset, vertexCount)` throws that copy away
 * whenever `vertexCount` is given:
 *
 *     if (offset === 0 && vertexCount === undefined) this._data = data;
 *     else this._data = null;
 *
 * and `thinInstanceBufferUpdated('matrix')` always passes a count. So the first
 * `commitInstances` a mesh ever does (`./instanceBuffer.ts`) leaves its matrix
 * buffer with nothing behind it, and `_rebuild` falls into its own second
 * branch — "we can at least recreate the buffer with the right size, even if we
 * don't have the data": an empty buffer of the right length, full of zeroes.
 *
 * A pool that writes its matrices every frame never notices, because the next
 * frame uploads them again. Everything written *once* does. Measured on a
 * level-1 frame with `WEBGL_lose_context`: the whole roadside — every tree,
 * gravestone, lantern and fence post — came back as specks at the world origin,
 * while the crowd, the projectiles and the labels were untouched.
 *
 * The fix is one call per mesh, because the array Babylon lost is the one *we*
 * still hold: `matrixData` is the `Float32Array` `createMatrixBuffer` handed
 * over, and asking for an update pushes it back to the GPU. It runs once per
 * restore over a few dozen meshes, which is nothing beside the frame after it.
 *
 * ## Why `matrix` is the whole list
 *
 * Nothing here is hand-kept: it walks `scene.meshes`, so a pool added tomorrow
 * is covered the day it is added. What it re-uploads is the `matrix` buffer and
 * nothing else, and that is complete because of an invariant the pools already
 * keep — every pool with a *custom* thin-instance buffer (`spriteRect`,
 * `glyphTint`, `quadScroll`, `decalInner`,
 * `bakedVertexAnimationSettingsInstanced`) rebuilds and re-uploads it on every
 * frame it draws, so a lost one is back before anyone sees it. Only the
 * matrices of the pools written *once*, at a level load, have nobody to put
 * them back. A future pool that writes a custom buffer once and then leaves it
 * would break that invariant, and would have to be re-uploaded here — Babylon
 * offers no way to enumerate a mesh's user buffers, so it would be a call
 * beside this one rather than a loop.
 */
export function reuploadThinInstances(scene: Scene): number {
  let touched = 0;
  for (const mesh of scene.meshes) {
    // Thin instances only exist on `Mesh`; an `InstancedMesh` has no such
    // buffer of its own.
    if (!(mesh instanceof Mesh) || mesh.thinInstanceCount <= 0) continue;
    mesh.thinInstanceBufferUpdated('matrix');
    touched++;
  }
  return touched;
}

export interface ContextLossHandlers {
  /** The context is gone. Stop drawing. */
  onLost: () => void;
  /** Babylon has finished rebuilding. Draw again. */
  onRestored: () => void;
}

/**
 * Watches `canvas` for a lost context and `engine` for the end of the restore.
 * Answers the function that takes both off again.
 *
 * The two halves come from two places on purpose. Loss is a DOM event and has
 * to be answered *synchronously* with `preventDefault`, or the browser never
 * offers a restore at all — Babylon's own handler does this too, and calling it
 * twice is harmless, but this build must not depend on an internal handler
 * staying registered. Restore is the opposite: the `webglcontextrestored` event
 * fires before Babylon has rebuilt a single buffer (it defers the whole rebuild
 * by a task), so a redraw from the DOM listener would be a frame drawn against
 * half a scene. `onContextRestoredObservable` is fired at the *end* of that
 * rebuild, which is the moment the renderer can be handed back.
 */
export function watchContextLoss(
  canvas: HTMLCanvasElement,
  engine: Engine,
  handlers: ContextLossHandlers,
): () => void {
  const listeners = new AbortController();

  canvas.addEventListener(
    'webglcontextlost',
    (event: Event) => {
      // Without this the loss is final: the browser only sends
      // `webglcontextrestored` for a loss whose default was prevented.
      event.preventDefault();
      handlers.onLost();
    },
    { signal: listeners.signal },
  );

  // Not where the redraw happens — see above — but the app is owed the news as
  // early as the browser has it, and a build whose engine was created with
  // `doNotHandleContextLost` would get nothing else.
  canvas.addEventListener(
    'webglcontextrestored',
    () => {
      console.warn('[arcane-rush] WebGL context restored; rebuilding the scene');
    },
    { signal: listeners.signal },
  );

  const observer = engine.onContextRestoredObservable.add(() => {
    handlers.onRestored();
  });

  return (): void => {
    listeners.abort();
    engine.onContextRestoredObservable.remove(observer);
  };
}
