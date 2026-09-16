/**
 * Which instances of a crowd the camera can see, and which of those are small
 * enough on screen for the low-polygon copy (`./lod.ts`), packed to the front
 * of the buffers the GPU draws from.
 *
 * ## Why a crowd culls its own instances
 *
 * A thin-instance mesh is one draw call and one bounding box, so Babylon's
 * frustum test is all or nothing: `VatCrowd` meshes are always selected
 * (`./asset.ts`), and every instance in the buffer runs the whole vertex
 * shader whether it lands on screen or not. The crowd is one lane wide and
 * grows backward as a column (D42), and the camera frames its front: at a
 * level 20 boss fight a third of the mages stand below the bottom edge.
 *
 * So the caller keeps its buffers exactly as before — they are storage, with
 * holes in them and slots written once and left alone — and this copies the
 * instances whose bounding sphere touches the frustum into the draw buffers,
 * in their original order, which is what the GPU is handed. The order is kept
 * so the picture is the same one: nothing in a crowd is blended, and among
 * opaque instances the only thing draw order can decide is which of two equal
 * depths wins, which it now decides the same way.
 *
 * Instances with a scale of zero are dropped too. That is how the squad hides
 * a dead unit without compacting its indices (`../squad.ts`), and a hole drawn
 * as a point still costs its four thousand vertices.
 *
 * ## Which copy
 *
 * Measured on an Apple GPU, the crowd's cost is its *on-screen* triangles
 * (`./simplify.ts`), and what the eye reads is its biggest units: a squad of
 * thirteen at the start of a run, and the ranks nearest the camera in a big
 * one. So the split is by size on screen — the bounding sphere's radius in
 * pixels — with a budget: at most `wholeBudget` of the biggest visible units
 * are drawn from the full mesh, the rest from the copy, and a unit under
 * `smallLine` pixels is drawn from the copy whatever the budget says. The cut
 * is found with a histogram rather than a sort, so it costs two passes and no
 * allocation. A unit keeps the mesh it had until it is a little past the cut
 * either way, so one hovering at it does not switch every frame.
 *
 * Pure arithmetic on typed arrays: no Babylon import, no allocation, so the
 * rule is tested in Node (`../__tests__/crowdCull.test.ts`).
 */

/** A plane as Babylon's frustum holds one: a point with `n·p + d < 0` is outside. */
export interface CullPlane {
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  readonly d: number;
}

/** The mesh's own bounding sphere, in its local space, before any instance matrix. */
export interface CullSphere {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * A pair of instance buffers: sixteen floats of matrix an instance in
 * Babylon's layout (translation in 12 to 14), and `stride` floats of whatever
 * else the instance carries. `count` is how many are filled.
 */
export interface CrowdBuffers {
  readonly matrices: Float32Array;
  readonly settings: Float32Array;
  count: number;
}

/** How visible instances are shared between the full mesh and the copy. */
export interface CrowdSplit {
  /** The camera's view-projection, Babylon's layout; only its w row is read. */
  transform: ArrayLike<number>;
  /** Screen pixels per unit of radius over w, for this camera and buffer. */
  pixels: number;
  /**
   * Units drawn whole in one frame: at most this many plus the few the
   * hysteresis band holds on past the cut.
   */
  wholeBudget: number;
  /** Radius in pixels under which a unit is always drawn from the copy. */
  smallLine: number;
  /**
   * Fewer units than this for the copy and the whole crowd is drawn whole: a
   * handful of small units is not worth the copy's draw call.
   */
  minSmall: number;
  /** Per source slot: 1 while that slot is drawn from the copy. */
  readonly small: Uint8Array;
  /** Per source slot, this frame: radius in pixels, or -1 when culled. */
  readonly sizes: Float32Array;
  /** Visible units per size bucket (`BUCKET_PIXELS` wide), this frame. */
  readonly histogram: Uint16Array;
}

/** Width of one histogram bucket, in pixels of radius. */
const BUCKET_PIXELS = 8;
/** Buckets a split's histogram holds; the last one takes everything bigger. */
export const SIZE_BUCKETS = 128;
/**
 * How far past the cut a unit has to be to change mesh, as a share of it. Wide
 * enough for a unit's hop and sway, narrow enough that a crowd whose sizes
 * cluster — three hundred mages between 160 and 330 pixels — does not hold a
 * second budget's worth of units on the whole mesh inside the band.
 */
const HYSTERESIS = 0.04;

const FLOATS_PER_MATRIX = 16;

/**
 * Fills `whole` (and `small`, given a split) with the visible instances of
 * `source`, front-packed and in order, and sets their counts. The output
 * buffers must be other arrays than the source's. An empty `planes` means
 * there is no camera to test against yet, and everything with a scale is
 * kept; without a split, everything kept is drawn whole.
 */
export function cullCrowd(
  source: CrowdBuffers,
  stride: number,
  planes: readonly CullPlane[],
  sphere: CullSphere,
  whole: CrowdBuffers,
  small: CrowdBuffers | null,
  split: CrowdSplit | null,
): void {
  whole.count = 0;
  if (small !== null) small.count = 0;
  if (small === null || split === null) {
    for (let i = 0; i < source.count; i++) {
      if (sizeOf(source, i, planes, sphere, null) >= 0) copyInstance(source, stride, i, whole);
    }
    return;
  }

  // Pass one: who is visible, how big, and how many of each size.
  const sizes = split.sizes;
  const histogram = split.histogram;
  histogram.fill(0);
  for (let i = 0; i < source.count; i++) {
    const size = sizeOf(source, i, planes, sphere, split);
    sizes[i] = size;
    if (size < 0) continue;
    const bucket = Math.min(SIZE_BUCKETS - 1, Math.floor(size / BUCKET_PIXELS));
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }

  // The cut: the smallest bucket edge with no more than the budget above it.
  let above = 0;
  let edge = SIZE_BUCKETS;
  while (edge > 0) {
    const next = above + (histogram[edge - 1] ?? 0);
    if (next > split.wholeBudget) break;
    above = next;
    edge--;
  }
  // A budget of none is absolute: everything from the copy, band or no band.
  let cut =
    split.wholeBudget <= 0 ? Number.POSITIVE_INFINITY : Math.max(split.smallLine, edge * BUCKET_PIXELS);
  if (Number.isFinite(cut)) {
    let below = 0;
    const cutBucket = Math.min(SIZE_BUCKETS, Math.floor(cut / BUCKET_PIXELS));
    for (let b = 0; b < cutBucket; b++) below += histogram[b] ?? 0;
    if (below < split.minSmall) cut = 0;
  }

  // Pass two: each visible unit to its mesh, in order.
  const flags = split.small;
  for (let i = 0; i < source.count; i++) {
    const size = sizes[i] ?? -1;
    if (size < 0) continue;
    const wasSmall = flags[i] === 1;
    const isSmall = wasSmall ? size < cut * (1 + HYSTERESIS) : size < cut * (1 - HYSTERESIS);
    flags[i] = isSmall ? 1 : 0;
    copyInstance(source, stride, i, isSmall ? small : whole);
  }
}

/**
 * Instance `i`'s bounding-sphere radius on screen in pixels, or -1 when it is
 * hidden or outside the frustum. Without a split there is no camera scale, and
 * any visible instance answers 0.
 */
function sizeOf(
  source: CrowdBuffers,
  i: number,
  planes: readonly CullPlane[],
  sphere: CullSphere,
  split: CrowdSplit | null,
): number {
  const matrices = source.matrices;
  const o = i * FLOATS_PER_MATRIX;
  const m0 = matrices[o] ?? 0;
  const m1 = matrices[o + 1] ?? 0;
  const m2 = matrices[o + 2] ?? 0;
  const m4 = matrices[o + 4] ?? 0;
  const m5 = matrices[o + 5] ?? 0;
  const m6 = matrices[o + 6] ?? 0;
  const m8 = matrices[o + 8] ?? 0;
  const m9 = matrices[o + 9] ?? 0;
  const m10 = matrices[o + 10] ?? 0;

  const sx = m0 * m0 + m1 * m1 + m2 * m2;
  const sy = m4 * m4 + m5 * m5 + m6 * m6;
  const sz = m8 * m8 + m9 * m9 + m10 * m10;
  const widest = sx > sy ? (sx > sz ? sx : sz) : sy > sz ? sy : sz;
  // A hidden slot: every vertex would land on one point.
  if (widest === 0) return -1;

  const cx = sphere.x;
  const cy = sphere.y;
  const cz = sphere.z;
  const wx = cx * m0 + cy * m4 + cz * m8 + (matrices[o + 12] ?? 0);
  const wy = cx * m1 + cy * m5 + cz * m9 + (matrices[o + 13] ?? 0);
  const wz = cx * m2 + cy * m6 + cz * m10 + (matrices[o + 14] ?? 0);
  const radius = sphere.radius * Math.sqrt(widest);

  for (let p = 0; p < planes.length; p++) {
    const plane = planes[p];
    if (plane === undefined) continue;
    const n = plane.normal;
    if (n.x * wx + n.y * wy + n.z * wz + plane.d <= -radius) return -1;
  }
  if (split === null) return 0;

  const t = split.transform;
  const w = wx * (t[3] ?? 0) + wy * (t[7] ?? 0) + wz * (t[11] ?? 0) + (t[15] ?? 1);
  // At the eye or behind it: as large as it gets.
  return w > 1e-6 ? (radius / w) * split.pixels : Number.MAX_VALUE;
}

function copyInstance(source: CrowdBuffers, stride: number, index: number, into: CrowdBuffers): void {
  const at = into.count++;
  const from = index * FLOATS_PER_MATRIX;
  const to = at * FLOATS_PER_MATRIX;
  const matrices = source.matrices;
  const out = into.matrices;
  for (let k = 0; k < FLOATS_PER_MATRIX; k++) out[to + k] = matrices[from + k] ?? 0;
  const settings = source.settings;
  const outSettings = into.settings;
  const sFrom = index * stride;
  const sTo = at * stride;
  for (let k = 0; k < stride; k++) outSettings[sTo + k] = settings[sFrom + k] ?? 0;
}
