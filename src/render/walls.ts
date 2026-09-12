/**
 * Lane walls (D32): rune-stone fences along the lane boundary the squad may not
 * cross.
 *
 * The sim's contract is a list of `WallDef`s on the level — a boundary (-1 or
 * +1, so the fence stands at `x = ±laneWidth/2`) and a stretch of road. This
 * draws that stretch as a run of fence pieces, and it draws nothing the sim has
 * not declared: the clamp is the sim's, the fence is only what says where it
 * is.
 *
 * Two meshes, two draw calls, whatever a level's walls add up to:
 *
 *   - a stone piece — a post with the two metres of rail behind it, merged into
 *     one mesh so the pair is one instance and one draw call. It is never
 *     scaled, which is what keeps a post a post: the rail length is baked into
 *     the geometry rather than stretched per instance, and the piece that
 *     closes the near end simply overhangs the wall's `zStart` by up to that
 *     same two metres — which is the approach zone (`balance.walls.approach`),
 *     where the clamp is already biting, so the drawn fence starts exactly
 *     where the wall starts to be felt.
 *   - a rune bar, additive and amber, capping every post, flaring on the post
 *     the squad is being pushed against, and lying flat on the road as the
 *     approach marker.
 *
 * Everything is pooled at construction from `levels.json` (`POOL.wallPosts`),
 * placed once per level, and written per frame only for the pieces inside
 * `WALL_DRAW_RANGE` — so a level whose walls are all behind the squad costs two
 * disabled meshes and no draw calls at all.
 */

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import type { SpriteLayer } from './sprites';
import { bookCell } from './spriteSheets';
import {
  POOL,
  WALL_DRAW_BEHIND,
  WALL_DRAW_RANGE,
  WALL_FLASH_DURATION,
  WALL_FLASH_SCALE,
  WALL_FLASH_SIZE,
  WALL_MARKER_PLATE,
  WALL_MARKER_SCALE,
  WALL_POST_HEIGHT,
  WALL_POST_SPACING,
  WALL_POST_WIDTH,
  WALL_PULSE_DEPTH,
  WALL_PULSE_RATE,
  WALL_RAIL_HEIGHT,
  WALL_RAIL_WIDTH,
  WALL_RAIL_Y,
  WALL_RUNE_COLOR,
  WALL_RUNE_HEIGHT,
  WALL_RUNE_WIDTH,
  WALL_STONE_COLOR,
} from './theme';
import { balance } from '@/data';
import { wallX } from '@/sim';
import type { WallDef } from '@/sim';

/** One fence piece: a post at `z`, with its rail running back toward the squad. */
interface Post {
  x: number;
  z: number;
  /** True on the piece the squad meets first, which carries the marker cap. */
  first: boolean;
  /** Seconds left of the flare a `wallBlocked` put on this post. */
  flash: number;
}

/** The rune plate painted on the road where a wall's clamp starts biting. */
interface Marker {
  x: number;
  z: number;
}

export class WallView {
  private readonly stone: Mesh;
  private readonly stoneMatrices: Float32Array;
  private readonly runes: Mesh;
  private readonly runeMatrices: Float32Array;
  private readonly runeMaterial: StandardMaterial;
  private readonly sprites: SpriteLayer;

  /** Every post of every wall in the level, in road order. */
  private readonly posts: Post[] = [];
  private postCount = 0;
  private readonly markers: Marker[] = [];
  private markerCount = 0;

  private phase = 0;
  /** True while any post is flaring, so the common case skips the scan. */
  private flashing = false;

  constructor(scene: Scene, sprites: SpriteLayer) {
    this.sprites = sprites;

    const stoneMaterial = new StandardMaterial('wallStoneMat', scene);
    stoneMaterial.diffuseColor = WALL_STONE_COLOR;
    stoneMaterial.specularColor = Color3.Black();

    this.stone = buildPiece(scene);
    this.stone.material = stoneMaterial;
    this.stoneMatrices = createMatrixBuffer(this.stone, POOL.wallPosts);

    // Additive and unlit, like every other glowing thing on the road: the rune
    // has to read on light stone in daylight, and an additive bar over its own
    // post is what makes it look lit from inside rather than painted on.
    this.runeMaterial = new StandardMaterial('wallRuneMat', scene);
    this.runeMaterial.emissiveColor = WALL_RUNE_COLOR.clone();
    this.runeMaterial.diffuseColor = Color3.Black();
    this.runeMaterial.specularColor = Color3.Black();
    this.runeMaterial.disableLighting = true;
    this.runeMaterial.alpha = 0.95;
    this.runeMaterial.alphaMode = Constants.ALPHA_ADD;

    this.runes = CreateBox(
      'wallRune',
      { width: WALL_RUNE_WIDTH, height: WALL_RUNE_HEIGHT, depth: WALL_POST_SPACING },
      scene,
    );
    this.runes.material = this.runeMaterial;
    this.runeMatrices = createMatrixBuffer(this.runes, POOL.wallRunes);

    for (let i = 0; i < POOL.wallPosts; i++) {
      this.posts.push({ x: 0, z: 0, first: false, flash: 0 });
    }
    for (let i = 0; i < POOL.wallRunes; i++) this.markers.push({ x: 0, z: 0 });

    // Empty *and disabled* from the first frame, before any level is loaded.
    // Both halves matter: an enabled thin-instance mesh with a count of zero
    // draws one full-size copy of itself at the world origin — a fence post in
    // the middle of the squad — and it is also what the warm-up pass reads to
    // decide whether to compile the instanced variant of a material
    // (`./warmup.ts`), so an enabled empty pool compiles the wrong shader at
    // boot and the right one inside the frame that first draws a wall.
    commitInstances(this.stone, 0);
    commitInstances(this.runes, 0);
  }

  /**
   * Lays out the level's fences. Called from `loadLevel`, never per frame: a
   * wall does not move, so the only thing `update` does is decide which of
   * these pieces are close enough to be worth drawing.
   */
  setWalls(walls: readonly WallDef[] | undefined): void {
    this.postCount = 0;
    this.markerCount = 0;
    this.flashing = false;
    for (const post of this.posts) post.flash = 0;
    commitInstances(this.stone, 0);
    commitInstances(this.runes, 0);
    if (walls === undefined) return;

    const laneWidth = balance.road.laneWidth;
    for (const wall of walls) {
      const x = wallX(wall.boundary, laneWidth);
      const length = Math.max(0, wall.zEnd - wall.zStart);
      // Pieces are placed from the far end back, so the fence always ends
      // exactly on `zEnd` — the metre the wall stops guarding is the metre the
      // player is about to turn into, and an approximate end there is a fence
      // that looks like it lets you through when it does not.
      const pieces = Math.max(1, Math.floor(length / WALL_POST_SPACING));
      for (let i = 0; i <= pieces; i++) {
        const post = this.posts[this.postCount];
        if (post === undefined) break;
        post.x = x;
        post.z = wall.zEnd - i * WALL_POST_SPACING;
        post.first = i === pieces;
        post.flash = 0;
        this.postCount++;
      }

      const marker = this.markers[this.markerCount];
      if (marker !== undefined) {
        marker.x = x;
        marker.z = wall.zStart - balance.walls.approach;
        this.markerCount++;
      }
    }
  }

  /**
   * A wall pushed the squad. The post nearest the push flares, and a spark goes
   * off against it in the shared sprite batch — the sim only emits this on the
   * *edge* of being blocked (`Run.noteWall`), so it is a beat, not a buzz.
   */
  onBlocked(boundary: -1 | 1, z: number): void {
    const x = wallX(boundary, balance.road.laneWidth);
    let best: Post | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.postCount; i++) {
      const post = this.posts[i];
      if (post === undefined || post.x !== x) continue;
      const gap = Math.abs(post.z - z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = post;
    }
    if (best === null) return;
    best.flash = WALL_FLASH_DURATION;
    this.flashing = true;
  }

  /** Writes the pieces in range. One pass, no allocation, two draw calls. */
  update(squadZ: number, dt: number): void {
    this.phase += dt * WALL_PULSE_RATE;
    // The whole fence breathes together, like the lane strips it grows out of:
    // one uniform write a frame rather than a per-instance brightness the
    // material has no room for.
    const pulse = 1 + Math.sin(this.phase * Math.PI * 2) * WALL_PULSE_DEPTH;
    WALL_RUNE_COLOR.scaleToRef(pulse, this.runeMaterial.emissiveColor);

    const near = squadZ - WALL_DRAW_BEHIND;
    const far = squadZ + WALL_DRAW_RANGE;
    let stones = 0;
    let runes = 0;
    let flashing = false;

    for (let i = 0; i < this.postCount; i++) {
      const post = this.posts[i];
      if (post === undefined) continue;
      if (post.flash > 0) {
        post.flash = Math.max(0, post.flash - dt);
        flashing = flashing || post.flash > 0;
      }
      // The rail runs *behind* the post, so a piece whose post has just gone
      // past the near edge still has rail in frame.
      if (post.z < near - WALL_POST_SPACING || post.z > far) continue;

      if (stones < POOL.wallPosts) {
        writeInstance(this.stoneMatrices, stones, 1, 1, 1, post.x, 0, post.z);
        stones++;
      }
      if (runes >= POOL.wallRunes) continue;

      // The cap: the glowing top edge, over the post and the rail behind it.
      // The first piece of a wall wears a taller one, which is the approach
      // marker the player sees before the fence can push them.
      const flare = post.flash > 0 ? 1 + (WALL_FLASH_SCALE - 1) * (post.flash / WALL_FLASH_DURATION) : 1;
      const height = (post.first ? WALL_MARKER_SCALE : 1) * flare;
      writeInstance(
        this.runeMatrices,
        runes,
        1,
        height,
        1,
        post.x,
        WALL_POST_HEIGHT + (WALL_RUNE_HEIGHT * height) / 2,
        post.z - WALL_POST_SPACING / 2,
      );
      runes++;

      if (post.flash > 0) {
        // A spark against the stone, in the batch the impacts already share.
        const fade = post.flash / WALL_FLASH_DURATION;
        this.sprites.add(
          // The sparkle book, run backwards as the flare dies, so its brightest
          // frame is the one on the frame the push happened.
          bookCell('sparkle', 1 - fade),
          post.x,
          WALL_POST_HEIGHT,
          post.z,
          WALL_FLASH_SIZE * (1.2 - fade * 0.4),
          WALL_RUNE_COLOR.r,
          WALL_RUNE_COLOR.g,
          WALL_RUNE_COLOR.b,
          fade,
        );
      }
    }

    for (let i = 0; i < this.markerCount && runes < POOL.wallRunes; i++) {
      const marker = this.markers[i];
      if (marker === undefined) continue;
      if (marker.z < near || marker.z > far) continue;
      // A rune plate lying on the road: the same bar, scaled flat and wide, so
      // the marker costs no third mesh.
      writeInstance(
        this.runeMatrices,
        runes,
        WALL_MARKER_PLATE.width / WALL_RUNE_WIDTH,
        1,
        WALL_MARKER_PLATE.depth / WALL_POST_SPACING,
        marker.x,
        WALL_RUNE_HEIGHT,
        marker.z,
      );
      runes++;
    }

    this.flashing = flashing;
    commitInstances(this.stone, stones);
    commitInstances(this.runes, runes);
  }

  /** Pieces written last frame, for the debug panel and the dev harness. */
  get drawn(): number {
    return this.stone.thinInstanceCount;
  }

  /** True while a `wallBlocked` flare is still playing; the harness asserts it. */
  get flaring(): boolean {
    return this.flashing;
  }

  reset(): void {
    this.setWalls(undefined);
  }

  dispose(): void {
    this.stone.material?.dispose();
    this.stone.dispose();
    this.runes.material?.dispose();
    this.runes.dispose();
    this.posts.length = 0;
    this.markers.length = 0;
  }
}

/**
 * One fence piece: a post, and the rail that runs back from it toward the
 * squad, as a single mesh.
 *
 * Merged rather than parented, because a thin instance transforms *geometry*:
 * two meshes would be two buffers and two draw calls, and a parent-child pair
 * cannot be thin-instanced at all.
 */
function buildPiece(scene: Scene): Mesh {
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
