/**
 * The crowd's low-polygon copy (`../characters/simplify.ts`).
 *
 * The rules the copy has to keep are about the picture: a flat patch loses its
 * inner triangles and keeps its outline and its area, a colour region keeps
 * its colour right up to its edge, and a vertex never ends up bent by a bone it
 * was not bound to. Each is checked on a small synthetic mesh where the right
 * answer is known.
 */

import { describe, expect, it } from 'vitest';

import { compactVertices } from '../characters/lod';
import { simplifyIndices } from '../characters/simplify';
import type { SimplifyInput } from '../characters/simplify';

interface Grid {
  input: SimplifyInput;
  colors: Float32Array;
  vertexCount: number;
}

/**
 * An `n` by `n` grid of quads in the xz plane. `colorAt` paints each quad; a
 * vertex shared by quads of two colours is duplicated, which is exactly what a
 * palette-textured KayKit model does at the edge of a colour region. `boneAt`
 * binds each vertex by its position.
 */
function grid(
  n: number,
  colorAt: (qx: number, qz: number) => number = () => 0,
  boneAt: (x: number, z: number) => number = () => 0,
): Grid {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const bones: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  const keys = new Map<string, number>();
  const vertex = (x: number, z: number, color: number): number => {
    const key = `${String(x)},${String(z)},${String(color)}`;
    const known = keys.get(key);
    if (known !== undefined) return known;
    const index = positions.length / 3;
    keys.set(key, index);
    positions.push(x, 0, z);
    normals.push(0, 1, 0);
    colors.push(color, 1 - color, 0, 1);
    bones.push(boneAt(x, z), 0, 0, 0);
    weights.push(1, 0, 0, 0);
    return index;
  };
  for (let qz = 0; qz < n; qz++) {
    for (let qx = 0; qx < n; qx++) {
      const color = colorAt(qx, qz);
      const a = vertex(qx, qz, color);
      const b = vertex(qx + 1, qz, color);
      const c = vertex(qx + 1, qz + 1, color);
      const d = vertex(qx, qz + 1, color);
      indices.push(a, c, b, a, d, c);
    }
  }
  const colorArray = Float32Array.from(colors);
  return {
    input: {
      positions: Float32Array.from(positions),
      indices: Uint32Array.from(indices),
      attributes: [
        { data: Float32Array.from(normals), stride: 3 },
        { data: colorArray, stride: 4 },
      ],
      boneIndices: Float32Array.from(bones),
      boneWeights: Float32Array.from(weights),
    },
    colors: colorArray,
    vertexCount: positions.length / 3,
  };
}

function areaOf(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let area = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a = 0, b = 0, c = 0] = [indices[t], indices[t + 1], indices[t + 2]];
    const ux = (positions[b * 3] ?? 0) - (positions[a * 3] ?? 0);
    const uz = (positions[b * 3 + 2] ?? 0) - (positions[a * 3 + 2] ?? 0);
    const vx = (positions[c * 3] ?? 0) - (positions[a * 3] ?? 0);
    const vz = (positions[c * 3 + 2] ?? 0) - (positions[a * 3 + 2] ?? 0);
    area += Math.abs(ux * vz - uz * vx) / 2;
  }
  return area;
}

describe('simplifyIndices', () => {
  it('thins a flat patch down to its outline and keeps its area', () => {
    const { input } = grid(8);
    const before = input.indices.length / 3;
    const kept = simplifyIndices(input, { ratio: 0.35, maxError: 0.02 });
    expect(kept.length / 3).toBeLessThanOrEqual(Math.ceil(before * 0.35));
    expect(areaOf(input.positions, kept)).toBeCloseTo(64, 6);
    // The corners of the patch are still vertices of the copy.
    const used = new Set(kept);
    for (const [x, z] of [[0, 0], [8, 0], [8, 8], [0, 8]]) {
      let found = false;
      for (const v of used) {
        if (input.positions[v * 3] === x && input.positions[v * 3 + 2] === z) found = true;
      }
      expect(found).toBe(true);
    }
  });

  it('keeps every triangle inside one colour region', () => {
    // Left half one colour, right half the other: a seam down the middle.
    const { input, colors } = grid(8, (qx) => (qx < 4 ? 0 : 1));
    const kept = simplifyIndices(input, { ratio: 0.35, maxError: 0.02 });
    expect(kept.length).toBeLessThan(input.indices.length);
    for (let t = 0; t + 2 < kept.length; t += 3) {
      const tint = [0, 1, 2].map((k) => colors[(kept[t + k] ?? 0) * 4]);
      expect(new Set(tint).size).toBe(1);
    }
    // And the two regions still cover their own halves exactly.
    let left = 0;
    for (let t = 0; t + 2 < kept.length; t += 3) {
      if (colors[(kept[t] ?? 0) * 4] === 0) left += areaOf(input.positions, kept.subarray(t, t + 3));
    }
    expect(left).toBeCloseTo(32, 6);
  });

  it('bends the copy exactly as it bends the original', () => {
    // Two bones meeting between x = 4 and x = 5; the second lifts its side.
    // The strip between them is what bends, and it must be the same strip.
    const { input } = grid(8, () => 0, (x) => (x <= 4 ? 0 : 1));
    const kept = simplifyIndices(input, { ratio: 0.2, maxError: 0.05 });
    expect(kept.length).toBeLessThan(input.indices.length);
    const bent = Float32Array.from(input.positions);
    for (let v = 0; v < bent.length / 3; v++) {
      if (input.boneIndices[v * 4] === 1) bent[v * 3 + 1] = 1;
    }
    expect(areaOf3(bent, kept)).toBeCloseTo(areaOf3(bent, input.indices), 6);
  });

  it('stops short of the ratio rather than exceed the error', () => {
    // A bumpy patch: next to nothing merges within a zero budget.
    const { input } = grid(6);
    const positions = Float32Array.from(input.positions);
    for (let v = 0; v < positions.length / 3; v++) {
      const x = positions[v * 3] ?? 0;
      const z = positions[v * 3 + 2] ?? 0;
      positions[v * 3 + 1] = Math.sin(x * 1.3) * 0.3 + Math.cos(z * 1.7) * 0.2;
    }
    const target = Math.ceil((input.indices.length / 3) * 0.1);
    const kept = simplifyIndices({ ...input, positions }, { ratio: 0.1, maxError: 0 });
    expect(kept.length / 3).toBeGreaterThan(target * 3);
  });
});

/** Surface area in three dimensions, for a mesh that is no longer flat. */
function areaOf3(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let area = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const [a = 0, b = 0, c = 0] = [indices[t], indices[t + 1], indices[t + 2]];
    const u = [0, 1, 2].map((k) => (positions[b * 3 + k] ?? 0) - (positions[a * 3 + k] ?? 0));
    const w = [0, 1, 2].map((k) => (positions[c * 3 + k] ?? 0) - (positions[a * 3 + k] ?? 0));
    const [ux = 0, uy = 0, uz = 0] = u;
    const [wx = 0, wy = 0, wz = 0] = w;
    area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  return area;
}

describe('compactVertices', () => {
  it('keeps the used vertices in first-use order and rewrites the indices', () => {
    const { order, indices } = compactVertices(Uint32Array.from([5, 2, 9, 2, 9, 7]), 10);
    expect(Array.from(order)).toEqual([5, 2, 9, 7]);
    expect(Array.from(indices)).toEqual([0, 1, 2, 1, 2, 3]);
  });
});
