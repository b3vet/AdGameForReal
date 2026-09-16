/**
 * The crowd's own frustum cull and its whole-or-copy split
 * (`../characters/crowdCull.ts`).
 *
 * The promise the cull has to keep is that the picture does not change: an
 * instance any part of which could be on screen is drawn, and the ones drawn
 * keep their order and their data. The frustum is Babylon's own, built from a
 * real perspective camera's matrices, so the planes are the ones the scene
 * hands the crowd at render time; Babylon's maths runs in Node without an
 * engine.
 */

import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import type { Plane } from '@babylonjs/core/Maths/math.plane';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { describe, expect, it } from 'vitest';

import { SIZE_BUCKETS, cullCrowd } from '../characters/crowdCull';
import type { CrowdBuffers, CrowdSplit, CullSphere } from '../characters/crowdCull';

const STRIDE = 4;
/** A mage's rest-pose sphere, roughly: two units wide, centred at the chest. */
const SPHERE: CullSphere = { x: 0, y: 1.3, z: 0, radius: 2 };
/** The manifest's scale for the mage times a typical crowd scale. */
const UNIT_SCALE = 0.3;
/** The drawing buffer's height at the owner's phone, and the camera's field. */
const BUFFER_HEIGHT = 2868;
const FOV = 0.9;

const VIEW = Matrix.LookAtLH(new Vector3(0, 6, -8), new Vector3(0, 0, 10), Vector3.Up());
const PROJECTION = Matrix.PerspectiveFovLH(FOV, 440 / 956, 0.5, 300);
const TRANSFORM = VIEW.multiply(PROJECTION);

/** A camera behind and above the origin looking down the road (+z), portrait. */
function roadFrustum(): Plane[] {
  return Frustum.GetPlanes(TRANSFORM);
}

function place(
  source: CrowdBuffers,
  index: number,
  x: number,
  z: number,
  scale = UNIT_SCALE,
  scaleY = scale,
): void {
  const matrix = Matrix.Compose(
    new Vector3(scale, scaleY, scale),
    Quaternion.RotationYawPitchRoll(0.4, 0, 0),
    new Vector3(x, 0, z),
  );
  source.matrices.set(matrix.m, index * 16);
  // Tagged so the test can tell which slot a packed instance came from.
  source.settings.set([index, index + 1, index + 2, index + 3], index * STRIDE);
}

function buffers(capacity: number, count = 0): CrowdBuffers {
  return {
    matrices: new Float32Array(capacity * 16),
    settings: new Float32Array(capacity * STRIDE),
    count,
  };
}

function split(
  capacity: number,
  wholeBudget: number,
  smallLine: number,
  minSmall = 0,
): CrowdSplit {
  return {
    transform: TRANSFORM.m,
    pixels: (PROJECTION.m[5] ?? 1) * BUFFER_HEIGHT * 0.5,
    wholeBudget,
    smallLine,
    minSmall,
    small: new Uint8Array(capacity),
    sizes: new Float32Array(capacity),
    histogram: new Uint16Array(SIZE_BUCKETS),
  };
}

/** Culls with no split, and answers how many were kept. */
function cull(source: CrowdBuffers, planes: readonly Plane[], out = buffers(source.count)): number {
  cullCrowd(source, STRIDE, planes, SPHERE, out, null, null);
  return out.count;
}

/** Slot numbers of the packed instances, read back off their tags. */
function slots(out: CrowdBuffers): number[] {
  const list: number[] = [];
  for (let i = 0; i < out.count; i++) list.push(out.settings[i * STRIDE] ?? -1);
  return list;
}

/** The largest x at z = 6 whose sphere centre is still inside every plane. */
function rightEdge(planes: readonly Plane[]): number {
  const probe = buffers(1, 1);
  let edge = 0;
  for (let x = 0; x < 40; x += 0.01) {
    place(probe, 0, x, 6);
    const matrix = Matrix.FromArray(probe.matrices);
    const centre = Vector3.TransformCoordinates(new Vector3(SPHERE.x, SPHERE.y, SPHERE.z), matrix);
    if (planes.every((plane) => plane.dotCoordinate(centre) > 0)) edge = x;
  }
  return edge;
}

describe('cullCrowd', () => {
  it('keeps what is in front of the camera and drops what is behind it', () => {
    const source = buffers(4, 4);
    place(source, 0, 0, 5); // on the road ahead
    place(source, 1, 0, -30); // far behind the camera
    place(source, 2, 0, 20); // further ahead
    place(source, 3, 60, 10); // far off to the side
    const out = buffers(4);
    expect(cull(source, roadFrustum(), out)).toBe(2);
    // Packed in their original order, with their own data.
    expect(slots(out)).toEqual([0, 2]);
    expect(Array.from(out.settings.subarray(4, 8))).toEqual([2, 3, 4, 5]);
    expect(Array.from(out.matrices.subarray(16, 32))).toEqual(
      Array.from(source.matrices.subarray(32, 48)),
    );
  });

  it('keeps an instance whose centre is off screen but whose body is not', () => {
    const planes = roadFrustum();
    const edge = rightEdge(planes);
    const source = buffers(1, 1);
    // Just past the point where the centre leaves the frustum, half a body
    // width is still on screen: it must be kept.
    place(source, 0, edge + UNIT_SCALE * 0.5, 6);
    expect(cull(source, planes)).toBe(1);
    // Well past the reach of its sphere, it is gone.
    place(source, 0, edge + SPHERE.radius * UNIT_SCALE * 4, 6);
    expect(cull(source, planes)).toBe(0);
  });

  it('drops a hidden slot, which the squad writes as a zero scale', () => {
    const source = buffers(3, 3);
    place(source, 0, 0, 5);
    place(source, 1, 0, 6, 0);
    place(source, 2, 0, 7);
    const out = buffers(3);
    expect(cull(source, roadFrustum(), out)).toBe(2);
    expect(slots(out)).toEqual([0, 2]);
  });

  it('tests a squashed or stretched unit at its widest axis', () => {
    const planes = roadFrustum();
    const edge = rightEdge(planes);
    const source = buffers(1, 1);
    // Centre a hand's width outside the right edge. Thin as a thread but a
    // full unit tall, the body still reaches in: the sphere is scaled by the
    // height. Thin both ways, it does not.
    place(source, 0, edge + 0.2, 6, 0.0001, UNIT_SCALE * 1.5);
    expect(cull(source, planes)).toBe(1);
    place(source, 0, edge + 0.2, 6, 0.0001, 0.0001);
    expect(cull(source, planes)).toBe(0);
  });

  it('keeps everything with a scale when there is no frustum yet', () => {
    const source = buffers(3, 3);
    place(source, 0, 0, -500);
    place(source, 1, 0, 6, 0);
    place(source, 2, 900, 0);
    expect(cull(source, [])).toBe(2);
  });

  it('looks at no slot past the count', () => {
    const source = buffers(3, 2);
    place(source, 0, 0, 5);
    place(source, 1, 0, 6);
    place(source, 2, 0, 7);
    expect(cull(source, roadFrustum())).toBe(2);
  });
});

describe('cullCrowd, split between the full mesh and the copy', () => {
  /** A column down the road: slot 0 nearest the camera, each one further. */
  function column(count: number): CrowdBuffers {
    const source = buffers(count, count);
    for (let i = 0; i < count; i++) place(source, i, 0, 2 + i * 0.6);
    return source;
  }

  it('draws a squad inside the budget whole, however many pixels it is', () => {
    const source = column(13);
    const whole = buffers(13);
    const small = buffers(13);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, split(13, 40, 0));
    expect(whole.count).toBe(13);
    expect(small.count).toBe(0);
  });

  it('draws the biggest units whole and the rest from the copy', () => {
    const source = column(120);
    const whole = buffers(120);
    const small = buffers(120);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, split(120, 40, 0));
    // The histogram's buckets are 8 px wide, so the cut can leave a few under
    // the budget; the hysteresis band can hold a few over it.
    expect(whole.count).toBeGreaterThan(30);
    expect(whole.count).toBeLessThanOrEqual(44);
    expect(whole.count + small.count).toBe(120);
    // Nearest the camera is biggest: the whole ones are the front of the list,
    // and both lists keep the original order.
    expect(slots(whole)).toEqual(Array.from({ length: whole.count }, (_, i) => i));
    expect(slots(small)[0]).toBe(whole.count);
  });

  it('draws a unit under the line from the copy whatever the budget', () => {
    const source = column(5);
    const whole = buffers(5);
    const small = buffers(5);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, split(5, 40, 1e9));
    expect(whole.count).toBe(0);
    expect(small.count).toBe(5);
  });

  it('keeps a unit hovering at the cut on the mesh it had', () => {
    const source = buffers(1, 1);
    const whole = buffers(1);
    const small = buffers(1);
    place(source, 0, 0, 6);
    const s = split(1, 40, 0);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, s);
    const size = s.sizes[0] ?? 0;
    expect(size).toBeGreaterThan(0);

    // A line well past its size sends it to the copy...
    s.smallLine = size * 1.1;
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, s);
    expect(small.count).toBe(1);
    // ...and a line a hair below its size does not bring it back: that takes
    // a few percent.
    s.smallLine = size * 0.98;
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, s);
    expect(small.count).toBe(1);
    s.smallLine = size * 0.9;
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, s);
    expect(whole.count).toBe(1);
  });

  it('draws a handful of small units whole rather than pay a draw call', () => {
    const source = column(48);
    const whole = buffers(48);
    const small = buffers(48);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, split(48, 40, 0, 12));
    expect(whole.count).toBe(48);
    expect(small.count).toBe(0);
    // Past the floor the split is back.
    const many = column(120);
    const wholeMany = buffers(120);
    const smallMany = buffers(120);
    cullCrowd(many, STRIDE, roadFrustum(), SPHERE, wholeMany, smallMany, split(120, 40, 0, 12));
    expect(smallMany.count).toBeGreaterThan(12);
  });

  it('draws everything from the copy on a budget of none', () => {
    const source = column(30);
    const whole = buffers(30);
    const small = buffers(30);
    const s = split(30, 40, 0);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, s);
    expect(whole.count).toBe(30);
    s.wholeBudget = 0;
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, whole, small, s);
    expect(whole.count).toBe(0);
    expect(small.count).toBe(30);
  });

  it('measures a unit twice as far away as half the size', () => {
    const source = buffers(2, 2);
    place(source, 0, 0, 10);
    place(source, 1, 0, 30);
    const s = split(2, 40, 0);
    cullCrowd(source, STRIDE, roadFrustum(), SPHERE, buffers(2), buffers(2), s);
    const near = s.sizes[0] ?? 0;
    const far = s.sizes[1] ?? 0;
    expect(near).toBeGreaterThan(far * 1.5);
    // Pixels, as the drawing buffer counts them: a mage-sized sphere ten
    // metres down the road is tens of pixels, not thousands or fractions.
    expect(near).toBeGreaterThan(20);
    expect(near).toBeLessThan(400);
  });
});
