/**
 * Which gates are hiding a threat, and the see-through plaque they wear while
 * they do (document 31, 7: "a block standing behind an arch may be hard to
 * see at 390 px ... if it fails, the ambush gets a silhouette through the
 * panel").
 *
 * It failed. The plaque hangs 0.75 to 1.55 m over the road and is a little
 * wider than the opening; a brute is 0.92 m tall and a beat holds an ambush to
 * its lane, so a block 5 m behind a panel lands inside the plaque's screen box
 * from every distance the choice is made at — at 26 m it is gone entirely, at
 * 14 m only the helmets show over the top — and a portal 8 m behind one is a
 * ring on ground the plaque covers until the squad is nearly through. The
 * number is lifted clear of the plaque (`./labelClearance.ts`), but the body
 * the number belongs to is the other half of the read.
 *
 * So a plaque with a threat standing in its lane within `PLAQUE_SCREEN_DEPTH`
 * behind it is drawn at `PLAQUE_GLASS_ALPHA`: the mob, the river or the portal
 * behind it shows through as a silhouette, and the number printed on it keeps
 * its own dark outline. Only those plaques: a glass plaque on every gate would
 * say nothing.
 *
 * The scan is one pass over the road a frame into a handful of fixed slots —
 * blocks by position, rivers by the stretch of their lane their bodies can be
 * in — so each numbered gate asks a few comparisons rather than walking three
 * hundred bodies.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
// Side-effect import: this is what puts `thinInstance*` on `Mesh.prototype`.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import {
  GATE_LABEL_RANGE,
  LABEL_BEHIND,
  LANE_WIDTH,
  PLAQUE_SCREEN_DEPTH,
} from './theme';
import { balance } from '@/data';
import { laneCenter } from '@/sim';
import type { RunState } from '@/sim';

/** Threats the scan keeps in one frame; the road ahead holds a handful. */
const SCREEN_CAPACITY = 32;

/**
 * Where the plaque falls in the blended pass: after the blob shadows (0,
 * `./shadows.ts`) and the ground decals (1, `./groundDecals.ts`), before
 * everything left at Babylon's default.
 */
const PLAQUE_ALPHA_INDEX = 2;

export class GateScreens {
  /** Lateral centre of each threat, and the stretch of road it stands on. */
  private readonly x = new Float32Array(SCREEN_CAPACITY);
  private readonly near = new Float32Array(SCREEN_CAPACITY);
  private readonly far = new Float32Array(SCREEN_CAPACITY);
  private count = 0;

  /**
   * Every threat a numbered gate could be standing in front of this frame. A
   * river's stretch runs from its nearest live body to where its bodies come
   * from: the portal, or the point `streams.spawnAhead` in front of the squad
   * for a river that keeps pace.
   */
  gather(state: RunState): void {
    this.count = 0;
    const squadZ = state.squad.z;
    const from = squadZ - LABEL_BEHIND;
    const to = squadZ + GATE_LABEL_RANGE + PLAQUE_SCREEN_DEPTH;

    for (let i = 0; i < state.enemies.length; i++) {
      const enemy = state.enemies[i];
      if (enemy === undefined || !enemy.alive || enemy.streamId !== undefined) continue;
      if (enemy.kind === 'boss' || enemy.z < from || enemy.z > to) continue;
      this.push(enemy.x, enemy.z, enemy.z);
    }

    const spawn = squadZ + balance.streams.spawnAhead;
    for (let i = 0; i < state.streams.length; i++) {
      const stream = state.streams[i];
      if (stream === undefined || stream.done) continue;
      const source = stream.anchorZ ?? spawn;
      const pouring = stream.started && stream.spawned < stream.count && stream.cut !== true;
      // A portal still waiting is a threat at the portal; one poured out is
      // only its live bodies; a river that keeps pace only exists once it runs.
      const waiting = !stream.started && stream.anchorZ !== undefined;
      if (!waiting && stream.alive <= 0 && !pouring) continue;
      // Every body walks from the source toward the squad, so whatever is
      // alive is somewhere between the nearest one and where they come from.
      const near = stream.alive > 0 ? stream.headZ : source;
      if (source < from || near > to) continue;
      this.push(laneCenter(stream.lane), near, source);
    }
  }

  /** Whether the gate at `(x, z)` has a threat behind it in its lane. */
  covers(x: number, z: number): boolean {
    const deepest = z + PLAQUE_SCREEN_DEPTH;
    const half = LANE_WIDTH / 2;
    for (let i = 0; i < this.count; i++) {
      if (Math.abs((this.x[i] ?? 0) - x) >= half) continue;
      if ((this.far[i] ?? 0) > z && (this.near[i] ?? 0) <= deepest) return true;
    }
    return false;
  }

  private push(x: number, near: number, far: number): void {
    if (this.count >= SCREEN_CAPACITY) return;
    this.x[this.count] = x;
    this.near[this.count] = near;
    this.far[this.count] = far;
    this.count++;
  }
}

/**
 * Gives the plaque mesh a per-instance opacity, and answers the buffer it is
 * written into: four floats a plaque, white, with the opacity last.
 *
 * One mesh and one draw call for solid and see-through plaques alike. The
 * first version was a second mesh in a translucent copy of the material, and
 * the A/B measurement said what that cost: a draw call on most frames of a
 * dealt level, where a river that keeps pace runs through every panel in its
 * lane. An instance colour is multiplied into the unlit plaque's black diffuse
 * — which leaves it black — and its alpha into the fragment's
 * (`INSTANCESCOLOR`); `hasVertexAlpha` is what puts the mesh in the blended
 * pass, where a plaque at opacity 1 still hides what is behind it.
 *
 * In that pass it keeps the two things it had as an opaque mesh. It writes
 * depth — which Babylon turns off for anything blended unless the material
 * forces it — so the arch's additive light 4 cm behind a plaque stays behind
 * it rather than tinting every plaque in the kind's colour, as the first frame
 * of this showed. And it is drawn straight after the marks on the road
 * (`PLAQUE_ALPHA_INDEX`), before every additive batch: left to the distance
 * sort, the plaque and the bolt batch both measure from the origin, and a
 * plaque sorted second paints over the volley flying into it.
 */
export function seeThroughPlaques(plaque: Mesh, capacity: number): Float32Array {
  const tints = new Float32Array(capacity * 4).fill(1);
  plaque.thinInstanceSetBuffer('color', tints, 4, false);
  plaque.hasVertexAlpha = true;
  plaque.alphaIndex = PLAQUE_ALPHA_INDEX;
  if (plaque.material !== null) plaque.material.forceDepthWrite = true;
  // Babylon reads a mesh's vertex attributes into its material's defines once,
  // the first time the material is made ready for it — for this mesh, the boot
  // readiness pass (`scene.whenReadyAsync`), which checks every mesh, drawn or
  // not. An empty pool is not instanced at that moment, so the instance colour
  // was never taken up and every plaque drew solid. One instance through that
  // pass, of the zero matrix the buffer was made with and on a disabled mesh so
  // it never draws, is what puts the colour in the plaque's one shader;
  // `GateView.reset` empties it again before any level is drawn.
  plaque.setEnabled(false);
  plaque.thinInstanceCount = 1;
  return tints;
}
