/**
 * The lane wall's one piece: a post with two metres of run behind it.
 *
 * Split out of `./walls.ts`, which is the pool and the per-frame culling; this
 * is what a wall is made of. Two builds of the same silhouette:
 *
 *   - `loadWallPiece` assembles it from the KayKit dungeon column and parapet
 *     (D39): a column standing at the piece's near end with the parapet running
 *     back from it toward the squad.
 *   - `buildBoxPiece` is the same shape in two boxes, for a build whose models
 *     never arrived and for the dev fixtures that run without them.
 *
 * Merged rather than parented in both cases, because a thin instance transforms
 * *geometry*: two meshes would be two buffers and two draw calls, and a
 * parent-child pair cannot be thin-instanced at all.
 */

import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { assemble, at, loadDungeonPieces, scale3, scaleToHeight } from './dungeonPieces';
import { applyToonRamp } from './toonRamp';
import {
  WALL_PIECE_DEPTH,
  WALL_PIECE_POST_LIFT,
  WALL_POST_HEIGHT,
  WALL_POST_SPACING,
  WALL_POST_WIDTH,
  WALL_RAIL_HEIGHT,
  WALL_RAIL_WIDTH,
  WALL_RAIL_Y,
} from './theme';

/** The dungeon pieces one wall run is assembled from. */
const WALL_PIECES = ['prop_dungeon_column', 'prop_dungeon_barrier_half'];
/** The parapet's own size in metres, which the scales below are measured in. */
const PARAPET_LENGTH = 2;
const PARAPET_HEIGHT = 1.1;
const PARAPET_DEPTH = 0.5;
/** The column's own footprint, likewise. */
const COLUMN_FOOTPRINT = 0.7;

/**
 * The carved piece: a column standing at its near end with two metres of
 * parapet running back from it, in the pack's own stone.
 *
 * The parapet is squashed to the wall's height rather than used as it comes —
 * D32's rule is that the wall is low enough for the squad's spells to fly over
 * it, and `WALL_POST_HEIGHT` is set just under `BOLT_Y` for exactly that.
 */
export async function loadWallPiece(scene: Scene): Promise<Mesh | null> {
  const pieces = await loadDungeonPieces(scene, WALL_PIECES);
  const column = pieces.get('prop_dungeon_column');
  const parapet = pieces.get('prop_dungeon_barrier_half');
  if (column === undefined || parapet === undefined) return null;

  const postScale = scaleToHeight(column, WALL_POST_HEIGHT * WALL_PIECE_POST_LIFT);
  const piece = assemble('wallPiece', [
    {
      source: column,
      // The column is 0.7 m square in its own file; the wall wants a post a
      // little wider than the parapet it caps, not a quarter of a metre of
      // dungeon masonry.
      scale: scale3(
        WALL_POST_WIDTH / COLUMN_FOOTPRINT,
        postScale,
        WALL_POST_WIDTH / COLUMN_FOOTPRINT,
      ),
      position: at(0, 0, 0),
    },
    {
      source: parapet,
      // The parapet runs along its own x, and the loader hands it back
      // mirrored (`loadDungeonPieces`), so it now runs from -2 to 0. A
      // quarter turn *anticlockwise* puts that stretch on the road's -z,
      // which is the direction the run has always gone: back toward the
      // squad, with the post closing its near end.
      yaw: -Math.PI / 2,
      scale: scale3(
        WALL_POST_SPACING / PARAPET_LENGTH,
        WALL_POST_HEIGHT / PARAPET_HEIGHT,
        WALL_PIECE_DEPTH / PARAPET_DEPTH,
      ),
      position: at(0, 0, 0),
    },
  ]);
  for (const source of pieces.values()) source.dispose();
  if (piece === null) return null;
  applyToonRamp(piece.material);
  return piece;
}

/** The same silhouette in two boxes: the stand-in, and Milestone 4's original. */
export function buildBoxPiece(scene: Scene): Mesh {
  const post = CreateBox(
    'wallPost',
    { width: WALL_POST_WIDTH, height: WALL_POST_HEIGHT, depth: WALL_POST_WIDTH },
    scene,
  );
  post.position.y = WALL_POST_HEIGHT / 2;

  const rail = CreateBox(
    'wallRail',
    { width: WALL_RAIL_WIDTH, height: WALL_RAIL_HEIGHT, depth: WALL_POST_SPACING },
    scene,
  );
  rail.position.y = WALL_RAIL_Y;
  rail.position.z = -WALL_POST_SPACING / 2;

  const merged = Mesh.MergeMeshes([post, rail], true, true);
  if (merged === null) {
    // `MergeMeshes` only returns null when it is handed nothing to merge, which
    // cannot happen here; the post alone is still a readable fence.
    post.position.y = WALL_POST_HEIGHT / 2;
    return post;
  }
  merged.name = 'wallPiece';
  return merged;
}
