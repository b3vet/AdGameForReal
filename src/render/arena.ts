/**
 * The boss arena's markers: a stone pillar either side of the road with a
 * banner hanging off it, at the line the fight happens on (Milestone 5 plan,
 * "Boss arena: pillars and banners marking the arena").
 *
 * The band painted across the road is `./road.ts`; this is what stands beside
 * it. Two markers, one mesh, one draw call: the pillar and its banner are baked
 * together (they share the dungeon atlas, D39), and the pair is drawn as two
 * thin instances of the result.
 *
 * The pieces are loaded asynchronously and the markers appear when they arrive.
 * `place` is safe to call before that — the arena's z is remembered and the
 * instances are written as soon as there is a mesh to write them for.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { assemble, at, loadDungeonPieces, scale3, scaleToHeight } from './dungeonPieces';
import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import { tintMaterial } from './models';
import { applyToonRamp } from './toonRamp';
import { ROAD_HALF_WIDTH, paletteColor } from './theme';

/** The dungeon pieces a marker is assembled from. */
const ARENA_PIECES = ['prop_dungeon_pillar', 'prop_dungeon_banner_blue'];

/** How tall the pillar stands, and how far outside the road's edge. */
const PILLAR_HEIGHT = 3.4;
const MARKER_OUT = 1.1;
/** The banner: how tall it hangs, how high up, and how far off the pillar. */
const BANNER_HEIGHT = 2.2;
const BANNER_Y = 1.05;
const BANNER_Z = -0.36;

export class ArenaMarkers {
  private readonly scene: Scene;
  private mesh: Mesh | null = null;
  private matrices: Float32Array | null = null;
  private loading: Promise<void> | null = null;
  private arenaZ = 0;
  private frozen = false;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Loads and assembles the marker. Idempotent; safe to await more than once. */
  load(): Promise<void> {
    this.loading ??= this.build();
    return this.loading;
  }

  /** Puts the pair at this level's arena line. */
  place(arenaZ: number): void {
    this.arenaZ = arenaZ;
    const mesh = this.mesh;
    const matrices = this.matrices;
    if (mesh === null || matrices === null) return;
    const x = ROAD_HALF_WIDTH + MARKER_OUT;
    // Neither is turned: the pillar is symmetric and the banner hangs on the
    // face that looks back down the road, so rotating one of the pair would
    // hang its banner where the player never sees it.
    for (let i = 0; i < 2; i++) {
      writeInstance(matrices, i, 1, 1, 1, (i === 0 ? -1 : 1) * x, 0, arenaZ);
    }
    commitInstances(mesh, 2);
    // ...and then let the frustum have it back.
    //
    // `createMatrixBuffer` turns culling off for every pool it binds, because
    // thin-instance bounds are not tracked as a buffer changes and a squad
    // whose instances moved would blink out at the edge of the screen. This
    // pair is the exception in the scene: it is written once per level and
    // never again, so its bounds can simply be computed — and until the
    // Milestone 8 review they were not, which drew a pillar pair standing 2.6
    // km up the endless road on every frame of the walk to it (one draw call of
    // the 51 the spanned road peaked at, and one on every campaign level too).
    //
    // `doNotSyncBoundingInfo` stays on: `freeze` computes the world matrix and
    // would recompute the bounds off the *geometry* — the marker at the origin
    // — throwing away what the line below just worked out from the instances.
    mesh.alwaysSelectAsActiveMesh = false;
    mesh.thinInstanceRefreshBoundingInfo(true);
  }

  /**
   * Takes the pillar out of the dungeon and into the biome's daylight (D49).
   *
   * The dungeon atlas is painted for torchlight, so an untinted marker is the
   * darkest thing at the end of the road — a pair of near-black towers where
   * the fight is. The recipe is the roadside's own (`DUNGEON` in
   * `./propKinds.ts`) and reads `stone.light`, so the markers cool with the
   * rest of the stonework when the biome does. Safe before the pieces arrive:
   * a marker that is still loading is tinted by `build` when it lands.
   */
  setBiome(): void {
    const stone = paletteColor('stone.light');
    const blend = (channel: number): number => (0.65 + 0.35 * channel) * 1.18;
    tintMaterial(this.mesh?.material, blend(stone.r), blend(stone.g), blend(stone.b));
  }

  /** Locks the material and the world matrix; see `RoadView.freeze`. */
  freeze(): void {
    this.frozen = true;
    const mesh = this.mesh;
    if (mesh === null) return;
    mesh.material?.freeze();
    mesh.computeWorldMatrix(true);
    mesh.freezeWorldMatrix();
  }

  dispose(): void {
    this.mesh?.material?.dispose();
    this.mesh?.dispose();
    this.mesh = null;
    this.matrices = null;
  }

  private async build(): Promise<void> {
    const pieces = await loadDungeonPieces(this.scene, ARENA_PIECES);
    const pillar = pieces.get('prop_dungeon_pillar');
    const banner = pieces.get('prop_dungeon_banner_blue');
    if (pillar === undefined) return;

    const pillarScale = scaleToHeight(pillar, PILLAR_HEIGHT);
    const parts = [
      {
        source: pillar,
        scale: scale3(pillarScale, pillarScale, pillarScale),
        position: at(0, 0, 0),
      },
    ];
    if (banner !== undefined) {
      const bannerScale = scaleToHeight(banner, BANNER_HEIGHT);
      parts.push({
        source: banner,
        scale: scale3(bannerScale, bannerScale, bannerScale),
        position: at(0, BANNER_Y, BANNER_Z),
      });
    }

    const marker = assemble('arenaMarker', parts);
    // The sources are templates only; the assembly carries its own copy.
    for (const piece of pieces.values()) piece.dispose();
    if (marker === null) return;

    applyToonRamp(marker.material);
    this.mesh = marker;
    this.setBiome();
    this.matrices = createMatrixBuffer(marker, 2);
    this.place(this.arenaZ);
    if (this.frozen) this.freeze();
  }
}
