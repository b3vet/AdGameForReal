/**
 * The place the run happens in: a pale stone road with glowing rune strips down
 * the lane boundaries, grass either side, the arena band at the far end, and a
 * daylight sky dome behind all of it (D28).
 *
 * One pooled set of static meshes, re-stretched per level and then frozen: the
 * road never moves, so paying for a world-matrix recompute every frame on the
 * largest meshes in the scene would be pure waste. The sky dome is the one
 * thing that follows the camera, because a dome that stays behind is a wall.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { commitInstances, createMatrixBuffer, writeInstance } from './instanceBuffer';
import { createGradientTexture, createStoneTexture } from './textures';
import {
  ARENA_COLOR,
  FIELD_COLOR,
  LANE_LINE_COLOR,
  ROAD_COLOR,
  ROAD_HALF_WIDTH,
  SKY_HAZE,
  SKY_HORIZON,
  SKY_MID,
  SKY_ZENITH,
} from './theme';

/** Lane boundaries for a three-lane road: the two edges and the two splits. */
const LINE_X = [-ROAD_HALF_WIDTH, -ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH / 3, ROAD_HALF_WIDTH];
const LINE_WIDTH = 0.12;
/**
 * The field is only there to give the road an edge to read against. It is far
 * wider than the road so its own edges never come into frame, even in landscape.
 */
const FIELD_WIDTH = 240;
/** Metres of road one repeat of the stone tile covers. */
const STONE_TILE_METRES = 2.4;
/** Big enough to sit outside the far fog and the camera's own far plane. */
const SKY_RADIUS = 190;
/** Rune pulse: cycles per second, and how far the emissive swings. */
const RUNE_PULSE_RATE = 0.6;
const RUNE_PULSE_DEPTH = 0.35;
/** How hot the rune strips run. See `glow`, and the pulse in `update`. */
const RUNE_EMISSIVE = 0.95;

export class RoadView {
  private readonly surface: Mesh;
  private readonly field: Mesh;
  private readonly runes: Mesh;
  private readonly runeMatrices: Float32Array;
  private readonly runeMaterial: StandardMaterial;
  private readonly materials: StandardMaterial[];
  private readonly arenaBand: Mesh;
  private readonly arenaPosts: Mesh;
  private readonly arenaPostMatrices: Float32Array;
  private readonly sky: Mesh;
  private readonly stone: DynamicTexture;

  private phase = 0;

  constructor(scene: Scene) {
    // Light and warm rather than Milestone 2's dark grey: the road is the big
    // bright surface the whole frame reads against now, and the tile only
    // carries the pattern — `ROAD_COLOR` carries the colour.
    this.stone = createStoneTexture(scene, { base: 0.88, variance: 0.1, cool: -0.05 });

    const roadMaterial = matte(scene, 'roadMat', ROAD_COLOR);
    roadMaterial.diffuseTexture = this.stone;
    const fieldMaterial = matte(scene, 'fieldMat', FIELD_COLOR);
    // Brighter than Milestone 2's: an emissive line has to out-shout a lit
    // stone road now, not a near-black one.
    this.runeMaterial = glow(scene, 'laneRuneMat', LANE_LINE_COLOR, RUNE_EMISSIVE);
    const arenaMaterial = glow(scene, 'arenaMat', ARENA_COLOR, 0.8);

    // Unit-length strips: `setExtent` scales them along z, so one build serves
    // every level length.
    this.field = CreateGround('field', { width: FIELD_WIDTH, height: 1 }, scene);
    this.field.material = fieldMaterial;
    this.field.position.y = -0.06;

    this.surface = CreateGround('road', { width: ROAD_HALF_WIDTH * 2, height: 1 }, scene);
    this.surface.material = roadMaterial;

    // Four strips of one mesh rather than four meshes: the runes are the same
    // material at four x offsets, which is exactly what thin instances are for.
    this.runes = CreateGround('laneRunes', { width: LINE_WIDTH, height: 1 }, scene);
    this.runes.material = this.runeMaterial;
    this.runes.position.y = 0.02;
    this.runeMatrices = createMatrixBuffer(this.runes, LINE_X.length);

    this.arenaBand = CreateGround('arenaBand', { width: ROAD_HALF_WIDTH * 2, height: 1 }, scene);
    this.arenaBand.material = arenaMaterial;
    this.arenaBand.position.y = 0.04;
    this.arenaBand.scaling.z = 0.5;

    this.arenaPosts = CreateBox('arenaPost', { width: 0.22, height: 2.2, depth: 0.22 }, scene);
    this.arenaPosts.material = arenaMaterial;
    this.arenaPostMatrices = createMatrixBuffer(this.arenaPosts, 2);

    this.sky = buildSky(scene);

    for (const mesh of [this.field, this.surface, this.arenaBand]) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
    }

    const skyMaterial = this.sky.material;
    this.materials = [roadMaterial, fieldMaterial, this.runeMaterial, arenaMaterial];
    if (skyMaterial instanceof StandardMaterial) this.materials.push(skyMaterial);
  }

  /**
   * Locks every material here against the per-frame readiness check.
   *
   * Called once, after the scene's first `whenReadyAsync` — freezing a material
   * whose effect is still compiling would leave it never drawn. `freeze` only
   * skips `isReady`; uniforms and texture scales are still bound each frame, so
   * the rune pulse and a per-level re-tiling of the stone still land.
   */
  freeze(): void {
    for (const material of this.materials) material.freeze();
    // Identity world matrices for the life of the view: both meshes are drawn
    // entirely through their thin-instance buffers.
    for (const mesh of [this.runes, this.arenaPosts]) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
    }
  }

  /** Re-stretches the road for a level. Everything is frozen again afterwards. */
  setExtent(startZ: number, endZ: number, arenaZ: number): void {
    const length = Math.max(1, endZ - startZ);
    const centerZ = (startZ + endZ) / 2;

    for (const mesh of [this.field, this.surface, this.arenaBand]) mesh.unfreezeWorldMatrix();

    this.field.scaling.z = length;
    this.field.position.z = centerZ;

    this.surface.scaling.z = length;
    this.surface.position.z = centerZ;
    // The tile is 2.4 m of road either way, so the cobbles stay square however
    // long the level is.
    this.stone.uScale = (ROAD_HALF_WIDTH * 2) / STONE_TILE_METRES;
    this.stone.vScale = length / STONE_TILE_METRES;

    for (let i = 0; i < LINE_X.length; i++) {
      writeInstance(this.runeMatrices, i, 1, 1, length, LINE_X[i] ?? 0, 0, centerZ);
    }
    commitInstances(this.runes, LINE_X.length);

    this.arenaBand.position.z = arenaZ;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      writeInstance(
        this.arenaPostMatrices,
        i,
        1,
        1,
        1,
        side * (ROAD_HALF_WIDTH + 0.2),
        1.1,
        arenaZ,
      );
    }
    commitInstances(this.arenaPosts, 2);

    for (const mesh of [this.field, this.surface, this.arenaBand]) {
      mesh.computeWorldMatrix(true);
      mesh.freezeWorldMatrix();
      mesh.setEnabled(true);
    }
  }

  /**
   * The runes breathe and the sky follows the camera. Both are cosmetic, and
   * both are one write a frame: no mesh here is rebuilt or re-transformed.
   */
  update(cameraX: number, cameraZ: number, dt: number): void {
    this.phase += dt * RUNE_PULSE_RATE;
    const pulse = 1 + Math.sin(this.phase * Math.PI * 2) * RUNE_PULSE_DEPTH;
    LANE_LINE_COLOR.scaleToRef(RUNE_EMISSIVE * pulse, this.runeMaterial.emissiveColor);
    this.sky.position.set(cameraX, 0, cameraZ);
  }

  dispose(): void {
    for (const mesh of this.allMeshes()) {
      mesh.material?.dispose();
      mesh.dispose();
    }
    this.stone.dispose();
  }

  private allMeshes(): Mesh[] {
    return [this.field, this.surface, this.runes, this.arenaBand, this.arenaPosts, this.sky];
  }
}

/**
 * The sky: an inverted sphere carrying a painted gradient — light blue
 * overhead, falling through a pale haze to a warm band at the horizon that the
 * fog fades the road into (D28).
 *
 * The band below the horizon matters more than it looks: the dome is a full
 * sphere and the ground plane only reaches so far, so on a lateral drag the
 * player briefly sees under the road's edge. Keeping the bottom of the dome the
 * horizon's own colour makes that a haze rather than a hole.
 */
function buildSky(scene: Scene): Mesh {
  const gradient = createGradientTexture(scene, 'skyGradient', [
    { at: 0, r: SKY_HORIZON.r * 0.92, g: SKY_HORIZON.g * 0.9, b: SKY_HORIZON.b * 0.88 },
    { at: 0.47, r: SKY_HORIZON.r, g: SKY_HORIZON.g, b: SKY_HORIZON.b },
    { at: 0.51, r: SKY_HAZE.r, g: SKY_HAZE.g, b: SKY_HAZE.b },
    { at: 0.58, r: SKY_MID.r, g: SKY_MID.g, b: SKY_MID.b },
    { at: 1, r: SKY_ZENITH.r, g: SKY_ZENITH.g, b: SKY_ZENITH.b },
  ]);

  const material = new StandardMaterial('skyMat', scene);
  material.emissiveTexture = gradient;
  // Black, not white: `default.fragment` *adds* the emissive texture to
  // `emissiveColor` rather than multiplying, so a white base clamps the whole
  // dome to white and the gradient never shows.
  material.emissiveColor = Color3.Black();
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  material.backFaceCulling = false;
  // The dome is behind everything by construction; letting it write depth would
  // clip the far end of the road out of the frame.
  material.disableDepthWrite = true;
  material.fogEnabled = false;

  const sky = CreateSphere('sky', { diameter: SKY_RADIUS * 2, segments: 16 }, scene);
  sky.material = material;
  sky.isPickable = false;
  sky.infiniteDistance = false;
  sky.alwaysSelectAsActiveMesh = true;
  // Drawn first, so everything else paints over it.
  sky.renderingGroupId = 0;
  return sky;
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
