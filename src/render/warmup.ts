/**
 * Shader warm-up: compile every material in the scene before the player can
 * see a frame that needs one.
 *
 * Why this exists (docs/10-milestone-3-log.md, the iPhone 17 Pro Max baseline):
 * the phone's median frame was 59 fps but its minimum was 23, and the ladder
 * walked down to pixel ratio 1.0 chasing those spikes. A spike is what a
 * first-use shader compile looks like from the frame loop — the first frost
 * bolt, the first ragdoll, the first gate of a kind the level had not shown
 * yet — and the compile lands in the middle of `scene.render`, where it stalls
 * the frame and never shows up in a draw-call count.
 *
 * The pass walks `scene.meshes` rather than asking each view for its meshes:
 * the physics debris, the roadside props and the sky belong to three different
 * owners, and a list that has to be kept in step with them is a list that will
 * fall out of step. Everything drawn is a mesh in the scene, so the scene is
 * the list.
 *
 * The one subtlety is thin instances. `THIN_INSTANCES` — and with it the
 * `world * instanceMatrix` in the vertex shader — is switched on by
 * `mesh.hasThinInstances`, which is `instancesCount > 0`. A pooled mesh sitting
 * empty at boot would therefore compile the *non*-instanced variant and compile
 * the real one again on the first bolt. So an empty pool is given one instance
 * for the duration of the compile. Its matrix is whatever zeros the buffer was
 * allocated with, which is a degenerate quad that rasterises nothing, and the
 * mesh stays disabled throughout.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Scene } from '@babylonjs/core/scene';
// Side-effect import: `thinInstanceCount` is added to `Mesh.prototype` here.
import '@babylonjs/core/Meshes/thinInstanceMesh';

/**
 * How long one material may take to become ready before the pass gives up on
 * it. `forceCompilationAsync` polls until `isReadyForSubMesh` says yes, and a
 * material that never can — a texture that failed to load, say — would
 * otherwise hold the boot open for ever.
 */
const COMPILE_TIMEOUT_MS = 5000;

export interface WarmUpResult {
  /** Materials that reported ready. */
  compiled: number;
  /**
   * Meshes with nothing to compile — no material, or no submesh to compile it
   * against. The merged source meshes a character asset leaves behind and the
   * physics layer's invisible anchors are both in here; none of them is ever
   * drawn, so none of them is a stall.
   */
  skipped: number;
  /** Materials that never became ready. Each one is a stall waiting to happen. */
  failed: number;
}

type Outcome = 'compiled' | 'skipped' | 'failed';

/**
 * Compiles every material in `scene`, concurrently, and answers how it went.
 *
 * Safe to call more than once: a material that is already ready resolves on the
 * pass's first check, so a second call after another layer has added its meshes
 * costs a tick and nothing else.
 */
export async function warmUpScene(scene: Scene): Promise<WarmUpResult> {
  const jobs: Promise<Outcome>[] = [];
  // An index loop over a snapshot length: a mesh added while the pass is in
  // flight belongs to the next call, not this one.
  const meshes = scene.meshes;
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (mesh === undefined) continue;
    jobs.push(compileMesh(mesh));
  }

  const results = await Promise.all(jobs);
  let compiled = 0;
  let skipped = 0;
  for (const outcome of results) {
    if (outcome === 'compiled') compiled++;
    else if (outcome === 'skipped') skipped++;
  }
  return { compiled, skipped, failed: results.length - compiled - skipped };
}

async function compileMesh(mesh: AbstractMesh): Promise<Outcome> {
  const material = mesh.material;
  if (material === null) return 'skipped';
  const subMeshes = mesh.subMeshes;
  if (subMeshes === null || subMeshes.length === 0) return 'skipped';

  // A pooled mesh is one with a thin-instance buffer, nothing in it, and
  // nobody drawing it. On a mesh with no such buffer the assignment is silently
  // refused, which is exactly the answer we want: it compiles the plain
  // variant. The disabled check is what keeps the pass off a mesh a view is
  // using right now — a later pass catches those, and this one must not touch
  // an instance count another owner is writing.
  const pooled = mesh instanceof Mesh && mesh.thinInstanceCount === 0 && !mesh.isEnabled();
  if (pooled) mesh.thinInstanceCount = 1;
  const instanced = mesh instanceof Mesh && mesh.thinInstanceCount > 0;

  try {
    await withTimeout(material.forceCompilationAsync(mesh, { useInstances: instanced }));
    return 'compiled';
  } catch {
    return 'failed';
  } finally {
    // Only if nothing claimed the pool while we waited. A later pass runs with
    // frames in flight, and a mesh a view has just enabled with one instance
    // must keep it: taking that back to zero on an *enabled* mesh is the
    // Milestone 2 bug where an empty thin-instance mesh falls off the instanced
    // path and draws one full-size copy at the world origin.
    if (pooled && mesh instanceof Mesh && mesh.thinInstanceCount === 1 && !mesh.isEnabled()) {
      mesh.thinInstanceCount = 0;
    }
  }
}

function withTimeout(promise: Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('material never became ready'));
    }, COMPILE_TIMEOUT_MS);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * What the pass has done and what the engine has compiled, for the debug panel
 * and the smoke.
 */
export interface ShaderStats {
  programs: number;
  warmed: number;
  skipped: number;
  failed: number;
  warming: boolean;
}

/**
 * The pass's own bookkeeping, kept here rather than in `Renderer` so the
 * renderer is about the frame. `run` may be called any number of times — at
 * boot, when the physics pools arrive, at every level start — and the counters
 * always describe the last pass.
 */
export class WarmUpTracker {
  private compiled = 0;
  private skipped = 0;
  private failed = 0;
  private inFlight = false;

  async run(scene: Scene): Promise<void> {
    this.inFlight = true;
    try {
      const result = await warmUpScene(scene);
      this.compiled = result.compiled;
      this.skipped = result.skipped;
      this.failed = result.failed;
    } finally {
      this.inFlight = false;
    }
  }

  stats(engine: Engine | null): ShaderStats {
    return {
      programs: compiledProgramCount(engine),
      warmed: this.compiled,
      skipped: this.skipped,
      failed: this.failed,
      warming: this.inFlight,
    };
  }
}

/**
 * How many distinct shader programs the engine has built.
 *
 * Babylon keeps them in a private cache keyed by define string and exposes no
 * counter for it (`SceneInstrumentation` counts draw calls, `EngineInstrumentation`
 * counts compilation *time*), so this reads that cache defensively and answers
 * 0 rather than throwing if a future version moves it. `programs` going up
 * during play is the signal that something compiled inside a frame, which is
 * what this pass exists to prevent, and the smoke asserts it does not move
 * across a whole level. It is a diagnostic, never read inside a frame.
 */
function compiledProgramCount(engine: Engine | null): number {
  if (engine === null) return 0;
  const cache = (engine as unknown as { _compiledEffects?: Record<string, unknown> })
    ._compiledEffects;
  return cache === undefined ? 0 : Object.keys(cache).length;
}
