/**
 * The place the run happens in: a cobbled road with kerbs down both edges,
 * grass blending over them into the field, glowing rune strips along the lane
 * boundaries, and the boss arena marked at the far end.
 *
 * Milestone 5 rebuilt it around a real albedo (ambientCG paving stones, CC0)
 * and craft at the edges, because the road is the largest surface in frame and
 * a flat tinted tile was the first thing that read as a prototype (plan, "Road
 * texture bad"). What that means mesh by mesh, from the middle out:
 *
 *   surface  cobbles, with the lane wear and the gutter shading baked into its
 *            vertex colours (`./roadSurface.ts`) so neither costs a draw call
 *   kerbs    one chamfered stone repeated down both edges, thin-instanced
 *   fringe   a band of grass overlapping the kerb and fading into the field
 *   field    the open grass either side
 *   runes    the four lane boundaries, the one glowing thing on the ground
 *   arena    the band across the road at the boss, and a pillar-and-banner
 *            marker either side of it (KayKit Dungeon Remastered, D39)
 *   motes    slow specks of spell-coloured light drifting over all of it
 *
 * One pooled set of static meshes, re-stretched per level and then frozen: the
 * road never moves, so paying for a world-matrix recompute every frame on the
 * largest meshes in the scene would be pure waste. The sky moved out to
 * `./sky.ts` in Milestone 5; only the motes are written per frame here.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { ArenaMarkers } from './arena';
import { createBandOpacity, tiledAlbedo } from './artTextures';
import {
  commitInstances,
  createMatrixBuffer,
  writeInstance,
  writeRotatedInstance,
} from './instanceBuffer';
import { MotesView } from './motes';
import {
  COBBLE_TILE_METRES,
  FRINGE_OVERLAP,
  FRINGE_WIDTH,
  GRASS_TILE_METRES,
  KERB_GAP,
  KERB_LENGTH,
  KERB_OVERLAP,
  KERB_WIDTH,
  LANE_RUNE_WIDTH,
  ROAD_FILLER,
  ROAD_RUNOUT,
  RUNE_EMISSIVE,
  RUNE_PULSE_DEPTH,
  RUNE_PULSE_RATE,
} from './roadLook';
import { createKerbPiece, createRoadSurface } from './roadSurface';
import { createStoneTexture } from './textures';
import { applyToonRamp } from './toonRamp';
import { ARENA_COLOR, LANE_LINE_COLOR, ROAD_HALF_WIDTH, paletteColor } from './theme';

/** Lane boundaries for a three-lane road: the two edges and the two splits. */
const LINE_X = [-ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH];
/**
 * The field is only there to give the road an edge to read against. It is far
 * wider than the road so its own edges never come into frame, even in landscape.
 */
const FIELD_WIDTH = 240;
/**
 * Kerb stones the pool holds, both sides together. A level-10 road is about
 * 560 m of dressed edge per side, which is 340 stones; the cap is what a level
 * half again as long would need, and a longer one simply stops kerbing where
 * the player will never be.
 */
const KERB_CAPACITY = 800;

export class RoadView {
  private readonly surface: Mesh;
  private readonly field: Mesh;
  private readonly kerbs: Mesh;
  private readonly kerbMatrices: Float32Array;
  private readonly fringe: Mesh;
  private readonly fringeMatrices: Float32Array;
  private readonly runes: Mesh;
  private readonly runeMatrices: Float32Array;
  private readonly runeMaterial: StandardMaterial;
  private readonly materials: StandardMaterial[];
  private readonly textures: BaseTexture[] = [];
  private readonly arenaBand: Mesh;
  private readonly motes: MotesView;

  /** The pillar-and-banner markers beside the arena band (`./arena.ts`). */
  private readonly arena: ArenaMarkers;

  private cobbleScale = 1;
  private grassScale = 1;
  private phase = 0;

  constructor(scene: Scene) {
    const roadMaterial = matte(scene, 'roadMat', paletteColor('stone.light'));
    this.cobbleScale = (ROAD_HALF_WIDTH * 2) / COBBLE_TILE_METRES;
    this.textures.push(
      tiledAlbedo(scene, roadMaterial, 'texture_road_cobble', this.cobbleScale, 1),
    );

    const fieldMaterial = matte(scene, 'fieldMat', paletteColor('grass.light'));
    this.grassScale = FIELD_WIDTH / GRASS_TILE_METRES;
    this.textures.push(
      tiledAlbedo(scene, fieldMaterial, 'texture_field_grass', this.grassScale, 1),
    );

    // The fringe is the same grass one step lighter, so the verge reads as the
    // sunlit edge of the field rather than as a second kind of grass.
    const fringeMaterial = matte(scene, 'fringeMat', paletteColor('grass.base'));
    this.textures.push(
      tiledAlbedo(scene, fringeMaterial, 'texture_field_grass', FRINGE_WIDTH / GRASS_TILE_METRES, 1),
    );
    // Alpha across the band: nothing where it lies on the kerb, solid a third of
    // the way out, gone again at the field. Both ends matter — the inner one
    // hides the strip's own edge behind the stone, the outer one is what makes
    // the field and the verge one surface instead of two.
    const fringeOpacity = createBandOpacity(scene, 'grassFringe', [
      [0, 0],
      [0.22, 0.95],
      [0.6, 0.85],
      [1, 0],
    ]);
    fringeMaterial.opacityTexture = fringeOpacity;
    fringeMaterial.backFaceCulling = false;
    this.textures.push(fringeOpacity);

    const kerbMaterial = matte(scene, 'kerbMat', paletteColor('stone.kerb'));
    // A fine grain on the cut stone: without it the kerb is a flat band of
    // colour beside a photographic road, which is exactly where a cheap edge
    // shows.
    const kerbGrain = createStoneTexture(scene, { base: 0.98, variance: 0.06, cool: -0.02 });
    kerbGrain.uScale = 2;
    kerbGrain.vScale = 1;
    kerbMaterial.diffuseTexture = kerbGrain;
    this.textures.push(kerbGrain);

    this.runeMaterial = glow(scene, 'laneRuneMat', LANE_LINE_COLOR, RUNE_EMISSIVE);
    const arenaMaterial = glow(scene, 'arenaMat', ARENA_COLOR, 0.8);

    // Unit-length strips: `setExtent` scales them along z, so one build serves
    // every level length.
    this.field = CreateGround('field', { width: FIELD_WIDTH, height: 1 }, scene);
    this.field.material = fieldMaterial;
    this.field.position.y = -0.06;

    this.surface = createRoadSurface(scene);
    this.surface.material = roadMaterial;
    // The road is a hand-built grid, and a mesh built from `VertexData` carries
    // no side orientation of its own, so Babylon's back-face test is a coin
    // toss on it — one that came up "no road at all" the first time. The camera
    // is always above a flat ground, so there is nothing to cull.
    roadMaterial.backFaceCulling = false;

    this.fringe = CreateGround('grassFringe', { width: FRINGE_WIDTH, height: 1 }, scene);
    this.fringe.material = fringeMaterial;
    this.fringe.position.y = -0.02;
    this.fringeMatrices = createMatrixBuffer(this.fringe, 2);

    this.kerbs = createKerbPiece(scene);
    this.kerbs.material = kerbMaterial;
    this.kerbMatrices = createMatrixBuffer(this.kerbs, KERB_CAPACITY);

    // Four strips of one mesh rather than four meshes: the runes are the same
    // material at four x offsets, which is exactly what thin instances are for.
    this.runes = CreateGround('laneRunes', { width: LANE_RUNE_WIDTH, height: 1 }, scene);
    this.runes.material = this.runeMaterial;
    this.runes.position.y = 0.02;
    this.runeMatrices = createMatrixBuffer(this.runes, LINE_X.length);

    this.arenaBand = CreateGround('arenaBand', { width: ROAD_HALF_WIDTH * 2, height: 1 }, scene);
    this.arenaBand.material = arenaMaterial;
    this.arenaBand.position.y = 0.04;
    this.arenaBand.scaling.z = 0.5;

    this.motes = new MotesView(scene);
    this.arena = new ArenaMarkers(scene);

    for (const mesh of [this.field, this.surface, this.arenaBand]) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
    }

    this.materials = [
      roadMaterial,
      fieldMaterial,
      fringeMaterial,
      kerbMaterial,
      this.runeMaterial,
      arenaMaterial,
    ];
    // The kerb only. The ground materials are deliberately flat (`./toonRamp.ts`
    // leaves hand-built `StandardMaterial`s alone), and a flat plane has one
    // normal anyway — the ramp would be a constant. A kerb is a box, and the
    // ramp is what separates its top face from the two it can be seen from.
    applyToonRamp(kerbMaterial);

    // Kicked off here so a renderer that never awaits `load` still gets its
    // arena markers; `load` hands back that same promise, so a caller that does
    // await it (and the warm-up pass behind it) waits for the real thing.
    void this.load();
  }

  /**
   * The arena markers' dungeon pieces. Idempotent, and safe to await from
   * `SceneViews.load` — which is where it belongs, so the warm-up pass sees the
   * material before the first frame rather than compiling it at the arena.
   */
  load(): Promise<void> {
    return this.arena.load();
  }

  /**
   * Locks every material here against the per-frame readiness check.
   *
   * Called once, after the scene's first `whenReadyAsync` — freezing a material
   * whose effect is still compiling would leave it never drawn. `freeze` only
   * skips `isReady`; uniforms and texture scales are still bound each frame, so
   * the rune pulse and a per-level re-tiling of the cobbles still land.
   */
  freeze(): void {
    for (const material of this.materials) material.freeze();
    // Identity world matrices for the life of the view: these are drawn
    // entirely through their thin-instance buffers.
    for (const mesh of [this.runes, this.kerbs, this.fringe]) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
    }
    this.arena.freeze();
  }

  /** Re-stretches the road for a level. Everything is frozen again afterwards. */
  setExtent(startZ: number, endZ: number, arenaZ: number): void {
    // The dressed road runs past the level's own end, and the bare surface runs
    // past *that* to the horizon: the fog reaches 260 m and the camera can stand
    // at the arena looking down the rest of it (`./roadLook.ts`).
    const dressedEnd = endZ + ROAD_RUNOUT;
    const surfaceEnd = dressedEnd + ROAD_FILLER;
    const surfaceLength = Math.max(1, surfaceEnd - startZ);
    const surfaceCentre = (startZ + surfaceEnd) / 2;
    const dressedLength = Math.max(1, dressedEnd - startZ);
    const dressedCentre = (startZ + dressedEnd) / 2;

    for (const mesh of [this.field, this.surface, this.arenaBand]) mesh.unfreezeWorldMatrix();

    this.field.scaling.z = surfaceLength;
    this.field.position.z = surfaceCentre;

    this.surface.scaling.z = surfaceLength;
    this.surface.position.z = surfaceCentre;
    // The cobble tile is 2.2 m of road either way, so the stones stay square
    // however long the level is.
    this.retile(this.surface.material, this.cobbleScale, surfaceLength / COBBLE_TILE_METRES);
    this.retile(this.field.material, this.grassScale, surfaceLength / GRASS_TILE_METRES);
    this.retile(
      this.fringe.material,
      FRINGE_WIDTH / GRASS_TILE_METRES,
      dressedLength / GRASS_TILE_METRES,
    );

    for (let i = 0; i < LINE_X.length; i++) {
      writeInstance(this.runeMatrices, i, 1, 1, surfaceLength, LINE_X[i] ?? 0, 0, surfaceCentre);
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
        dressedLength,
        side < 0 ? Math.PI : 0,
        side * fringeX,
        0,
        dressedCentre,
      );
    }
    commitInstances(this.fringe, 2);

    this.layKerbs(startZ, dressedEnd);

    this.arenaBand.position.z = arenaZ;
    this.arena.place(arenaZ);

    for (const mesh of [this.field, this.surface, this.arenaBand]) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
      mesh.setEnabled(true);
    }
  }

  /**
   * The runes breathe and the motes drift. Both are cosmetic, and both are one
   * pass a frame: no mesh here is rebuilt or re-transformed.
   */
  update(cameraX: number, cameraZ: number, dt: number): void {
    this.phase += dt * RUNE_PULSE_RATE;
    const pulse = 1 + Math.sin(this.phase * Math.PI * 2) * RUNE_PULSE_DEPTH;
    LANE_LINE_COLOR.scaleToRef(RUNE_EMISSIVE * pulse, this.runeMaterial.emissiveColor);
    this.motes.update(cameraX, cameraZ, dt);
  }

  /** Motes drawn last frame, for the debug panel. */
  get moteCount(): number {
    return this.motes.drawn;
  }

  dispose(): void {
    for (const mesh of this.allMeshes()) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
    this.arena.dispose();
    this.motes.dispose();
  }

  private allMeshes(): Mesh[] {
    return [this.field, this.surface, this.fringe, this.kerbs, this.runes, this.arenaBand];
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

  /**
   * Re-tiles a material's albedo for a level's length.
   *
   * `diffuseTexture` is typed as the base class, which carries no uv scale —
   * only the 2D textures do, and both the loaded albedo and the painted
   * fallback are `Texture`s. Anything else is left alone rather than asserted
   * about.
   */
  private retile(material: unknown, uScale: number, vScale: number): void {
    if (!(material instanceof StandardMaterial)) return;
    const texture = material.diffuseTexture;
    if (!(texture instanceof Texture)) return;
    texture.uScale = uScale;
    texture.vScale = vScale;
  }

}

function matte(scene: Scene, name: string, color: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = Color3.Black();
  return material;
}

function glow(scene: Scene, name: string, color: Color3, strength: number): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color.scale(0.2);
  material.emissiveColor = color.scale(strength);
  material.specularColor = Color3.Black();
  return material;
}
