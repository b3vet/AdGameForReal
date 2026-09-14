/**
 * What leaves the crowd: who popped in, who fell, and which of the two things a
 * fallen unit becomes.
 *
 * Split out of `./squad.ts` for the file-size rule (CLAUDE.md), on the seam that
 * file has always been cut along — *what a unit looks like this frame* against
 * *what happened to it*. `./squadReact.ts` is the other half of the second one:
 * it remembers what a flag left behind on a unit that is still standing, and
 * this owns the ones that are not standing any more.
 *
 * The routing is the interesting part (D43). A squad death is not a `SimEvent`
 * — the sim frees a crowd index and says nothing at all — so the view is the
 * only thing that sees one, and it has two ways to draw it:
 *
 *   - a corpse out of the crowd's own instance buffer (`./squadCorpses.ts`),
 *     which costs nothing because the crowd is being drawn anyway;
 *   - a real ragdoll from `src/physics`, which is a skinned mesh and therefore
 *     a draw call of its own.
 *
 * So one in ten falls over for real and the rest are corpses, which is exactly
 * the rule the stream bodies already run on and is shared with them in
 * `./deathStyle.ts`. It is one or the other and never both: a corpse and a
 * ragdoll in the same place is two mages dying where one did.
 */

import type { Crowd } from './characters';
import { MAX_FALLEN_PER_FRAME, usesRagdoll } from './deathStyle';
import type { AgentFrame } from './squadAgents';
import { CorpseRing } from './squadCorpses';

/** Where a fallen unit goes next; see `SquadDeaths.drain`. */
export type FallenSink = (x: number, z: number, vx: number, vz: number) => void;

export class SquadDeaths {
  /** The dead, drawn out of the same buffer as the living. */
  private readonly corpses = new CorpseRing();

  /**
   * Units the physics layer is to throw this frame: x, z, vx, vz per entry.
   * A fixed buffer, because a death may not allocate on the frame path.
   */
  private readonly fallen = new Float32Array(MAX_FALLEN_PER_FRAME * 4);
  private fallenCount = 0;

  /** True while `src/physics` is up and has a mage pool to throw them with. */
  private ragdolls = false;

  /**
   * Whether the physics layer will take the squad's dead (D43). False is the
   * state this starts in and returns to whenever the layer is not up: every
   * death then keeps the corpse the ring draws, which is what nine in ten of
   * them get anyway.
   */
  setRagdolls(enabled: boolean): void {
    this.ragdolls = enabled;
  }

  /** A new level: nothing is left standing, or lying, from the run before. */
  clear(): void {
    this.corpses.clear();
    this.fallenCount = 0;
  }

  /**
   * Units that took an index this step pop in; the first frame of a level finds
   * everyone already standing and settles them instead (`AgentFrame.prime`).
   */
  takeBirths(agents: AgentFrame, pop: (index: number) => void): void {
    for (let k = 0; k < agents.bornCount; k++) {
      pop(agents.born[k] ?? 0);
    }
  }

  /**
   * Units that died this step, laid down where they were: the sim's own last
   * live position and velocity for that index, not a formation slot.
   *
   * `scale` is the crowd scale they died at, so a corpse shrinks from the size
   * the unit had.
   */
  takeDeaths(agents: AgentFrame, scale: number): void {
    for (let k = 0; k < agents.deadCount; k++) {
      const index = agents.dead[k] ?? 0;
      const x = agents.prevX[index] ?? 0;
      const z = agents.prevZ[index] ?? 0;
      const vx = agents.prevVX[index] ?? 0;
      const vz = agents.prevVZ[index] ?? 0;
      if (this.ragdolls && usesRagdoll(index) && this.fallenCount < MAX_FALLEN_PER_FRAME) {
        const at = this.fallenCount * 4;
        this.fallen[at] = x;
        this.fallen[at + 1] = z;
        this.fallen[at + 2] = vx;
        this.fallen[at + 3] = vz;
        this.fallenCount++;
        continue;
      }
      this.corpses.push(x, z, vx, vz, scale, index);
    }
  }

  /**
   * Hands this frame's fallen units to `sink` and forgets them.
   *
   * A sink rather than a list, so the caller — the frame loop, the only thing
   * that can see both this and `src/physics` — pays nothing to read it and the
   * view keeps its buffer. Render still knows nothing about physics (D18).
   */
  drain(sink: FallenSink): void {
    for (let k = 0; k < this.fallenCount; k++) {
      const at = k * 4;
      sink(
        this.fallen[at] ?? 0,
        this.fallen[at + 1] ?? 0,
        this.fallen[at + 2] ?? 0,
        this.fallen[at + 3] ?? 0,
      );
    }
    this.fallenCount = 0;
  }

  /** Ages the corpses and writes them into `crowd` from `base`; see the ring. */
  write(crowd: Crowd, base: number, dt: number): number {
    return this.corpses.write(crowd, base, dt);
  }
}
