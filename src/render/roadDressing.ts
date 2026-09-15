/**
 * The road's edges: the kerb stones, the grass verge over them and the four
 * lane runes.
 *
 * Split out of `./road.ts` in Milestone 8 Phase E for the file-size rule
 * (CLAUDE.md), on the seam the road already had. The three ground meshes there
 * are *surfaces* — one quad each, stretched to the level's length, and split in
 * two on a spanned road (D52) because a biome boundary runs across them. These
 * three are *dressing*: thin-instanced strips laid down the edges of whatever
 * the surface turned out to be, read at a few metres rather than at two
 * hundred, and deliberately not split by biome (`./road.ts` says why).
 *
 * One object because they are laid together: every one of them is a function of
 * the same two spans the road was just stretched to, and a level load writes all
 * three buffers or none.
 */

import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import {
  commitInstances,
  createMatrixBuffer,
  writeInstance,
  writeRotatedInstance,
} from './instanceBuffer';
import {
  FRINGE_OVERLAP,
  FRINGE_WIDTH,
  KERB_GAP,
  KERB_LENGTH,
  KERB_OVERLAP,
  KERB_WIDTH,
  LANE_RUNE_WIDTH,
} from './roadLook';
import { createKerbPiece } from './roadSurface';
import { ROAD_HALF_WIDTH } from './theme';

/** Lane boundaries for a three-lane road: the two edges and the two splits. */
const LINE_X = [-ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH];

/**
 * Kerb stones the pool holds, both sides together. A level-10 road is about
 * 560 m of dressed edge per side, which is 340 stones; the cap is what a level
 * half again as long would need, and a longer one simply stops kerbing where
 * the player will never be.
 */
const KERB_CAPACITY = 800;

/** Where the dressing runs, in metres: the surface it edges and the part of it
 *  that is dressed at all (the bare surface runs on to the horizon). */
export interface RoadSpanLayout {
  startZ: number;
  surfaceLength: number;
  surfaceCentre: number;
  dressedEnd: number;
  dressedLength: number;
  dressedCentre: number;
}

export class RoadDressing {
  readonly kerbs: Mesh;
  readonly fringe: Mesh;
  readonly runes: Mesh;

  private readonly kerbMatrices: Float32Array;
  private readonly fringeMatrices: Float32Array;
  private readonly runeMatrices: Float32Array;
  /** The three, for the road's own freeze and dispose passes. */
  private readonly all: readonly Mesh[];

  constructor(
    scene: Scene,
    materials: { kerb: StandardMaterial; fringe: StandardMaterial; rune: StandardMaterial },
  ) {
    this.fringe = CreateGround('grassFringe', { width: FRINGE_WIDTH, height: 1 }, scene);
    this.fringe.material = materials.fringe;
    this.fringe.position.y = -0.02;
    this.fringeMatrices = createMatrixBuffer(this.fringe, 2);

    this.kerbs = createKerbPiece(scene);
    this.kerbs.material = materials.kerb;
    this.kerbMatrices = createMatrixBuffer(this.kerbs, KERB_CAPACITY);

    // Four strips of one mesh rather than four meshes: the runes are the same
    // material at four x offsets, which is exactly what thin instances are for.
    this.runes = CreateGround('laneRunes', { width: LANE_RUNE_WIDTH, height: 1 }, scene);
    this.runes.material = materials.rune;
    this.runes.position.y = 0.02;
    this.runeMatrices = createMatrixBuffer(this.runes, LINE_X.length);
    this.all = [this.fringe, this.kerbs, this.runes];
  }

  /** The three meshes, for the road's own dispose and freeze passes. */
  get meshes(): readonly Mesh[] {
    return this.all;
  }

  /**
   * Identity world matrices for the life of the view: all three are drawn
   * entirely through their thin-instance buffers.
   */
  freeze(): void {
    for (const mesh of this.meshes) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
    }
  }

  /** Lays all three down the road the surface was just stretched to. */
  lay(span: RoadSpanLayout): void {
    for (let i = 0; i < LINE_X.length; i++) {
      writeInstance(
        this.runeMatrices,
        i,
        1,
        1,
        span.surfaceLength,
        LINE_X[i] ?? 0,
        0,
        span.surfaceCentre,
      );
    }
    commitInstances(this.runes, LINE_X.length);

    // The verge, one strip a side. The right-hand one is turned rather than
    // mirrored by a negative scale: a negative scale reverses the winding, and
    // the ramp has to run road-to-field on both sides.
    const fringeX = ROAD_HALF_WIDTH - FRINGE_OVERLAP + FRINGE_WIDTH / 2;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      writeRotatedInstance(
        this.fringeMatrices,
        i,
        1,
        1,
        span.dressedLength,
        side < 0 ? Math.PI : 0,
        side * fringeX,
        0,
        span.dressedCentre,
      );
    }
    commitInstances(this.fringe, 2);

    this.layKerbs(span.startZ, span.dressedEnd);
  }

  /** Stones down both edges, from the road's start to where the dressing ends. */
  private layKerbs(startZ: number, endZ: number): void {
    const step = KERB_LENGTH + KERB_GAP;
    const perSide = Math.max(0, Math.floor((endZ - startZ) / step));
    const x = ROAD_HALF_WIDTH + KERB_WIDTH / 2 - KERB_OVERLAP;
    let written = 0;
    for (let i = 0; i < perSide && written + 2 <= KERB_CAPACITY; i++) {
      const z = startZ + step * (i + 0.5);
      writeInstance(this.kerbMatrices, written, 1, 1, 1, -x, 0, z);
      written++;
      writeInstance(this.kerbMatrices, written, 1, 1, 1, x, 0, z);
      written++;
    }
    commitInstances(this.kerbs, written);
  }
}
