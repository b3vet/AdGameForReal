/**
 * What a gate is built out of (Milestone 5 plan, "Gates too basic"; D39).
 *
 * A gate was a translucent slab. It is now an arch the squad walks through:
 * two stone legs, a ring of voussoirs over the opening, a parapet across the
 * top, and a dark rune plaque hanging in the middle with the number cut into
 * it. The kind dressing is `./gateOrnaments.ts` and the light inside the arch
 * is a batch of tinted quads (`./tintedQuads.ts`); this file is the stonework.
 *
 * Everything here is about draw calls. The arch is *one* mesh — every piece
 * baked together, sharing the dungeon atlas — so a row of three is three thin
 * instances of one mesh and one call, and the plaques are one more. A full row
 * of arches costs four or five calls where nine panels cost nine.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { createPlaqueTexture } from './artTextures';
import { tintMaterial } from './models';
import { assemble, at, loadDungeonPieces, scale3, scaleToHeight } from './dungeonPieces';
import type { Part } from './dungeonPieces';
import {
  ARCH_CLEAR_WIDTH,
  ARCH_CROWN_HEIGHT,
  ARCH_DEPTH,
  ARCH_HEIGHT,
  ARCH_LEG_THICKNESS,
  ARCH_RING_RADIUS,
  ARCH_RING_THICKNESS,
  ARCH_SOFFIT,
  ARCH_SPRING_Y,
  ARCH_VOUSSOIRS,
  GATE_PLAQUE_HEIGHT,
  GATE_PLAQUE_WIDTH,
  PLAQUE_HANGER_WIDTH,
  PLAQUE_HANGER_X,
} from './gateLook';
import { applyToonRamp } from './toonRamp';
import { GATE_CENTER_Y, paletteColor } from './theme';

/** The dungeon pieces an arch is assembled from. */
const ARCH_PIECES = [
  'prop_dungeon_pillar',
  'prop_dungeon_column',
  'prop_dungeon_barrier_half',
];

/**
 * The pack's own footprints, in metres, so the scales below read as "how wide
 * do we want this" rather than as magic ratios: the pillar is 1.5 m square and
 * 4 m tall, the parapet 2 m long, 1.1 m tall and 0.5 m deep.
 */
const PILLAR_FOOTPRINT = 1.5;
const COLUMN_FOOTPRINT = 0.7;
const COLUMN_HEIGHT = 1.4;
const PARAPET_LENGTH = 2;
const PARAPET_HEIGHT = 1.1;
const PARAPET_DEPTH = 0.5;

/**
 * The daylight tint for the dungeon stone (D36 roles, not literals). The pack
 * is painted for torchlight and goes cold grey outdoors; this warms it into the
 * same family as the road's kerbs, which is what makes an arch read as part of
 * the road rather than as scaffolding standing on it.
 */
const ARCH_TINT: readonly [number, number, number] = [1.26, 1.06, 0.8];

/**
 * The arch: two legs, a ring of voussoirs over the opening, and a low parapet
 * across the top — all baked into one mesh in one material.
 *
 * Three pieces of the pack do all of it. The legs are the `pillar` scaled
 * slender, every wedge of the ring is the `column` scaled to a block and rolled
 * to its own angle on the curve, and the parapet is the `barrier_half` squashed
 * and spanning the top. They share the dungeon atlas, so the whole assembly is
 * one draw call however many gates are on screen.
 */
export async function loadArch(scene: Scene): Promise<Mesh | null> {
  const pieces = await loadDungeonPieces(scene, ARCH_PIECES);
  const pillar = pieces.get('prop_dungeon_pillar');
  const block = pieces.get('prop_dungeon_column');
  const parapet = pieces.get('prop_dungeon_barrier_half');
  if (pillar === undefined) return null;

  const parts: Part[] = [];

  // The legs. The pillar is a squat 1.5 m square, and a gate leg is slender, so
  // x and z are scaled to the thickness the lane can spare rather than with y.
  const legScale = scaleToHeight(pillar, ARCH_SPRING_Y);
  const legWidth = ARCH_LEG_THICKNESS / PILLAR_FOOTPRINT;
  const legX = ARCH_CLEAR_WIDTH / 2 + ARCH_LEG_THICKNESS / 2;
  for (const side of [-1, 1]) {
    parts.push({
      source: pillar,
      scale: scale3(legWidth, legScale, legWidth),
      position: at(side * legX, 0, 0),
    });
  }

  // The ring. Each wedge is rolled so its own length runs radially, which is
  // what makes the blocks fan out of the curve instead of sitting square on it;
  // the middle one is the keystone and stands a little proud.
  if (block !== undefined) {
    const tangential = (Math.PI * ARCH_RING_RADIUS) / ARCH_VOUSSOIRS;
    for (let i = 0; i < ARCH_VOUSSOIRS; i++) {
      const angle = (Math.PI * (i + 0.5)) / ARCH_VOUSSOIRS;
      const keystone = i === (ARCH_VOUSSOIRS - 1) / 2;
      const radial = ARCH_RING_THICKNESS * (keystone ? 1.3 : 1);
      parts.push({
        source: block,
        scale: scale3(
          // Slightly over the arc length, so the blocks meet rather than gap.
          (tangential * 1.08) / COLUMN_FOOTPRINT,
          radial / COLUMN_HEIGHT,
          ARCH_DEPTH / COLUMN_FOOTPRINT,
        ),
        roll: angle - Math.PI / 2,
        position: at(
          Math.cos(angle) * ARCH_RING_RADIUS,
          ARCH_SPRING_Y + Math.sin(angle) * ARCH_RING_RADIUS,
          0,
        ),
      });
    }
  }

  // The parapet across the top, which is also what the `mul` crown stands on.
  if (parapet !== undefined) {
    // A leg narrower than the legs span: the parapet used to run the arch's
    // full 1.88 m, which left 12 cm of the 2 m lane between one gate's parapet
    // and its neighbour's — at three rows out that gap is under a pixel and a
    // row of arches read as one lintel across the road, which is the fence the
    // ring of voussoirs exists to avoid. Half a leg shorter each side leaves
    // 0.44 m of daylight and still lands the parapet on both legs.
    const span = ARCH_CLEAR_WIDTH + ARCH_LEG_THICKNESS;
    parts.push({
      source: parapet,
      scale: scale3(
        span / PARAPET_LENGTH,
        ARCH_CROWN_HEIGHT / PARAPET_HEIGHT,
        ARCH_DEPTH / PARAPET_DEPTH,
      ),
      // The piece runs from x = 0 to x = 2 in its own file and comes out of the
      // loader mirrored (`loadDungeonPieces`), so it now runs from -2 to 0 and
      // is pushed *right* by half its new length to sit centred over the
      // opening. Getting that sign wrong puts every arch's parapet over its
      // neighbour's lane, which reads as one long bar across the road.
      position: at(span / 2, ARCH_HEIGHT - ARCH_CROWN_HEIGHT, 0),
    });
  }

  const arch = assemble('gateArch', parts);
  for (const piece of pieces.values()) piece.dispose();
  if (arch === null) return null;
  tintMaterial(arch.material, ARCH_TINT[0], ARCH_TINT[1], ARCH_TINT[2]);
  applyToonRamp(arch.material);
  return arch;
}

/**
 * The stand-in arch: the same silhouette in three boxes, for a build whose
 * `/assets/` never arrived and for the dev fixtures that run without them.
 *
 * It is what the view is built with and what the dungeon pieces replace once
 * they load, so a gate is never missing — only ever plainer.
 */
export function createBoxArch(scene: Scene): Mesh {
  const parts: Mesh[] = [];
  const legX = ARCH_CLEAR_WIDTH / 2 + ARCH_LEG_THICKNESS / 2;
  for (const side of [-1, 1]) {
    const leg = CreateBox(
      'archLeg',
      { width: ARCH_LEG_THICKNESS, height: ARCH_SPRING_Y, depth: ARCH_DEPTH },
      scene,
    );
    leg.position.set(side * legX, ARCH_SPRING_Y / 2, 0);
    parts.push(leg);
  }
  // The ring, as boxes on the same curve the real one follows.
  for (let i = 0; i < ARCH_VOUSSOIRS; i++) {
    const angle = (Math.PI * (i + 0.5)) / ARCH_VOUSSOIRS;
    const wedge = CreateBox(
      'archWedge',
      {
        width: ((Math.PI * ARCH_RING_RADIUS) / ARCH_VOUSSOIRS) * 1.1,
        height: ARCH_RING_THICKNESS,
        depth: ARCH_DEPTH,
      },
      scene,
    );
    wedge.rotation.z = angle - Math.PI / 2;
    wedge.position.set(
      Math.cos(angle) * ARCH_RING_RADIUS,
      ARCH_SPRING_Y + Math.sin(angle) * ARCH_RING_RADIUS,
      0,
    );
    parts.push(wedge);
  }
  const crown = CreateBox(
    'archCrown',
    {
      // The same short parapet the real arch gets, for the same reason: at the
      // full span three of them meet across the road and read as one lintel.
      width: ARCH_CLEAR_WIDTH + ARCH_LEG_THICKNESS,
      height: ARCH_CROWN_HEIGHT,
      depth: ARCH_DEPTH,
    },
    scene,
  );
  crown.position.y = ARCH_HEIGHT - ARCH_CROWN_HEIGHT / 2;
  parts.push(crown);

  const merged = Mesh.MergeMeshes(parts, true, true);
  const arch = merged ?? parts[0];
  if (arch === undefined) throw new Error('the box arch has no parts');
  arch.name = 'gateArchBox';

  const material = new StandardMaterial('gateArchBoxMat', scene);
  material.diffuseColor = paletteColor('stone.base');
  material.specularColor = Color3.Black();
  arch.material = material;
  arch.isPickable = false;
  applyToonRamp(material);
  return arch;
}

/**
 * The rune plaque: the dark slab the number is printed on.
 *
 * It hangs in the middle of the opening at `GATE_CENTER_Y`, which is exactly
 * where the panel's number used to be — the label API and its placement rule
 * are untouched (`./labels.ts`), the plaque is only what the digits now sit on.
 * Unlit, because it has to be the same near-black from every angle: it is the
 * contrast the number is read against, and a plaque that turned its shaded side
 * to the camera would take the number with it.
 */
export function createPlaque(scene: Scene): Mesh {
  const material = new StandardMaterial('gatePlaqueMat', scene);
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.emissiveTexture = createPlaqueTexture(scene);
  // Black, not white: `default.fragment` *adds* the emissive texture to
  // `emissiveColor` rather than multiplying, so a white base clamps the plaque
  // to white and the carving never shows. (The sky dome learned this first.)
  material.emissiveColor = Color3.Black();
  material.disableLighting = true;

  const slab = CreateBox(
    'gatePlaqueSlab',
    { width: GATE_PLAQUE_WIDTH, height: GATE_PLAQUE_HEIGHT, depth: 0.1 },
    scene,
  );

  // The two bars it hangs from, reaching up to the underside of the lintel.
  const drop = ARCH_SOFFIT - GATE_CENTER_Y - GATE_PLAQUE_HEIGHT / 2;
  const parts: Mesh[] = [slab];
  if (drop > 0) {
    for (const side of [-1, 1]) {
      const hanger = CreateBox(
        'gatePlaqueHanger',
        { width: PLAQUE_HANGER_WIDTH, height: drop, depth: PLAQUE_HANGER_WIDTH },
        scene,
      );
      hanger.position.set(side * PLAQUE_HANGER_X, GATE_PLAQUE_HEIGHT / 2 + drop / 2, 0);
      parts.push(hanger);
    }
  }

  const merged = parts.length === 1 ? slab : Mesh.MergeMeshes(parts, true, true);
  const plaque = merged ?? slab;
  plaque.name = 'gatePlaque';
  plaque.material = material;
  plaque.isPickable = false;
  return plaque;
}

