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
 *
 * ## Two spans at once (D52)
 *
 * The endless road changes biome as it is walked, and the fog reaches 260 m
 * against a span of about 216 — so the player can see the next biome's road
 * before reaching it, and must. The surface, the field and the verge therefore
 * come in *pairs*: a near half from the road's start to the boundary ahead, and
 * a far half from that boundary onward, each with its own three materials. Six
 * meshes rather than three, six draw calls rather than three, and only while a
 * spanned road is loaded — a campaign level disables the far half entirely and
 * draws exactly what it always drew.
 *
 * The kerbs and the lane runes are deliberately *not* split. They are thin
 * strips of the palette's own stone and violet, they are read at a few metres
 * rather than at two hundred, and splitting them would be two more draw calls
 * and two more instance buffers for a colour change nobody can see at the
 * distance a boundary is crossed from.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { ArenaMarkers } from './arena';
import { createBandOpacity } from './artTextures';
import { MotesView } from './motes';
import {
  BIOME_GROUND,
  FRINGE_WIDTH,
  ROAD_FILLER,
  ROAD_RUNOUT,
  RUNE_EMISSIVE,
  RUNE_PULSE_DEPTH,
  RUNE_PULSE_RATE,
} from './roadLook';
import { RoadDressing } from './roadDressing';
import { RoadFarHalf } from './roadFar';
import { applyGround, buildGroundAlbedos, glow, matte, retileTo } from './roadGround';
import type { GroundMaterials } from './roadGround';
import { createRoadSurface } from './roadSurface';
import { createStoneTexture } from './textures';
import { applyToonRamp } from './toonRamp';
import { ARENA_COLOR, LANE_LINE_COLOR, ROAD_HALF_WIDTH, paletteBiome, paletteColor } from './theme';
import type { BiomeGround } from './roadLook';
import type { BiomeId } from '@/data/biome-types';

/**
 * The field is only there to give the road an edge to read against. It is far
 * wider than the road so its own edges never come into frame, even in landscape.
 */
const FIELD_WIDTH = 240;

export class RoadView {
  private readonly surface: Mesh;
  private readonly field: Mesh;
  /** The far half of a spanned road (D52); idle on a campaign level. */
  private readonly far: RoadFarHalf;
  /** The kerbs, the verge and the lane runes (`./roadDressing.ts`). */
  private readonly dressing: RoadDressing;
  private readonly runeMaterial: StandardMaterial;
  private readonly materials: StandardMaterial[];
  private readonly textures: BaseTexture[] = [];
  private readonly arenaBand: Mesh;
  private readonly motes: MotesView;

  /** The pillar-and-banner markers beside the arena band (`./arena.ts`). */
  private readonly arena: ArenaMarkers;

  /**
   * Both biomes' ground albedos, built at boot and swapped by `setBiome`.
   *
   * At boot rather than on the switch, because the warm-up pass runs once
   * before the title screen: a texture created at a level load would be the one
   * thing in the scene the pass never saw, and it would upload inside the first
   * frame that drew the road (`src/render/warmup.ts`). Two 1024 and two 512
   * albedos is a few hundred kilobytes of texture memory for a switch that
   * costs one reference assignment.
   */
  private readonly albedos: Map<string, Texture>;
  /** The four materials a biome repaints; see `./roadGround.ts`. */
  private readonly ground: GroundMaterials;

  /** The biome's tile sizes, and the extent the road was last stretched to. */
  private tiles: BiomeGround = BIOME_GROUND.meadow;
  private extent: { startZ: number; endZ: number; arenaZ: number } | null = null;

  private phase = 0;

  constructor(scene: Scene) {
    const roadMaterial = matte(scene, 'roadMat', paletteColor('stone.light'));
    const fieldMaterial = matte(scene, 'fieldMat', paletteColor('grass.light'));
    // The fringe is the same verge one step darker, so it reads as the edge of
    // the field rather than as a second kind of ground.
    const fringeMaterial = matte(scene, 'fringeMat', paletteColor('grass.base'));

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
    // The far verge's band shares this one ramp: it is the same shape.
    this.textures.push(fringeOpacity);

    const kerbMaterial = matte(scene, 'kerbMat', paletteColor('stone.kerb'));
    this.ground = {
      road: roadMaterial,
      field: fieldMaterial,
      fringe: fringeMaterial,
      kerb: kerbMaterial,
    };
    this.albedos = buildGroundAlbedos(scene, this.ground, ROAD_HALF_WIDTH * 2, FIELD_WIDTH);
    // The far half (D52), built here rather than at the first spanned load so
    // the boot warm-up compiles it with everything else (`./roadFar.ts`).
    this.far = new RoadFarHalf(scene, FIELD_WIDTH, fringeOpacity, this.albedos);
    for (const albedo of this.albedos.values()) this.textures.push(albedo);
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

    this.dressing = new RoadDressing(scene, {
      kerb: kerbMaterial,
      fringe: fringeMaterial,
      rune: this.runeMaterial,
    });

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
      ...this.far.materials,
      this.runeMaterial,
      arenaMaterial,
    ];
    // The kerb only. The ground materials are deliberately flat (`./toonRamp.ts`
    // leaves hand-built `StandardMaterial`s alone), and a flat plane has one
    // normal anyway — the ramp would be a constant. A kerb is a box, and the
    // ramp is what separates its top face from the two it can be seen from.
    applyToonRamp(kerbMaterial);

    // The palette is already on whatever biome the app asked for (`Renderer.init`
    // switches it before any view is built), so this is what puts the matching
    // albedo back on each material after the loop above built all of them.
    this.setBiome(paletteBiome());

    // Kicked off here so a renderer that never awaits `load` still gets its
    // arena markers; `load` hands back that same promise, so a caller that does
    // await it (and the warm-up pass behind it) waits for the real thing.
    void this.load();
  }

  /**
   * Puts a biome's ground under the road (D49): its two albedos, and the
   * palette's colours over them.
   *
   * Nothing is created or destroyed here. The albedos were all built at boot
   * (see `albedos`), the colours are the same shared `Color3`s the palette has
   * already rewritten in place (`setBiome` in `./palette.ts`), and the tiling
   * follows from the biome's own tile sizes at the extent the road is already
   * stretched to. That is what keeps ten level loads from leaving ten textures
   * and ten materials behind.
   */
  setBiome(id: BiomeId): void {
    this.tiles = BIOME_GROUND[id];
    applyGround(this.ground, this.albedos, id);
    // The arena's markers are dungeon stone and take the biome's tint the same
    // way the roadside's do.
    this.arena.setBiome();
    const extent = this.extent;
    if (extent !== null) this.setExtent(extent.startZ, extent.endZ, extent.arenaZ);
  }

  /**
   * Which biomes this road runs through and how long a span of one is (D52).
   * The far half owns the answer; this hands it on and re-lays the road.
   */
  setSpans(biomes: readonly BiomeId[], span: number): void {
    this.far.setSpans(biomes, span, this.albedos);
    this.relayout();
  }

  /** The span the camera now stands in; see `RoadFarHalf.setSpan`. */
  setSpanIndex(index: number): void {
    if (!this.far.active) return;
    this.far.setSpan(index, this.albedos);
    this.relayout();
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
    this.dressing.freeze();
    this.arena.freeze();
  }

  /** Re-stretches the road for a level. Everything is frozen again afterwards. */
  setExtent(startZ: number, endZ: number, arenaZ: number): void {
    // Remembered so a biome switch can re-tile without being told again.
    this.extent = { startZ, endZ, arenaZ };
    // The dressed road runs past the level's own end, and the bare surface runs
    // past *that* to the horizon: the fog reaches 260 m and the camera can stand
    // at the arena looking down the rest of it (`./roadLook.ts`).
    const dressedEnd = endZ + ROAD_RUNOUT;
    const surfaceEnd = dressedEnd + ROAD_FILLER;
    // Where the near half stops and the far half starts: the boundary ahead of
    // the span the camera is in (D52), or the end of the road on a campaign
    // level, where the near half is the whole thing.
    const split = this.far.splitAt(startZ, surfaceEnd);
    const surfaceLength = Math.max(1, split - startZ);
    const surfaceCentre = (startZ + split) / 2;
    const dressedLength = Math.max(1, Math.min(dressedEnd, split) - startZ);
    const dressedCentre = (startZ + Math.min(dressedEnd, split)) / 2;

    for (const mesh of [this.field, this.surface, this.arenaBand]) mesh.unfreezeWorldMatrix();

    this.field.scaling.z = surfaceLength;
    this.field.position.z = surfaceCentre;

    this.surface.scaling.z = surfaceLength;
    this.surface.position.z = surfaceCentre;
    // The tile is the same number of metres either way, so the stones — or the
    // slabs of ice — stay square however long the level is.
    const road = this.tiles.roadTile;
    const verge = this.tiles.vergeTile;
    retileTo(this.surface.material, (ROAD_HALF_WIDTH * 2) / road, surfaceLength / road);
    retileTo(this.field.material, FIELD_WIDTH / verge, surfaceLength / verge);
    retileTo(this.dressing.fringe.material, FRINGE_WIDTH / verge, dressedLength / verge);
    this.far.layout(split, surfaceEnd, dressedEnd, retileTo);

    this.dressing.lay({
      startZ,
      surfaceLength,
      surfaceCentre,
      dressedEnd,
      dressedLength,
      dressedCentre,
    });

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
    this.far.dispose();
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
    return [this.field, this.surface, ...this.dressing.meshes, this.arenaBand];
  }

  /** Re-stretches the road at the extent it already has, if it has one. */
  private relayout(): void {
    const extent = this.extent;
    if (extent !== null) this.setExtent(extent.startZ, extent.endZ, extent.arenaZ);
  }
}

