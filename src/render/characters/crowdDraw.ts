/**
 * The GPU side of a `VatCrowd`: what is drawn, from which mesh, each time the
 * camera renders.
 *
 * Split out of `./VatCrowd.ts`, which is the *writing* side — slots, clips,
 * tints — on the seam the cull made: the crowd's own buffers stopped being
 * what the GPU reads (`./crowdCull.ts`), and everything about the buffers the
 * GPU does read now lives here, with the two meshes they are bound to and the
 * one moment in the frame they are filled.
 *
 * The small-on-screen copy (`./lod.ts`) is optional: a character the
 * simplifier could not thin has none, and draws whole as before.
 */

import type { Camera } from '@babylonjs/core/Cameras/camera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Observer } from '@babylonjs/core/Misc/observable';
// Side-effect import: this is what puts `thinInstance*` on `Mesh.prototype`.
import '@babylonjs/core/Meshes/thinInstanceMesh';

import { SIZE_BUCKETS, cullCrowd } from './crowdCull';
import type { CrowdBuffers, CrowdSplit, CullSphere } from './crowdCull';
import { qualityTuning } from '@/data';

const FLOATS_PER_MATRIX = 16;
export const FLOATS_PER_SETTING = 4;
const SETTINGS_KIND = 'bakedVertexAnimationSettingsInstanced';

/**
 * How much bigger than the bind pose a unit is tested at.
 *
 * The mesh's bounding sphere is its rest pose, a T-pose that already has the
 * arms at full reach, and every baked clip stays inside a sphere around it —
 * except a staff raised over the head in the cast clips, and the corpse that
 * falls its own height sideways. A quarter on top covers both; a unit culled a
 * frame early would pop at the frame's edge, and one kept a frame late costs
 * a few hundred vertices.
 */
const CULL_MARGIN = 1.25;

/** Before the first render a scene has no frustum, and nothing is culled. */
const NO_PLANES: readonly never[] = [];

/**
 * A multiplier on how many units a crowd draws whole, shared by every crowd:
 * 1 is the tuned budget (`quality.json`), 0 draws every unit from the copy,
 * and `FULL_DETAIL` or more draws every unit whole. The degrade ladder and the
 * probes turn it (`Renderer.setCrowdDetail`).
 */
let detailScale = 1;
export const FULL_DETAIL = 1000;

export function setCrowdDetailScale(scale: number): void {
  detailScale = Number.isNaN(scale) ? 1 : Math.max(0, scale);
}

/** What the last render drew, for the debug panel and the device report. */
export interface CrowdDrawStats {
  whole: number;
  small: number;
  culled: number;
}

/**
 * Every crowd's counts for the render that culled them last, summed, and which
 * render that was. A crowd adds its share as it culls, so the sum is whole
 * once the render is; a render in which no crowd culled reads as zeros
 * (`crowdFrameTotals`).
 */
const totals: CrowdDrawStats = { whole: 0, small: 0, culled: 0 };
const NO_CROWD: Readonly<CrowdDrawStats> = { whole: 0, small: 0, culled: 0 };
let totalsRender = -1;

/** The summed counts of render `renderId`, or zeros if no crowd drew in it. */
export function crowdFrameTotals(renderId: number): Readonly<CrowdDrawStats> {
  return renderId === totalsRender ? totals : NO_CROWD;
}

function buffers(capacity: number): CrowdBuffers {
  return {
    matrices: new Float32Array(capacity * FLOATS_PER_MATRIX),
    settings: new Float32Array(capacity * FLOATS_PER_SETTING),
    count: 0,
  };
}

export class CrowdDraw {
  private readonly whole: CrowdBuffers;
  private readonly small: CrowdBuffers | null;
  private readonly split: CrowdSplit | null;
  private readonly bounds: CullSphere;
  private observer: Observer<Camera> | null;
  private written = 0;
  /** Last render's counts; see `CrowdDrawStats`. */
  readonly stats: CrowdDrawStats = { whole: 0, small: 0, culled: 0 };

  constructor(
    private readonly source: CrowdBuffers,
    private readonly mesh: Mesh,
    private readonly lodMesh: Mesh | null,
    capacity: number,
  ) {
    // The rest pose's sphere, in the mesh's own space, read before any
    // instance buffer is bound: binding one makes Babylon refit the bounds to
    // the instances unless the mesh says otherwise, and these are all zero.
    const sphere = mesh.getBoundingInfo().boundingSphere;
    this.bounds = {
      x: sphere.center.x,
      y: sphere.center.y,
      z: sphere.center.z,
      radius: sphere.radius * CULL_MARGIN,
    };

    this.whole = buffers(capacity);
    bind(mesh, this.whole);
    if (lodMesh === null) {
      this.small = null;
      this.split = null;
    } else {
      this.small = buffers(capacity);
      bind(lodMesh, this.small);
      this.split = {
        transform: NO_PLANES,
        pixels: 1,
        wholeBudget: 0,
        smallLine: 0,
        minSmall: 0,
        small: new Uint8Array(capacity),
        sizes: new Float32Array(capacity),
        histogram: new Uint16Array(SIZE_BUCKETS),
      };
    }

    // After the scene has posed the camera for this frame and before it picks
    // what to draw: the one moment the frustum is this frame's and the
    // instance count can still change what is drawn. Every path that renders
    // the scene passes through it — the run, the Academy backdrop and the
    // stress scene — without any of them having to know.
    this.observer = mesh.getScene().onBeforeCameraRenderObservable.add(this.cull);
  }

  /**
   * The crowd's writes for this frame are done and `count` slots are in use.
   *
   * An empty crowd is disabled, and that is not an optimisation: Babylon's
   * `hasThinInstances` is `instancesCount > 0`, so a mesh whose count has
   * dropped to zero falls back to the *non-instanced* path and draws one
   * full-size character at the world origin. Its count goes back to zero too,
   * which is the state the warm-up recognises as a pool (`../warmup.ts`). A
   * crowd with slots is sized and uploaded by `cull`, which runs before either
   * mesh can be drawn.
   */
  commit(count: number): void {
    this.written = count;
    const enabled = count > 0;
    this.mesh.setEnabled(enabled);
    if (enabled) return;
    this.mesh.thinInstanceCount = 0;
    if (this.lodMesh !== null) {
      this.lodMesh.setEnabled(false);
      this.lodMesh.thinInstanceCount = 0;
    }
  }

  dispose(): void {
    if (this.observer === null) return;
    this.mesh.getScene().onBeforeCameraRenderObservable.remove(this.observer);
    this.observer = null;
  }

  /**
   * Packs what the camera can see into the draw buffers and uploads them.
   *
   * Every render rather than only after a write: the camera moves every frame
   * even when the crowd does not, and a crowd that was written once — the
   * stress scene's blocks — still has to follow it.
   */
  private readonly cull = (): void => {
    const count = this.written;
    const lodMesh = this.lodMesh;
    // A crowd that is not drawn takes its copy down with it: empty, or hidden
    // from outside — the squad hides the old staff's crowd by its full mesh
    // alone (`../squad.ts`), and a copy left up would go on drawing that
    // crowd's last small units over the new one.
    if (count === 0 || !this.mesh.isEnabled()) {
      lodMesh?.setEnabled(false);
      return;
    }
    const scene = this.mesh.getScene();
    const split = this.split;
    if (split !== null) {
      split.transform = scene.getTransformMatrix().m;
      split.pixels = (scene.getProjectionMatrix().m[5] ?? 1) * scene.getEngine().getRenderHeight() * 0.5;
      const tuning = qualityTuning.crowd;
      const full = detailScale >= FULL_DETAIL;
      split.wholeBudget = full ? count : Math.round(tuning.lodWholeBudget * detailScale);
      split.smallLine = full ? 0 : tuning.lodRadiusPixels;
      split.minSmall = tuning.lodMinSmall;
    }
    this.source.count = count;
    cullCrowd(
      this.source,
      FLOATS_PER_SETTING,
      scene.frustumPlanes ?? NO_PLANES,
      this.bounds,
      this.whole,
      this.small,
      split,
    );
    const stats = this.stats;
    stats.whole = this.whole.count;
    stats.small = this.small?.count ?? 0;
    stats.culled = count - stats.whole - stats.small;
    const renderId = scene.getRenderId();
    if (renderId !== totalsRender) {
      totalsRender = renderId;
      totals.whole = 0;
      totals.small = 0;
      totals.culled = 0;
    }
    totals.whole += stats.whole;
    totals.small += stats.small;
    totals.culled += stats.culled;
    showWhole(this.mesh, this.whole);
    if (lodMesh !== null && this.small !== null) showCopy(lodMesh, this.small);
  };
}

function bind(mesh: Mesh, into: CrowdBuffers): void {
  mesh.thinInstanceSetBuffer('matrix', into.matrices, FLOATS_PER_MATRIX, false);
  mesh.thinInstanceSetBuffer(SETTINGS_KIND, into.settings, FLOATS_PER_SETTING, false);
  mesh.thinInstanceCount = 0;
  // Hidden until something commits instances into it (see `commit`).
  mesh.setEnabled(false);
}

/**
 * The full mesh's share of the frame. Its enabled state is the crowd's — the
 * callers switch it — so nothing to draw hides it instead, and it keeps an
 * instance count above zero while hidden: an enabled mesh with none is what
 * the warm-up compiles a non-instanced shader for (`../warmup.ts`), and what
 * Babylon draws as one full-size character at the origin once it is shown.
 */
function showWhole(mesh: Mesh, from: CrowdBuffers): void {
  mesh.isVisible = from.count > 0;
  if (from.count === 0) {
    if (mesh.thinInstanceCount === 0) mesh.thinInstanceCount = 1;
    return;
  }
  upload(mesh, from);
}

/** The copy's share: on only while it has units to draw. */
function showCopy(mesh: Mesh, from: CrowdBuffers): void {
  mesh.setEnabled(from.count > 0);
  if (from.count > 0) upload(mesh, from);
}

/**
 * Both uploads are cheap: the matrix upload is sized by the count set here,
 * and the settings are four floats an instance.
 */
function upload(mesh: Mesh, from: CrowdBuffers): void {
  mesh.thinInstanceCount = from.count;
  mesh.thinInstanceBufferUpdated('matrix');
  mesh.thinInstanceBufferUpdated(SETTINGS_KIND);
}
