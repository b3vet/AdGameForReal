/**
 * The road's own geometry: the cobbled surface and one kerb stone.
 *
 * Both are built here rather than in `./road.ts` so that file stays about what
 * the road *is* — the stack of strips, when they are placed, what is frozen —
 * rather than about vertex buffers.
 *
 * The surface is a grid rather than a `CreateGround` quad for one reason: its
 * vertex colours carry the wear and the gutter shading. Baking those into the
 * mesh is what keeps them free — a worn stripe down each lane and a contact
 * shadow along each kerb would otherwise be two more alpha-blended strips and
 * two more draw calls, on a road that is already the largest surface in frame.
 * The material multiplies the cobble albedo by the vertex colour, so the same
 * mesh carries the photo texture and the shading.
 */

import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Scene } from '@babylonjs/core/scene';

import {
  GUTTER_ALPHA,
  GUTTER_WIDTH,
  KERB_CAP_HEIGHT,
  KERB_CAP_WIDTH,
  KERB_HEIGHT,
  KERB_LENGTH,
  KERB_WIDTH,
  WEAR_ALPHA,
  WEAR_WIDTH,
} from './roadLook';
import { LANE_WIDTH, ROAD_HALF_WIDTH } from './theme';

/**
 * Grid resolution. Across: 0.125 m, which is fine enough that the wear band's
 * soft edge reads as a gradient rather than as facets. Along: the mesh is one
 * metre long and stretched to the level's length, so the rows only have to
 * carry the slow wander of the wear — two dozen of them over four hundred
 * metres is a wander with a twenty-metre period.
 */
const COLUMNS = 49;
const ROWS = 24;

/** Lane centres, which is where the wear goes. */
const LANE_CENTRES = [-LANE_WIDTH, 0, LANE_WIDTH];

/**
 * The cobbled surface: one unit-long strip, stretched along z per level.
 *
 * uv spans 0..1 either way and the tiling is the texture's own `uScale` and
 * `vScale`, so one mesh serves every level length (`RoadView.setExtent`).
 */
export function createRoadSurface(scene: Scene): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < ROWS; row++) {
    const v = row / (ROWS - 1);
    const z = v - 0.5;
    // Two waves at incommensurate rates, so the wander does not repeat inside
    // the strip and its ends still meet at the same place.
    const wander = Math.sin(v * Math.PI * 2) * 0.16 + Math.sin(v * Math.PI * 5) * 0.08;
    for (let column = 0; column < COLUMNS; column++) {
      const u = column / (COLUMNS - 1);
      const x = (u - 0.5) * ROAD_HALF_WIDTH * 2;
      positions.push(x, 0, z);
      normals.push(0, 1, 0);
      uvs.push(u, v);
      const shade = gutterShade(x) * wearShade(x, wander);
      colors.push(shade, shade, shade, 1);
    }
  }

  for (let row = 0; row < ROWS - 1; row++) {
    for (let column = 0; column < COLUMNS - 1; column++) {
      const a = row * COLUMNS + column;
      const b = a + 1;
      const c = a + COLUMNS;
      const d = c + 1;
      // The same winding `CreateGround` uses. Babylon culls back faces by
      // default and a hand-built mesh gets no side orientation of its own, so
      // the *other* order is a road that is simply not there — which is exactly
      // what the first frame of this showed.
      indices.push(d, b, a, c, d, a);
    }
  }

  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.colors = colors;
  data.indices = indices;

  const mesh = new Mesh('road', scene);
  data.applyToMesh(mesh, false);
  mesh.isPickable = false;
  mesh.receiveShadows = false;
  return mesh;
}

/**
 * One kerb stone: a block with a chamfered cap, merged into a single mesh so a
 * whole edge of them is one thin-instanced draw call.
 *
 * The cap is what makes it read as a kerb from the game's camera angle. A plain
 * box at this size is a grey line; the step catches the light on its top face
 * and the shadow band on the road (the surface's own vertex colours) sits under
 * its inner edge.
 */
export function createKerbPiece(scene: Scene): Mesh {
  const base = CreateBox(
    'kerbBase',
    { width: KERB_WIDTH, height: KERB_HEIGHT, depth: KERB_LENGTH },
    scene,
  );
  base.position.y = KERB_HEIGHT / 2;

  const cap = CreateBox(
    'kerbCap',
    { width: KERB_CAP_WIDTH, height: KERB_CAP_HEIGHT, depth: KERB_LENGTH },
    scene,
  );
  cap.position.y = KERB_HEIGHT + KERB_CAP_HEIGHT / 2 - 0.01;

  const merged = Mesh.MergeMeshes([base, cap], true, true);
  if (merged === null) {
    // `MergeMeshes` only returns null when handed nothing; the base alone is
    // still a kerb.
    return base;
  }
  merged.name = 'kerbPiece';
  merged.isPickable = false;
  return merged;
}

/**
 * The gutter: how much darker the road is at `x` because of the kerb beside it.
 *
 * Squared, so the darkening is a contact shadow hugging the stone rather than a
 * grey wash across the outer third of the road.
 */
function gutterShade(x: number): number {
  const into = (Math.abs(x) - (ROAD_HALF_WIDTH - GUTTER_WIDTH)) / GUTTER_WIDTH;
  if (into <= 0) return 1;
  const t = Math.min(1, into);
  return 1 - GUTTER_ALPHA * t * t;
}

/** Lane wear: a soft polished track down the middle of each lane. */
function wearShade(x: number, wander: number): number {
  let shade = 1;
  for (const centre of LANE_CENTRES) {
    const t = Math.abs(x - (centre + wander)) / (WEAR_WIDTH / 2);
    if (t >= 1) continue;
    // Smooth at the edges and flat in the middle, so two neighbouring lanes
    // never leave a bright seam between their tracks.
    shade *= 1 - WEAR_ALPHA * (1 - t * t);
  }
  return shade;
}
