/**
 * A lower-polygon copy of a crowd character, for the units that are small on
 * screen (docs/28, note 5).
 *
 * ## Why
 *
 * The crowd is the frame on a phone. A KayKit mage is 4,949 triangles, and at a
 * level 20 boss fight two hundred and fifty of them are on screen at thirty to
 * a hundred points tall — a few pixels a triangle, where the art reads the same
 * at a third of them. Measured on the
 * Mac's GPU (an Apple tile-based part, like the phone's): drawing half of every
 * crowd mesh's triangles took the stress frame from 7.8 to 4.6 ms, and a
 * quarter to 3.0; the resolution, the bone reads and the shading were each
 * worth a fraction of that. Triangles a unit is too small to show are the cost.
 *
 * ## How
 *
 * Quadric error simplification (Garland and Heckbert) by half-edge collapse:
 * a vertex is only ever merged *onto a neighbour that already exists*, so the
 * result is a new index list over the original vertices. No vertex is moved
 * or blended — every one that survives keeps its exact position, texture
 * coordinate, colour, normal and bone weights — and the art's flat colour
 * regions survive because of the rules below, not because of a tolerance.
 *
 * The KayKit art is hard-edged and palette-textured: over half of the mage's
 * corners are *seams*, where one position carries two vertices with different
 * texture coordinates or normals. The rules, after meshoptimizer's:
 *
 *   - an interior vertex with one set of attributes may merge into any
 *     neighbour;
 *   - a vertex on a seam may only slide along that seam, to a neighbour on the
 *     same seam, each side of the seam keeping its own attributes;
 *   - a vertex on an open edge may only slide along that edge;
 *   - anything else — seam junctions, corners, non-manifold points — stays.
 *
 * Seams and open edges also add a plane perpendicular to the surface to the
 * quadric, so the outline of a colour region and a cape's hem keep their shape
 * as well as their colours. A merge that would flip a triangle, or pinch the
 * surface into a non-manifold edge, is refused; so is one between vertices
 * bound to different bones, and a vertex where two bindings meet does not move
 * at all, because either would change how the unit bends.
 *
 * It runs once per character at load, over a few thousand triangles, and
 * allocates freely: nothing here is on the frame path. What the mesh is before
 * anything merges — welding, the rules, the quadrics — is `./simplifyMesh.ts`,
 * and the queue is `./simplifyHeap.ts`.
 */

import { Heap } from './simplifyHeap';
import {
  BORDER,
  LOCKED,
  MANIFOLD,
  QUADRIC_TERMS,
  QUADRIC_WEIGHT,
  SEAM,
  buildQuadrics,
  classify,
  evaluatePair,
  weld,
} from './simplifyMesh';
import type { Quadric } from './simplifyMesh';
import { SKIN_TOLERANCE, lockSkinSeams, skinDistance } from './simplifySkin';

export interface SimplifyInput {
  /** Three floats a vertex. */
  positions: ArrayLike<number>;
  /** Three indices a triangle. */
  indices: ArrayLike<number>;
  /**
   * Every other per-vertex attribute (normals, texture coordinates, colours):
   * two vertices at one position are one corner only if all of these agree.
   */
  attributes: readonly { data: ArrayLike<number>; stride: number }[];
  /** Four bone indices and four weights a vertex; see `./simplifySkin.ts`. */
  boneIndices: ArrayLike<number>;
  boneWeights: ArrayLike<number>;
}

export interface SimplifyOptions {
  /** Share of the triangles to keep, 0 to 1. */
  ratio: number;
  /**
   * The largest error a merge may cost, as a fraction of the mesh's size (its
   * bounding box diagonal). Simplification stops short of `ratio` rather than
   * pay more.
   */
  maxError: number;
}

/** A triangle whose normal turns by more than this (as a cosine) is a flip. */
const MIN_NORMAL_DOT = 0.2;

/**
 * The simplified triangles, as indices into the input's own vertices. The
 * caller builds a mesh from the vertices they reference (`compactVertices` in
 * `./lod.ts`).
 */
export function simplifyIndices(input: SimplifyInput, options: SimplifyOptions): Uint32Array {
  const { point, pointCount, pointPos, tris, triCount, fans } = weld(input);
  const alive = new Uint8Array(triCount).fill(1);

  const kind = classify(tris, point, fans, pointCount);
  lockSkinSeams(input, tris, point, fans, kind);
  const quadrics = buildQuadrics(tris, triCount, point, pointPos, fans, kind, pointCount);

  // The mesh's size, which the error budget is a fraction of.
  const extent = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    let low = Infinity;
    let high = -Infinity;
    for (let p = 0; p < pointCount; p++) {
      const value = pointPos[p * 3 + k] ?? 0;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    extent[k] = pointCount > 0 ? high - low : 0;
  }
  const errorLimit = (options.maxError * Math.hypot(extent[0] ?? 0, extent[1] ?? 0, extent[2] ?? 0)) ** 2;

  const stamps = new Uint32Array(pointCount);
  const gone = new Uint8Array(pointCount);
  const heap = new Heap();
  const context: MergeContext = { tris, alive, point, pointPos, fans, kind, quadrics, input };

  const consider = (p: number): void => {
    for (const q of neighbours(context, p)) {
      const cost = mergeCost(context, p, q);
      if (cost !== null) heap.push(cost, p, q, stamps[p] ?? 0, stamps[q] ?? 0);
      const back = mergeCost(context, q, p);
      if (back !== null) heap.push(back, q, p, stamps[q] ?? 0, stamps[p] ?? 0);
    }
  };
  for (let p = 0; p < pointCount; p++) consider(p);

  let remaining = triCount;
  const target = Math.max(1, Math.floor(triCount * options.ratio));
  const entry = [0, 0, 0, 0, 0];
  while (remaining > target && heap.size > 0) {
    heap.pop(entry);
    const [cost = 0, from = 0, to = 0, stampFrom = 0, stampTo = 0] = entry;
    if (gone[from] === 1 || gone[to] === 1) continue;
    if (stampFrom !== stamps[from] || stampTo !== stamps[to]) continue;
    if (cost > errorLimit) break;
    const removed = merge(context, from, to);
    if (removed < 0) continue;
    remaining -= removed;
    gone[from] = 1;
    // Only the survivor's edges cost something new: its quadric grew. Every
    // other queued merge keeps its price, and whether it is still safe is
    // asked again when it comes up (`merge`).
    stamps[to] = (stamps[to] ?? 0) + 1;
    consider(to);
  }

  const out: number[] = [];
  for (let t = 0; t < triCount; t++) {
    if (alive[t] === 1) out.push(tris[t * 3] ?? 0, tris[t * 3 + 1] ?? 0, tris[t * 3 + 2] ?? 0);
  }
  return Uint32Array.from(out);
}

interface MergeContext {
  tris: number[];
  alive: Uint8Array;
  point: Int32Array;
  pointPos: number[];
  fans: number[][];
  kind: Uint8Array;
  quadrics: Quadric[];
  input: SimplifyInput;
}

/** The points sharing a live triangle with `p`. */
function neighbours(ctx: MergeContext, p: number): number[] {
  const out: number[] = [];
  for (const t of ctx.fans[p] ?? []) {
    if (ctx.alive[t] !== 1) continue;
    for (let k = 0; k < 3; k++) {
      const q = ctx.point[ctx.tris[t * 3 + k] ?? 0] ?? 0;
      if (q !== p && !out.includes(q)) out.push(q);
    }
  }
  return out;
}

/** The corner at point `p` in triangle `t`, or -1. */
function cornerAt(ctx: MergeContext, t: number, p: number): number {
  for (let k = 0; k < 3; k++) {
    const c = ctx.tris[t * 3 + k] ?? 0;
    if (ctx.point[c] === p) return c;
  }
  return -1;
}

/** The live triangles holding both points. */
function shared(ctx: MergeContext, p: number, q: number): number[] {
  const out: number[] = [];
  for (const t of ctx.fans[p] ?? []) {
    if (ctx.alive[t] === 1 && cornerAt(ctx, t, q) >= 0) out.push(t);
  }
  return out;
}

/**
 * What `cornerMap` found: up to two `(from, to)` pairs of vertex indices,
 * written here rather than into a new map, because the queue prices tens of
 * thousands of merges a character.
 */
const PAIRS = new Int32Array(4);

/** Where `from` goes in the last `cornerMap`, or -1. */
function mapped(pairs: number, from: number): number {
  for (let i = 0; i < pairs; i++) {
    if (PAIRS[i * 2] === from) return PAIRS[i * 2 + 1] ?? -1;
  }
  return -1;
}

/**
 * What each of `p`'s corners becomes if `p` merges into `q`, as a count of
 * pairs in `PAIRS`, or -1 when the rules above refuse the merge.
 */
function cornerMap(ctx: MergeContext, p: number, q: number): number {
  const kp = ctx.kind[p];
  if (kp === LOCKED) return -1;
  let edge = 0;
  let pairs = 0;
  // Corners of `p` on triangles off the edge, which the pairs must cover.
  let other0 = -1;
  let other1 = -1;
  for (const t of ctx.fans[p] ?? []) {
    if (ctx.alive[t] !== 1) continue;
    const from = cornerAt(ctx, t, p);
    const to = cornerAt(ctx, t, q);
    if (to < 0) {
      if (from === other0 || from === other1) continue;
      // Every shape the rules allow has at most two corners at a point.
      if (other0 < 0) other0 = from;
      else if (other1 < 0) other1 = from;
      else return -1;
      continue;
    }
    edge++;
    const known = mapped(pairs, from);
    if (known >= 0) {
      if (known !== to) return -1;
      continue;
    }
    if (pairs === 2) return -1;
    PAIRS[pairs * 2] = from;
    PAIRS[pairs * 2 + 1] = to;
    pairs++;
  }
  if (kp === MANIFOLD) {
    if (edge !== 2 || pairs !== 1) return -1;
  } else if (kp === BORDER) {
    // Along the open edge only: one triangle on it, and the far end is open too.
    if (edge !== 1) return -1;
    const kq = ctx.kind[q];
    if (kq !== BORDER && kq !== LOCKED) return -1;
  } else {
    // Along the seam only: two sides, each keeping its own attributes.
    if (edge !== 2 || pairs !== 2) return -1;
    const kq = ctx.kind[q];
    if (kq !== SEAM && kq !== LOCKED) return -1;
    if (PAIRS[1] === PAIRS[3]) return -1;
  }
  // Every corner `p` has must be accounted for.
  if (other0 >= 0 && mapped(pairs, other0) < 0) return -1;
  if (other1 >= 0 && mapped(pairs, other1) < 0) return -1;
  // Bent alike, or not at all.
  for (let i = 0; i < pairs; i++) {
    if (skinDistance(ctx.input, PAIRS[i * 2] ?? 0, PAIRS[i * 2 + 1] ?? 0) > SKIN_TOLERANCE) return -1;
  }
  return pairs;
}

function mergeCost(ctx: MergeContext, p: number, q: number): number | null {
  if (cornerMap(ctx, p, q) < 0) return null;
  const qp = ctx.quadrics[p];
  const qq = ctx.quadrics[q];
  if (qp === undefined || qq === undefined) return null;
  const x = ctx.pointPos[q * 3] ?? 0;
  const y = ctx.pointPos[q * 3 + 1] ?? 0;
  const z = ctx.pointPos[q * 3 + 2] ?? 0;
  // As a squared distance: the planes are weighted by area, and so is the sum.
  return (
    Math.max(0, evaluatePair(qp, qq, x, y, z)) /
    Math.max(1e-12, (qp[QUADRIC_WEIGHT] ?? 0) + (qq[QUADRIC_WEIGHT] ?? 0))
  );
}

/**
 * Merges `p` into `q` and answers how many triangles went, or -1 when the
 * merge turns out to be unsafe in the current mesh.
 */
function merge(ctx: MergeContext, p: number, q: number): number {
  const pairs = cornerMap(ctx, p, q);
  if (pairs < 0) return -1;
  const { tris, alive, point, pointPos } = ctx;

  // The link condition: the two points may share no neighbour except the
  // triangles on their edge, or the merge pinches the surface.
  const onEdge = shared(ctx, p, q);
  const opposite = new Set<number>();
  for (const t of onEdge) {
    for (let k = 0; k < 3; k++) {
      const r = point[tris[t * 3 + k] ?? 0] ?? 0;
      if (r !== p && r !== q) opposite.add(r);
    }
  }
  const aroundQ = new Set(neighbours(ctx, q));
  for (const r of neighbours(ctx, p)) {
    if (r !== q && aroundQ.has(r) && !opposite.has(r)) return -1;
  }

  // No triangle may flip or collapse to nothing.
  const qx = pointPos[q * 3] ?? 0;
  const qy = pointPos[q * 3 + 1] ?? 0;
  const qz = pointPos[q * 3 + 2] ?? 0;
  for (const t of ctx.fans[p] ?? []) {
    if (alive[t] !== 1 || onEdge.includes(t)) continue;
    const before = normalOf(ctx, t, p, null);
    const after = normalOf(ctx, t, p, [qx, qy, qz]);
    const lb = Math.hypot(...before);
    const la = Math.hypot(...after);
    if (la < 1e-12 * Math.max(1, lb)) return -1;
    const dot = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (lb * la);
    if (dot < MIN_NORMAL_DOT) return -1;
  }

  for (const t of onEdge) alive[t] = 0;
  // The survivor's fan, without the triangles that have gone: fans are read
  // for every merge priced near them, and they only ever grow otherwise.
  const fanQ: number[] = [];
  for (const t of ctx.fans[q] ?? []) if (alive[t] === 1) fanQ.push(t);
  ctx.fans[q] = fanQ;
  for (const t of ctx.fans[p] ?? []) {
    if (alive[t] !== 1) continue;
    for (let k = 0; k < 3; k++) {
      const c = tris[t * 3 + k] ?? 0;
      if (point[c] !== p) continue;
      const to = mapped(pairs, c);
      tris[t * 3 + k] = to >= 0 ? to : c;
    }
    fanQ.push(t);
  }
  ctx.fans[p] = [];
  const qq = ctx.quadrics[q];
  const qp = ctx.quadrics[p];
  if (qq !== undefined && qp !== undefined) {
    for (let k = 0; k < QUADRIC_TERMS; k++) qq[k] = (qq[k] ?? 0) + (qp[k] ?? 0);
  }
  return onEdge.length;
}

/** Triangle `t`'s unnormalised normal, with point `p` optionally moved. */
function normalOf(
  ctx: MergeContext,
  t: number,
  p: number,
  moved: readonly [number, number, number] | null,
): [number, number, number] {
  const v: number[] = [];
  for (let k = 0; k < 3; k++) {
    const r = ctx.point[ctx.tris[t * 3 + k] ?? 0] ?? 0;
    if (moved !== null && r === p) v.push(moved[0], moved[1], moved[2]);
    else v.push(ctx.pointPos[r * 3] ?? 0, ctx.pointPos[r * 3 + 1] ?? 0, ctx.pointPos[r * 3 + 2] ?? 0);
  }
  const [ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0, cx = 0, cy = 0, cz = 0] = v;
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const wx = cx - ax;
  const wy = cy - ay;
  const wz = cz - az;
  return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
}
