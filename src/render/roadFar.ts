/**
 * The far half of a road that changes biome as it is walked (D52).
 *
 * Split out of `./road.ts` for the file-size rule (CLAUDE.md), on the seam the
 * endless road created: `road.ts` is the road the game has always had — the
 * surface, the kerbs, the runes, the arena — and this is the *second copy* of
 * its three ground meshes that a spanned road needs, so the next biome can be
 * on the ground ahead of the squad before the squad reaches it.
 *
 * Three meshes and three materials, built at boot and disabled until a spanned
 * road asks for them: a campaign level draws exactly what it always drew, and
 * the boot warm-up compiles these anyway so a crossing mid-run cannot compile a
 * shader inside a frame.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeRotatedInstance } from './instanceBuffer';
import { BIOME_GROUND, FRINGE_OVERLAP, FRINGE_WIDTH } from './roadLook';
import { applyGround, matte } from './roadGround';
import type { GroundMaterials } from './roadGround';
import { createRoadSurface } from './roadSurface';
import { ROAD_HALF_WIDTH, paletteColor } from './theme';
import type { BiomeGround } from './roadLook';
import type { BiomeId } from '@/data/biome-types';

export class RoadFarHalf {
  private readonly surface: Mesh;
  private readonly field: Mesh;
  private readonly fringe: Mesh;
  private readonly fringeMatrices: Float32Array;
  private readonly ground: GroundMaterials;

  private tiles: BiomeGround = BIOME_GROUND.meadow;

  /**
   * The spans this road runs through, and which one the camera is in. Held
   * here rather than on the road because they are only ever *this* half's
   * question: where it starts, and which biome it is painted in.
   */
  private cycle: readonly BiomeId[] = [];
  private spanMetres = 0;
  private index = 0;

  /**
   * `fieldWidth` and `fringeOpacity` come from the near half: the two halves
   * are the same road, so the field is the same width and the verge fades out
   * along the same ramp.
   */
  private readonly fieldWidth: number;

  /**
   * `albedos` are the near half's, built once at boot: this half is painted
   * with the same textures — never with a second copy of them — and is handed
   * one here so the boot warm-up compiles a material that already carries a
   * diffuse texture rather than the untextured variant.
   */
  constructor(
    scene: Scene,
    fieldWidth: number,
    fringeOpacity: BaseTexture,
    albedos: ReadonlyMap<string, Texture>,
  ) {
    this.fieldWidth = fieldWidth;
    const fringeMaterial = matte(scene, 'fringeFarMat', paletteColor('grass.base'));
    fringeMaterial.opacityTexture = fringeOpacity;
    fringeMaterial.backFaceCulling = false;
    const roadMaterial = matte(scene, 'roadFarMat', paletteColor('stone.light'));
    // The surface is a hand-built grid with no side orientation of its own; the
    // camera is always above it, so there is nothing to cull (see `./road.ts`).
    roadMaterial.backFaceCulling = false;
    // No kerb: there is one set of kerbs down the whole road and it belongs to
    // the near half. Painting it from here would paint it in the *next* span's
    // biome, which is the inversion the Phase C probe measured.
    this.ground = {
      road: roadMaterial,
      field: matte(scene, 'fieldFarMat', paletteColor('grass.light')),
      fringe: fringeMaterial,
    };
    // The near half's own albedos, not a second set of them: `tiledAlbedo`
    // builds a texture per call, and four more copies of the two biomes'
    // ground would be megabytes of texture memory nothing ever draws.
    applyGround(this.ground, albedos, 'meadow');

    this.surface = createRoadSurface(scene);
    this.surface.material = roadMaterial;
    this.field = CreateGround('fieldFar', { width: fieldWidth, height: 1 }, scene);
    this.field.material = this.ground.field;
    this.field.position.y = -0.06;
    this.fringe = CreateGround('grassFringeFar', { width: FRINGE_WIDTH, height: 1 }, scene);
    this.fringe.material = fringeMaterial;
    this.fringe.position.y = -0.02;
    this.fringeMatrices = createMatrixBuffer(this.fringe, 2);

    for (const mesh of [this.surface, this.field, this.fringe]) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.setEnabled(false);
    }
  }

  /** The three materials, for the road's own freeze pass. */
  get materials(): readonly StandardMaterial[] {
    return [this.ground.road, this.ground.field, this.ground.fringe];
  }

  /**
   * Which biomes this road runs through and how long a span of one is (D52).
   *
   * An empty list — every campaign level — puts this half away and leaves the
   * near one covering the whole road, which is exactly what the road was before
   * Endless existed.
   */
  setSpans(
    biomes: readonly BiomeId[],
    span: number,
    albedos: ReadonlyMap<string, Texture>,
  ): void {
    this.cycle = biomes.length > 1 && span > 0 ? biomes : [];
    this.spanMetres = this.cycle.length > 1 ? span : 0;
    this.index = 0;
    if (!this.active) {
      for (const mesh of [this.surface, this.field, this.fringe]) mesh.setEnabled(false);
      return;
    }
    this.setSpan(0, albedos);
  }

  /**
   * The span the camera now stands in. This half is painted in the *next*
   * span's biome and starts at the boundary ahead — so the biome the player is
   * walking into is on the road before they reach it.
   */
  setSpan(index: number, albedos: ReadonlyMap<string, Texture>): void {
    if (!this.active) return;
    this.index = Math.max(0, index);
    const id = this.cycle[(this.index + 1) % this.cycle.length] ?? 'meadow';
    this.tiles = BIOME_GROUND[id];
    applyGround(this.ground, albedos, id);
  }

  /** True while the road is drawn as two spans. */
  get active(): boolean {
    return this.cycle.length > 1 && this.spanMetres > 0;
  }

  /**
   * Where the near half stops and this one starts: the boundary ahead of the
   * span the camera is in, or the road's own end when there are no spans.
   */
  splitAt(startZ: number, surfaceEnd: number): number {
    if (!this.active) return surfaceEnd;
    return Math.min(surfaceEnd, Math.max(startZ, (this.index + 1) * this.spanMetres));
  }

  /**
   * Lays this half over everything past `split`.
   *
   * The verge stops where the dressing does, exactly as the near half's does:
   * past the run-out the road is a bare surface running into the fog, and a
   * grass band out there would be a green line in the haze.
   */
  layout(split: number, surfaceEnd: number, dressedEnd: number, retile: Retile): void {
    if (!this.active) return;
    const length = Math.max(1, surfaceEnd - split);
    const centre = (split + surfaceEnd) / 2;

    for (const mesh of [this.field, this.surface]) mesh.unfreezeWorldMatrix();
    this.field.scaling.z = length;
    this.field.position.z = centre;
    this.surface.scaling.z = length;
    this.surface.position.z = centre;

    const road = this.tiles.roadTile;
    const verge = this.tiles.vergeTile;
    retile(this.surface.material, (ROAD_HALF_WIDTH * 2) / road, length / road);
    retile(this.field.material, this.fieldWidth / verge, length / verge);

    const dressed = Math.max(0, dressedEnd - split);
    const fringeX = ROAD_HALF_WIDTH - FRINGE_OVERLAP + FRINGE_WIDTH / 2;
    if (dressed > 0) {
      retile(this.fringe.material, FRINGE_WIDTH / verge, dressed / verge);
      for (let i = 0; i < 2; i++) {
        // Turned rather than mirrored: a negative scale reverses the winding
        // and the ramp has to run road-to-field on both sides.
        const side = i === 0 ? -1 : 1;
        writeRotatedInstance(
          this.fringeMatrices,
          i,
          1,
          1,
          dressed,
          side < 0 ? Math.PI : 0,
          side * fringeX,
          0,
          split + dressed / 2,
        );
      }
    }
    commitInstances(this.fringe, dressed > 0 ? 2 : 0);

    for (const mesh of [this.field, this.surface]) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
      mesh.setEnabled(true);
    }
    this.fringe.setEnabled(true);
  }

  dispose(): void {
    for (const mesh of [this.surface, this.field, this.fringe]) {
      mesh.material?.dispose();
      mesh.dispose();
    }
  }
}

/** `RoadView.retile`, handed in so the tiling rule lives in one place. */
export type Retile = (material: unknown, uScale: number, vScale: number) => void;
