/**
 * Which pooled bodies Havok has to hear about on the next step.
 *
 * Babylon's Havok plugin does two things for every body on every step, before
 * and after the world steps: it pushes the body's transform node into Havok
 * (the "pre-step", unless `disablePreStep`) and reads the result back into the
 * node (unless `disableSync`), each through a WASM call. The pools used to
 * leave the pre-step on for every body, because a pooled body is recycled by
 * teleporting its node, and a teleport only reaches Havok through it. That is
 * about two hundred bodies — eight corpses and four fallen mages of eleven
 * boxes each and sixty-four shards — of which a handful are live at any time.
 * Measured on the level 20 road under a 4x CPU throttle, the step was 3.2 ms of
 * a 8.9 ms frame, and the pre-steps alone 1.7 ms of it (docs/28, note 5).
 *
 * So a body's pre-step is on only for the step after its node was moved —
 * spawned, parked or sunk a little further — and goes off again once that step
 * has run. A parked body is not read back either: it is frozen under the
 * world, and there is nothing to read. Nothing a corpse or a shard does looks
 * any different: every teleport still reaches Havok on the very next step, as
 * it always did.
 *
 * Allocation-free after the pools are built: the pending list only grows to
 * the most bodies ever moved between two steps, which the first level reset
 * reaches.
 */

import type { Observer } from '@babylonjs/core/Misc/observable';
import type { PhysicsBody } from '@babylonjs/core/Physics/v2/physicsBody';
import type { Scene } from '@babylonjs/core/scene';

export class PrestepGate {
  private readonly pending: PhysicsBody[] = [];
  private count = 0;
  private observer: Observer<Scene> | null;

  constructor(private readonly scene: Scene) {
    this.observer = scene.onAfterPhysicsObservable.add(this.settle);
  }

  /** The body's node was just moved: Havok takes the new transform next step. */
  moved(body: PhysicsBody): void {
    if (!body.disablePreStep) return;
    body.disablePreStep = false;
    this.pending[this.count++] = body;
  }

  /** A body coming back into play: moved, and read back from now on. */
  wake(body: PhysicsBody): void {
    body.disableSync = false;
    this.moved(body);
  }

  /** A body being parked: moved once more, then left alone. */
  sleep(body: PhysicsBody): void {
    body.disableSync = true;
    this.moved(body);
  }

  dispose(): void {
    if (this.observer === null) return;
    this.scene.onAfterPhysicsObservable.remove(this.observer);
    this.observer = null;
    this.count = 0;
  }

  /** After a step: everything it pushed is in Havok now. */
  private readonly settle = (): void => {
    for (let i = 0; i < this.count; i++) {
      const body = this.pending[i];
      if (body !== undefined) body.disablePreStep = true;
    }
    this.count = 0;
  };
}
