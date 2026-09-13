/**
 * `?swatch=1`: a grid of palette chips in front of the camera, and the screen
 * coordinates of each one.
 *
 * This is the instrument the tone mapping was tuned with (D38: "tone mapping in
 * materials"). Babylon's image processing is a *curve* — exposure, then ACES,
 * then gamma, then contrast — so a colour does not come out of it the way it
 * went in, and the only honest way to pick the exposure is to render the
 * palette through the real shader on the real device and read the pixels back.
 * `scripts/` drives it: open the built page with this flag, ask
 * `__swatch.points()` where each chip landed, screenshot, compare each pixel to
 * the hex in `src/data/palette.json`.
 *
 * The chips are unlit — emissive colour, lighting off — so what comes back is
 * the transfer function and nothing else: no key light, no toon ramp, no fog.
 * A lit surface in this scene sits at roughly the same input level (a 0.7
 * ambient plus a 0.6 key, `./scene.ts`), so calibrating on the chips
 * calibrates the road and the crowd with it.
 *
 * Off by every other path. Nothing here is constructed unless the query string
 * asks for it, so the flag costs the shipped game one string comparison at boot.
 */

import type { Camera } from '@babylonjs/core/Cameras/camera';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { palette, paletteHex } from './palette';
import type { PaletteRole } from './palette';

/** Chips across. Five columns of nine rows holds the palette's 43 roles. */
const COLUMNS = 5;
const ROWS = 9;
/** Metres in front of the camera the grid floats at. */
const DISTANCE = 3;
/**
 * Share of the frustum the grid fills at that distance. Under 1 on both axes so
 * every chip is comfortably inside the frame — a chip clipped by an edge is a
 * chip the measuring script cannot read — and the grid is laid out from the
 * camera's own field of view rather than from fixed metres, so it fits whatever
 * the viewport is.
 */
const FILL = 0.86;
/** A chip is this share of its cell; the rest is the gap between them. */
const CHIP_FILL = 0.68;

/** One chip, as the measuring script reads it. */
export interface SwatchPoint {
  role: string;
  hex: string;
  /** Where the chip's centre landed, 0 to 1 across the rendered frame. */
  x: number;
  y: number;
}

interface SwatchHandle {
  ready: boolean;
  points: () => SwatchPoint[];
}

/** True when the URL carries `?swatch` (any value). */
export function swatchesWanted(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('swatch');
}

/**
 * Builds one chip per palette role, parented to the camera so the grid holds
 * still whatever the shot does, and publishes `globalThis.__swatch`.
 *
 * Built before the scene's readiness pass in `Renderer.init`, so the warm-up
 * compiles these materials with everything else and the measured frame is not
 * the frame that compiled them.
 */
export function buildPaletteSwatches(scene: Scene, camera: Camera): void {
  const roles = collectRoles();
  const meshes: Mesh[] = [];
  const engine = scene.getEngine();
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  // The frustum at `DISTANCE`, from the camera's own vertical field of view.
  const frameHeight = 2 * DISTANCE * Math.tan(('fov' in camera ? camera.fov : 0.8) / 2);
  const frameWidth = frameHeight * aspect;
  const cellWidth = (frameWidth * FILL) / COLUMNS;
  const cellHeight = (frameHeight * FILL) / ROWS;
  const chip = Math.min(cellWidth, cellHeight) * CHIP_FILL;

  roles.forEach((role, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const mesh = CreatePlane(`swatch_${role}`, { size: chip }, scene);
    const material = new StandardMaterial(`swatchMat_${role}`, scene);
    material.emissiveColor = Color3.FromHexString(paletteHex(role));
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.ambientColor = Color3.Black();
    material.disableLighting = true;
    // No fog: the chips are three metres away, but the point is the curve, and
    // a fogged chip measures the fog.
    material.fogEnabled = false;
    mesh.material = material;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    // In camera space: x right, y up, z forward. The grid is centred on the
    // frame, which is also where the vignette is weakest.
    mesh.parent = camera;
    mesh.position.set(
      (column - (COLUMNS - 1) / 2) * cellWidth,
      ((ROWS - 1) / 2 - row) * cellHeight,
      DISTANCE,
    );
    meshes.push(mesh);
  });

  const handle: SwatchHandle = {
    ready: true,
    points: () => projectAll(scene, roles, meshes),
  };
  (globalThis as unknown as { __swatch?: SwatchHandle }).__swatch = handle;
}

/** Every dotted role in the file, in the order it is written. */
function collectRoles(): PaletteRole[] {
  const roles: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string): void => {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('$')) continue;
      const path = prefix === '' ? key : `${prefix}.${key}`;
      if (typeof value === 'string') roles.push(path);
      else if (typeof value === 'object' && value !== null) {
        walk(value as Record<string, unknown>, path);
      }
    }
  };
  walk(palette as unknown as Record<string, unknown>, '');
  // Every path collected here came out of the same file the union is derived
  // from, so the cast is the compiler catching up with the walk rather than a
  // claim about anything it cannot see.
  return roles as PaletteRole[];
}

/**
 * Where each chip is on screen, normalised.
 *
 * Normalised rather than in pixels because the screenshot is taken in CSS
 * pixels while the scene renders into a backing store that is one to three
 * times bigger (the degrade ladder's rung). A share of the frame is the same
 * number in both.
 */
function projectAll(scene: Scene, roles: PaletteRole[], meshes: Mesh[]): SwatchPoint[] {
  const engine = scene.getEngine();
  const width = engine.getRenderWidth();
  const height = engine.getRenderHeight();
  const camera = scene.activeCamera;
  const points: SwatchPoint[] = [];
  if (camera === null) return points;

  const viewport = camera.viewport.toGlobal(width, height);
  const transform = scene.getTransformMatrix();
  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    const role = roles[i];
    if (mesh === undefined || role === undefined) continue;
    mesh.computeWorldMatrix(true);
    const world = mesh.getAbsolutePosition();
    const screen = Vector3.Project(world, Matrix.Identity(), transform, viewport);
    points.push({ role, hex: paletteHex(role), x: screen.x / width, y: screen.y / height });
  }
  return points;
}
