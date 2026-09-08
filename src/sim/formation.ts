/**
 * Squad formation geometry.
 *
 * The squad is a point `(x, z)` plus a `count`; the visual arrangement and the
 * collision half-width are both derived from `count` by a phyllotaxis (sunflower)
 * spiral, so the two can never disagree. Render reads these offsets to place
 * unit instances; the sim reads `halfWidth` for gate and enemy overlap.
 */

/** Radial constant of the spiral, in meters. Also the nearest-neighbour distance. */
const SPACING = 0.35;

/** Padding added to the widest unit so contact feels fair rather than pixel-exact. */
const HALF_WIDTH_PADDING = 0.2;

/** Golden angle: the divergence that makes the spiral pack evenly. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface FormationOffset {
  x: number;
  z: number;
}

/**
 * Offsets are computed once per count and reused: `update` runs this every
 * frame and the sim must not allocate in hot loops (CLAUDE.md).
 */
const offsetCache = new Map<number, ReadonlyArray<FormationOffset>>();
const halfWidthCache = new Map<number, number>();

const EMPTY: ReadonlyArray<FormationOffset> = Object.freeze([]);

/**
 * Formation offsets relative to the squad centre, one per unit.
 * Non-integer or negative counts are floored and clamped to zero.
 */
export function formationOffsets(count: number): ReadonlyArray<FormationOffset> {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return EMPTY;

  const cached = offsetCache.get(n);
  if (cached !== undefined) return cached;

  const offsets: FormationOffset[] = new Array<FormationOffset>(n);
  for (let i = 0; i < n; i++) {
    const radius = SPACING * Math.sqrt(i);
    const angle = i * GOLDEN_ANGLE;
    offsets[i] = { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
  }

  const frozen: ReadonlyArray<FormationOffset> = Object.freeze(offsets);
  offsetCache.set(n, frozen);
  return frozen;
}

/**
 * Half the squad's footprint along `x`: the widest unit plus padding.
 * Monotonically non-decreasing in `count`, because adding units to the spiral
 * can only push the outer edge further out.
 */
export function halfWidth(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return 0;

  const cached = halfWidthCache.get(n);
  if (cached !== undefined) return cached;

  let maxAbsX = 0;
  for (const offset of formationOffsets(n)) {
    const absX = Math.abs(offset.x);
    if (absX > maxAbsX) maxAbsX = absX;
  }

  const result = maxAbsX + HALF_WIDTH_PADDING;
  halfWidthCache.set(n, result);
  return result;
}
