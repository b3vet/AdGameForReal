/**
 * What the simplifier (`./simplify.ts`) knows about a mesh before it merges
 * anything: which vertices are one corner and which are one point, the
 * triangles over them, which rule each point may merge under, and each point's
 * quadric.
 *
 * Split out of `./simplify.ts` for the file-size rule (CLAUDE.md), on the seam
 * between reading the mesh and changing it. Load-time only; it allocates
 * freely.
 */

import type { SimplifyInput } from './simplify';

/** The rule a point merges under. */
/** How much a seam or an open edge weighs against the surface in the quadric. */
const BOUNDARY_WEIGHT = 10;

export const MANIFOLD = 0;
export const SEAM = 1;
export const BORDER = 2;
export const LOCKED = 3;

/**
 * Ten terms of the symmetric 4x4 plane matrix (a2 ab ac ad b2 bc bd c2 cd d2),
 * then the summed weight of the planes in it, which turns a cost back into a
 * squared distance.
 */
export type Quadric = Float64Array;
export const QUADRIC_TERMS = 11;
/** Where a quadric keeps the summed weight of its planes. */
export const QUADRIC_WEIGHT = 10;

function addPlane(q: Quadric, a: number, b: number, c: number, d: number, w: number): void {
  q[0] = (q[0] ?? 0) + w * a * a;
  q[1] = (q[1] ?? 0) + w * a * b;
  q[2] = (q[2] ?? 0) + w * a * c;
  q[3] = (q[3] ?? 0) + w * a * d;
  q[4] = (q[4] ?? 0) + w * b * b;
  q[5] = (q[5] ?? 0) + w * b * c;
  q[6] = (q[6] ?? 0) + w * b * d;
  q[7] = (q[7] ?? 0) + w * c * c;
  q[8] = (q[8] ?? 0) + w * c * d;
  q[9] = (q[9] ?? 0) + w * d * d;
  q[10] = (q[10] ?? 0) + w;
}

/** The quadric `a + b` at `(x, y, z)`, without building the sum. */
export function evaluatePair(a: Quadric, b: Quadric, x: number, y: number, z: number): number {
  const t = (k: number): number => (a[k] ?? 0) + (b[k] ?? 0);
  return (
    t(0) * x * x + 2 * t(1) * x * y + 2 * t(2) * x * z + 2 * t(3) * x +
    t(4) * y * y + 2 * t(5) * y * z + 2 * t(6) * y +
    t(7) * z * z + 2 * t(8) * z + t(9)
  );
}

/** The welded mesh: corners, points, live triangles and each point's fan. */
export interface WeldedMesh {
  /** Canonical vertex of each input vertex: equal in every attribute. */
  corner: Int32Array;
  /** Point of each input vertex: equal in position. */
  point: Int32Array;
  pointCount: number;
  /** Three floats a point. */
  pointPos: number[];
  /** Three canonical vertices a triangle; degenerate ones are left out. */
  tris: number[];
  triCount: number;
  /** Per point, every triangle that has ever touched it. */
  fans: number[][];
}

const HASH_FLOAT = new Float32Array(1);
const HASH_BITS = new Uint32Array(HASH_FLOAT.buffer);

function hashPosition(x: number, y: number, z: number): number {
  HASH_FLOAT[0] = x;
  let hash = HASH_BITS[0] ?? 0;
  HASH_FLOAT[0] = y;
  hash = Math.imul(hash ^ (HASH_BITS[0] ?? 0), 0x9e3779b1);
  HASH_FLOAT[0] = z;
  return Math.imul(hash ^ (HASH_BITS[0] ?? 0), 0x85ebca6b);
}

/** Whether two vertices agree in every attribute and every bone slot. */
function sameCorner(input: SimplifyInput, a: number, b: number): boolean {
  for (const attribute of input.attributes) {
    const stride = attribute.stride;
    for (let k = 0; k < stride; k++) {
      if (attribute.data[a * stride + k] !== attribute.data[b * stride + k]) return false;
    }
  }
  for (let k = 0; k < 4; k++) {
    if (input.boneIndices[a * 4 + k] !== input.boneIndices[b * 4 + k]) return false;
    if (input.boneWeights[a * 4 + k] !== input.boneWeights[b * 4 + k]) return false;
  }
  return true;
}

/** Welds the input into corners and points; see `WeldedMesh`. */
export function weld(input: SimplifyInput): WeldedMesh {
  const pos = input.positions;
  const vertexCount = Math.floor(pos.length / 3);

  // Points: vertices equal in position, found through a hash of the three
  // coordinates. Corners: vertices equal in everything, found among the few
  // that share their point.
  const corner = new Int32Array(vertexCount);
  const point = new Int32Array(vertexCount);
  const buckets = new Map<number, number[]>();
  const pointCorners: number[][] = [];
  let pointCount = 0;
  const pointPos: number[] = [];
  for (let v = 0; v < vertexCount; v++) {
    // `+ 0` folds -0 into 0, which compare equal and must weld.
    const x = (pos[v * 3] ?? 0) + 0;
    const y = (pos[v * 3 + 1] ?? 0) + 0;
    const z = (pos[v * 3 + 2] ?? 0) + 0;
    const hash = hashPosition(x, y, z);
    let bucket = buckets.get(hash);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(hash, bucket);
    }
    let p = -1;
    for (const candidate of bucket) {
      if (pointPos[candidate * 3] === x && pointPos[candidate * 3 + 1] === y && pointPos[candidate * 3 + 2] === z) {
        p = candidate;
        break;
      }
    }
    if (p < 0) {
      p = pointCount++;
      bucket.push(p);
      pointPos.push(x, y, z);
      pointCorners.push([]);
    }
    point[v] = p;
    const corners = pointCorners[p] ?? [];
    let c = -1;
    for (const other of corners) {
      if (sameCorner(input, v, other)) {
        c = other;
        break;
      }
    }
    if (c < 0) {
      c = v;
      corners.push(v);
    }
    corner[v] = c;
  }

  // Triangles over canonical corners, degenerate ones dropped.
  const tris: number[] = [];
  const src = input.indices;
  for (let t = 0; t + 2 < src.length; t += 3) {
    const a = corner[src[t] ?? 0] ?? 0;
    const b = corner[src[t + 1] ?? 0] ?? 0;
    const c = corner[src[t + 2] ?? 0] ?? 0;
    const pa = point[a];
    const pb = point[b];
    const pc = point[c];
    if (pa === pb || pb === pc || pa === pc) continue;
    tris.push(a, b, c);
  }
  const triCount = tris.length / 3;
  const fans: number[][] = Array.from({ length: pointCount }, () => []);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) fans[point[tris[t * 3 + k] ?? 0] ?? 0]?.push(t);
  }
  return { corner, point, pointCount, pointPos, tris, triCount, fans };
}

/** Which rule each point merges under; see the file note. */
export function classify(
  tris: readonly number[],
  point: Int32Array,
  fans: readonly (readonly number[])[],
  pointCount: number,
): Uint8Array {
  const kind = new Uint8Array(pointCount);
  for (let p = 0; p < pointCount; p++) {
    const fan = fans[p] ?? [];
    const corners = new Set<number>();
    // Edges out of p: far point -> the corners p and the far point have in
    // each triangle on that edge.
    const edges = new Map<number, number[][]>();
    for (const t of fan) {
      let mine = -1;
      for (let k = 0; k < 3; k++) {
        const c = tris[t * 3 + k] ?? 0;
        if (point[c] === p) mine = c;
      }
      corners.add(mine);
      for (let k = 0; k < 3; k++) {
        const c = tris[t * 3 + k] ?? 0;
        const r = point[c] ?? 0;
        if (r === p) continue;
        const list = edges.get(r) ?? [];
        list.push([mine, c]);
        edges.set(r, list);
      }
    }
    let border = 0;
    let seam = 0;
    let broken = false;
    for (const sides of edges.values()) {
      if (sides.length === 1) border++;
      else if (sides.length === 2) {
        const [a, b] = sides;
        if (a === undefined || b === undefined) continue;
        if (a[0] !== b[0] || a[1] !== b[1]) seam++;
      } else broken = true;
    }
    // A disc has as many edges as triangles; a disc with an open side, one more.
    const disc = border === 0 ? edges.size === fan.length : border === 2 && edges.size === fan.length + 1;
    if (broken || !disc || fan.length === 0) kind[p] = LOCKED;
    else if (border > 0) kind[p] = seam === 0 && corners.size === 1 ? BORDER : LOCKED;
    else if (seam === 0) kind[p] = corners.size === 1 ? MANIFOLD : LOCKED;
    else kind[p] = seam === 2 && corners.size === 2 ? SEAM : LOCKED;
  }
  return kind;
}

/** Every point's quadric: its triangles' planes, and its hard edges' walls. */
export function buildQuadrics(
  tris: readonly number[],
  triCount: number,
  point: Int32Array,
  pointPos: readonly number[],
  fans: readonly (readonly number[])[],
  kind: Uint8Array,
  pointCount: number,
): Quadric[] {
  const quadrics = Array.from({ length: pointCount }, () => new Float64Array(QUADRIC_TERMS));
  const at = (p: number, k: number): number => pointPos[p * 3 + k] ?? 0;
  for (let t = 0; t < triCount; t++) {
    const a = point[tris[t * 3] ?? 0] ?? 0;
    const b = point[tris[t * 3 + 1] ?? 0] ?? 0;
    const c = point[tris[t * 3 + 2] ?? 0] ?? 0;
    const ux = at(b, 0) - at(a, 0);
    const uy = at(b, 1) - at(a, 1);
    const uz = at(b, 2) - at(a, 2);
    const wx = at(c, 0) - at(a, 0);
    const wy = at(c, 1) - at(a, 1);
    const wz = at(c, 2) - at(a, 2);
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) continue;
    const area = length / 2;
    nx /= length;
    ny /= length;
    nz /= length;
    const d = -(nx * at(a, 0) + ny * at(a, 1) + nz * at(a, 2));
    for (const p of [a, b, c]) {
      const q = quadrics[p];
      if (q !== undefined) addPlane(q, nx, ny, nz, d, area);
    }
    // Walls along this triangle's hard edges: seams and open edges.
    const corners = [tris[t * 3] ?? 0, tris[t * 3 + 1] ?? 0, tris[t * 3 + 2] ?? 0];
    for (let k = 0; k < 3; k++) {
      const p = point[corners[k] ?? 0] ?? 0;
      const r = point[corners[(k + 1) % 3] ?? 0] ?? 0;
      if (!hardEdge(tris, point, fans, kind, p, r)) continue;
      const ex = at(r, 0) - at(p, 0);
      const ey = at(r, 1) - at(p, 1);
      const ez = at(r, 2) - at(p, 2);
      // A plane through the edge, perpendicular to the triangle.
      let px = ey * nz - ez * ny;
      let py = ez * nx - ex * nz;
      let pz = ex * ny - ey * nx;
      const pl = Math.hypot(px, py, pz);
      if (pl === 0) continue;
      px /= pl;
      py /= pl;
      pz /= pl;
      const pd = -(px * at(p, 0) + py * at(p, 1) + pz * at(p, 2));
      const weight = BOUNDARY_WEIGHT * (ex * ex + ey * ey + ez * ez);
      for (const s of [p, r]) {
        const q = quadrics[s];
        if (q !== undefined) addPlane(q, px, py, pz, pd, weight);
      }
    }
  }
  return quadrics;
}

/** Whether the edge between two points is open or a seam. */
function hardEdge(
  tris: readonly number[],
  point: Int32Array,
  fans: readonly (readonly number[])[],
  kind: Uint8Array,
  p: number,
  r: number,
): boolean {
  if (kind[p] === MANIFOLD && kind[r] === MANIFOLD) return false;
  const sides: number[][] = [];
  for (const t of fans[p] ?? []) {
    let mine = -1;
    let theirs = -1;
    for (let k = 0; k < 3; k++) {
      const c = tris[t * 3 + k] ?? 0;
      if (point[c] === p) mine = c;
      if (point[c] === r) theirs = c;
    }
    if (theirs >= 0) sides.push([mine, theirs]);
  }
  if (sides.length !== 2) return true;
  const [a, b] = sides;
  return a?.[0] !== b?.[0] || a?.[1] !== b?.[1];
}
