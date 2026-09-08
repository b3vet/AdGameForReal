/**
 * Squad formation geometry.
 *
 * The squad is a point `(x, z)` plus a `count`; the visual arrangement and the
 * collision half-width are both derived from `count` by a phyllotaxis (sunflower)
 * spiral, so the two can never disagree. Render reads these offsets to place
 * unit instances; the sim reads `halfWidth` for gate and enemy overlap.
 *
 * The spiral is stretched into an ellipse pointing down the road and its spacing
 * shrinks as the squad grows, because the road is only 6 m wide: a crowd of 500
 * has to get denser and longer rather than wider. Stretching `z` rather than
 * squashing `x` matters — squashing would pull neighbouring units on top of each
 * other, while stretching only ever pushes them apart.
 */

/** Spacing at small counts, in meters. Also the spiral's radial constant there. */
const SPACING_MAX = 0.35;

/** Padding added to the widest unit so contact feels fair rather than pixel-exact. */
const HALF_WIDTH_PADDING = 0.2;

/**
 * Ceiling the formation's half-width approaches as the squad grows. The road
 * spans `x in [-3, 3]`, so a crowd wider than this stands in the grass however
 * many units it holds.
 */
const HALF_WIDTH_CAP = 2.2;

/** x extent as a share of the z extent: the crowd is an ellipse, nose forward. */
const X_TO_Z = 0.6;

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

const EMPTY: ReadonlyArray<FormationOffset> = Object.freeze([]);

/**
 * How far the outermost unit stands from the centre along `x`.
 *
 * Free growth (`SPACING_MAX * sqrt(n - 1)`) while the squad is small, bending
 * smoothly to `HALF_WIDTH_CAP` as it gets big. Smooth matters: a hard clamp
 * would make the crowd stop growing outward in one frame, and this is also what
 * makes `halfWidth` monotonic in `count`.
 */
function halfExtentX(count: number): number {
  const natural = SPACING_MAX * Math.sqrt(Math.max(0, count - 1));
  return (natural * HALF_WIDTH_CAP) / Math.hypot(natural, HALF_WIDTH_CAP);
}

/**
 * Distance between neighbouring units at this squad size, in meters: 0.35 for a
 * handful, about a third of that at 500. Render scales its unit meshes by the
 * same number so a dense crowd reads as dense rather than as overlapping boxes.
 */
export function unitSpacing(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n < 2) return SPACING_MAX;
  return halfExtentX(n) / Math.sqrt(n - 1);
}

/**
 * Formation offsets relative to the squad centre, one per unit.
 * Non-integer or negative counts are floored and clamped to zero.
 */
export function formationOffsets(count: number): ReadonlyArray<FormationOffset> {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return EMPTY;

  const cached = offsetCache.get(n);
  if (cached !== undefined) return cached;

  const spacing = unitSpacing(n);
  const offsets: FormationOffset[] = new Array<FormationOffset>(n);
  for (let i = 0; i < n; i++) {
    const radius = spacing * Math.sqrt(i);
    const angle = i * GOLDEN_ANGLE;
    offsets[i] = { x: radius * Math.cos(angle), z: (radius * Math.sin(angle)) / X_TO_Z };
  }

  const frozen: ReadonlyArray<FormationOffset> = Object.freeze(offsets);
  offsetCache.set(n, frozen);
  return frozen;
}

/**
 * Half the squad's footprint along `x`: the widest unit can stand plus padding.
 *
 * Closed form rather than a scan of the offsets, so it is monotonically
 * non-decreasing in `count` by construction — the sim compares it against enemy
 * footprints every step and a squad that got narrower by recruiting would let
 * blocks phase through the edge of the crowd.
 */
export function halfWidth(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return 0;
  return halfExtentX(n) + HALF_WIDTH_PADDING;
}
