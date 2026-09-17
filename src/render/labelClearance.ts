/**
 * Where a world number goes when a gate's number is in the way.
 *
 * Three kinds of number float over the road — a block's HP (`./enemies.ts`), a
 * stream's remaining count (`./streamBodies.ts`) and a gate's own value
 * (`./gates.ts`) — and the gate's always wins, because it is the choice the
 * player is about to make. This is the rule for the other two when they are
 * standing on it.
 *
 * Two rules, and which applies depends on what the number is anchored to:
 *
 *   1. A river's count, `gateCoversLabel`: hidden while it is inside the screen
 *      box of a numbered gate's plaque. The count rides the head of the river
 *      at `STREAM_LABEL_HEIGHT`, which is exactly the plaque's band, so a head
 *      level with a row lands in the middle of the plaque for the second or so
 *      it takes to walk through (Milestone 4 Phase C, `staff-l10.png`).
 *   2. A block's number, `placeBlockLabel`: *moved* rather than hidden. Up to
 *      Phase 1 of the level-design plan this was a hide rule with a margin of
 *      a share of the camera's distance either side of the row, and that
 *      margin is exactly the one the plan's beats live in (document 31, 3.2):
 *      a brute standing 5 m behind a plus panel — the ambush — lost its number
 *      for as long as the panel was ahead of the squad, and a guard 6 m in
 *      front lost its number for four seconds of the approach. The number on a
 *      threat is the price of the lane, so it has to stay on screen. A number
 *      behind a gate is lifted until it clears the plaque's top edge; one in
 *      front is lowered until it clears the gate's own number; and only a
 *      number that cannot be moved far enough is hidden.
 *
 * Both rules only look at gates that are printing a number (`GATE_LABEL_RANGE`):
 * the plaque is drawn only where the number is (`./gates.ts`), so an arch
 * further out has nothing for a number to land on.
 *
 * The projection is the analytic camera, not the rig: `CameraRig` eases toward
 * exactly this pose and trails it by under a metre (`CAMERA.smoothing`), the
 * plaque band is a metre of road deep, and reading the live rig would mean
 * threading it through two views for a fraction of a band. The Academy's
 * backdrop camera stands elsewhere (`PREVIEW_BEHIND`), so the rule is a shade
 * off there; nothing is fighting behind a menu.
 */

import { GATE_PLAQUE_HEIGHT } from './gateLook';
import { labelPixels } from './labels';
import {
  BLOCK_LABEL_FLOOR,
  BLOCK_LABEL_GAP,
  BLOCK_LABEL_LANE_CLEARANCE,
  CAMERA,
  GATE_CENTER_Y,
  GATE_LABEL_MIN,
  GATE_LABEL_RANGE,
  GATE_LABEL_SIZE,
  LABEL_BEHIND,
  cameraBack,
  cameraLift,
  gateLabelReach,
} from './theme';
import { formationDepth, laneCenter, openRoadWidth } from '@/sim';
import type { GateState } from '@/sim';

/**
 * How tall the thing a number can hide behind actually is.
 *
 * The plaque hangs at `GATE_CENTER_Y` and is 0.8 m tall (`./gateLook.ts`); a
 * quarter taller than the slab, because a number is hidden by a plaque a little
 * before it is *inside* one: at the plaque's own height a stream's count came to
 * rest on the top rail of a `+3` (`artifacts/smoke/t6.png`).
 */
const GATE_LABEL_BAND_MARGIN = 1.25;
const GATE_LABEL_BAND = GATE_PLAQUE_HEIGHT * GATE_LABEL_BAND_MARGIN;

/**
 * Screen tangent per design pixel. Labels are sized in pixels of a 390x844
 * frame (`./labels.ts`), and on any phone-shaped screen the ratio between the
 * design pixel and the frame's height is that frame's, so one constant serves
 * every phone: 0.00103 at 390x844 and 0.00103 at 440x956.
 */
const DESIGN_HEIGHT = 844;
const TAN_PER_PIXEL = (2 * Math.tan(CAMERA.fov / 2)) / DESIGN_HEIGHT;
/**
 * How far a number's ink reaches above and below the point it is anchored on,
 * as a share of its size, outline included (`./glyphAtlas.ts` strokes 7 px
 * round a 64 px face). Measured off the sheet rather than assumed symmetric:
 * the figures sit a little low in their cell, and a 3, 5 or 9 hangs 0.47 em
 * under the anchor where every figure's top is within 0.42 of it. With one
 * half-height for both, a guard's number standing a metre in front of its
 * panel was placed with its outline on the panel number's (Phase 1, wave two).
 */
const INK_ABOVE = 0.43;
const INK_BELOW = 0.48;

/**
 * Where the camera stands this frame. One per frame, re-used: the sim must not
 * allocate in a loop and neither may the renderer (CLAUDE.md).
 */
export interface LabelView {
  squadZ: number;
  eyeY: number;
  eyeZ: number;
  /** Tangent of the camera's downward pitch. */
  pitch: number;
}

/** A zeroed view for a caller to fill in with `setLabelView`. */
export function createLabelView(): LabelView {
  return { squadZ: 0, eyeY: 0, eyeZ: 0, pitch: 0 };
}

/**
 * The camera pose for a squad of `count` at `squadZ`, written into `out`.
 *
 * `CameraRig.update` is the source: it stands `behind + cameraBack(depth)` back
 * and `height + cameraLift(depth)` up, and aims at `lookHeight` over the road
 * `lookAhead` in front of the squad. The pitch is the angle between those two
 * points. `width` is the band the formation was laid out in, so a crowd pinched
 * into a lane is measured against the pose that crowd actually gets.
 */
export function setLabelView(
  out: LabelView,
  squadZ: number,
  count: number,
  width: number = openRoadWidth(),
): LabelView {
  // The same pair the rig derives its pose from, off the same formation depth
  // (`cameraBack`). The rig eases toward this over about half a second while
  // the crowd is growing; the panel band is a metre of road deep and a label
  // that sits a pixel off for a frame of a `mul` gate is not worth threading
  // the live pose through two views for.
  const depth = formationDepth(count, width);
  const back = cameraBack(depth);
  const lift = cameraLift(depth);
  out.squadZ = squadZ;
  out.eyeY = CAMERA.height + lift;
  out.eyeZ = squadZ - CAMERA.behind - back;
  out.pitch = (out.eyeY - CAMERA.lookHeight) / (CAMERA.lookAhead + CAMERA.behind + back);
  return out;
}

/**
 * Vertical screen position of a world point, as the tangent of its angle above
 * the view axis: 0 is the middle of the frame and `±tan(fov / 2)` its edges.
 * Neither the field of view nor the viewport appears, because every caller
 * compares two of these or converts through `TAN_PER_PIXEL`.
 *
 * Derived from the camera's own axes in the y-z plane: forward is
 * `(-sin, cos)` and up is `(cos, sin)` for a downward pitch, and dividing both
 * by `cos` leaves the tangent this takes.
 */
export function screenY(view: LabelView, y: number, z: number): number {
  const dy = y - view.eyeY;
  const dz = z - view.eyeZ;
  const depth = dz - view.pitch * dy;
  // Behind the camera: no screen position at all, and nothing to collide with.
  if (depth <= 0) return Number.POSITIVE_INFINITY;
  return (dy + view.pitch * dz) / depth;
}

/**
 * The height over the road at `z` that lands on screen at `target`: `screenY`
 * solved for `y`, which is a straight line in `y` at a fixed `z`.
 */
export function heightAtScreen(view: LabelView, target: number, z: number): number {
  const dz = z - view.eyeZ;
  return view.eyeY + (dz * (target - view.pitch)) / (1 + target * view.pitch);
}

/**
 * True when a label at `(x, z, labelY)` lands inside the screen box of a
 * numbered gate's plaque. For a river's count; see the note at the top.
 */
export function gateCoversLabel(
  gates: readonly GateState[],
  x: number,
  z: number,
  labelY: number,
  view: LabelView,
): boolean {
  const here = screenY(view, labelY, z);
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === undefined || !printsNumber(gate, x, view)) continue;
    const top = screenY(view, GATE_CENTER_Y + GATE_LABEL_BAND / 2, gate.z);
    const bottom = screenY(view, GATE_CENTER_Y - GATE_LABEL_BAND / 2, gate.z);
    if (here <= top && here >= bottom) return true;
  }
  return false;
}

/**
 * The height a block's number should be printed at, or `NaN` to hide it this
 * frame. `labelY` is where it would ride with nothing in the way and `pixels`
 * the size it is printed at.
 *
 * A number *behind* a numbered gate in its lane may only go up — to clear the
 * plaque's top edge on screen — and one *in front* may only go down, to clear
 * the gate's number above it. The two bounds are collected over every gate,
 * so a block between two rows of its own lane is placed against both, and one
 * that fits neither is hidden.
 */
export function placeBlockLabel(
  gates: readonly GateState[],
  x: number,
  z: number,
  labelY: number,
  pixels: number,
  view: LabelView,
): number {
  let lowest = Number.NEGATIVE_INFINITY;
  let highest = Number.POSITIVE_INFINITY;

  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === undefined || !printsNumber(gate, x, view)) continue;

    if (z >= gate.z) {
      // Behind the row: the plaque is nearer the camera, so on screen it is
      // *in front of* the number, and the number goes over its top edge.
      const top = screenY(view, GATE_CENTER_Y + GATE_LABEL_BAND / 2, gate.z);
      const clear = top + (INK_BELOW * pixels + BLOCK_LABEL_GAP) * TAN_PER_PIXEL;
      lowest = Math.max(lowest, heightAtScreen(view, clear, z));
      continue;
    }

    // In front of the row: the gate's number is further up the screen, and
    // this one goes far enough under it that the two inks do not touch.
    const gatePixels = labelPixels(GATE_LABEL_SIZE, GATE_LABEL_MIN, gate.z - view.squadZ);
    const number = screenY(view, GATE_CENTER_Y, gate.z);
    const inks = INK_ABOVE * pixels + INK_BELOW * gatePixels;
    const clear = number - (inks + BLOCK_LABEL_GAP) * TAN_PER_PIXEL;
    highest = Math.min(highest, heightAtScreen(view, clear, z));
  }

  const y = Math.min(Math.max(labelY, lowest), highest);
  if (y < lowest || (y < labelY && y < BLOCK_LABEL_FLOOR)) return Number.NaN;
  return y;
}

/**
 * Whether this gate is printing a number a label at lateral `x` could land on:
 * unpassed, in the label's own lane, and inside the range `./gates.ts` numbers
 * it from.
 */
function printsNumber(gate: GateState, x: number, view: LabelView): boolean {
  // Distance first: a level lists every gate on its road, and all but the
  // two or three rows in front of the squad fail here.
  const ahead = gate.z - view.squadZ;
  if (ahead >= GATE_LABEL_RANGE || ahead <= -LABEL_BEHIND || gate.passed) return false;
  const lane = laneCenter(gate.lane);
  if (Math.abs(lane - x) > BLOCK_LABEL_LANE_CLEARANCE) return false;
  return ahead < gateLabelReach(lane, gate.kind === 'weapon');
}
