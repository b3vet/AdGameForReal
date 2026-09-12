/**
 * When a world number gives way to a gate panel.
 *
 * Three kinds of number float over the road — a block's HP (`./enemies.ts`), a
 * stream's remaining count (`./streamBodies.ts`) and a gate's own value
 * (`./gates.ts`) — and the gate's always wins, because it is the choice the
 * player is about to make. This is the rule that decides when one of the other
 * two is standing on it.
 *
 * Two tests, and which of them applies depends on what the number is anchored
 * to:
 *
 *   1. The panel's own screen box, `gateCoversLabel`. Every world number obeys
 *      it: a number inside the rectangle the panel occupies on screen is simply
 *      unreadable. It is what `artifacts/smoke/staff-l10.png` needed in
 *      Milestone 4 Phase C, where the near row's `+6` had a stream's `9` printed
 *      across it — the count rides the head of the river at
 *      `STREAM_LABEL_HEIGHT` rather than on a body, so a head level with a gate
 *      row lands in the middle of the panel.
 *   2. A share of the camera's distance to the gate, `gateCrowdsLabel`, on top
 *      of the box. The same stretch of road is fewer pixels the further out it
 *      is, so a fixed window in metres either hides everything up close or
 *      nothing far away. This is Milestone 1's rule, re-measured in Milestone 3,
 *      and it is a *block's* margin: a block's HP number and a gate's value are
 *      both about the same patch of road, and the two want daylight between them
 *      rather than merely not touching. A stream's count takes the box alone —
 *      under the share a river whose head is five metres past the row loses its
 *      number for no reason, which is a threat readout gone missing.
 *
 * The projection is the analytic camera, not the rig: `CameraRig` eases toward
 * exactly this pose and trails it by under a metre (`CAMERA.smoothing`), the
 * panel band is three metres of road deep, and reading the live rig would mean
 * threading it through two views for a fraction of a band. The Academy's
 * backdrop camera stands elsewhere (`PREVIEW_BEHIND`), so the test is a shade
 * off there; nothing is streaming behind a menu.
 */

import {
  BLOCK_LABEL_CLEARANCE_BEHIND,
  BLOCK_LABEL_CLEARANCE_FRONT,
  BLOCK_LABEL_LANE_CLEARANCE,
  CAMERA,
  GATE_CENTER_Y,
  GATE_DRAW_RANGE,
  GATE_HEIGHT,
  LABEL_BEHIND,
} from './theme';
import { laneCenter } from '@/sim';
import type { GateState } from '@/sim';

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
 * `CameraRig.update` is the source: it stands `behind + pullback` back and
 * `height + pullback` up, and aims at `lookHeight` over the road `lookAhead`
 * in front of the squad. The pitch is the angle between those two points.
 */
export function setLabelView(out: LabelView, squadZ: number, count: number): LabelView {
  const pullback = Math.min(CAMERA.pullbackMax, count * CAMERA.pullbackPerUnit);
  out.squadZ = squadZ;
  out.eyeY = CAMERA.height + pullback;
  out.eyeZ = squadZ - CAMERA.behind - pullback;
  out.pitch =
    (out.eyeY - CAMERA.lookHeight) / (CAMERA.lookAhead + CAMERA.behind + pullback);
  return out;
}

/**
 * Vertical screen position of a world point, in units of `tan(fov/2)` — so 0 is
 * the middle of the frame and ±1 its edges. Only the ratio matters here, which
 * is why neither the field of view nor the viewport appears.
 *
 * Derived from the camera's own axes in the y-z plane: forward is
 * `(-sin, cos)` and up is `(cos, sin)` for a downward pitch, and dividing both
 * by `cos` leaves the tangent this takes.
 */
function screenY(view: LabelView, y: number, z: number): number {
  const dy = y - view.eyeY;
  const dz = z - view.eyeZ;
  const depth = dz - view.pitch * dy;
  // Behind the camera: no screen position at all, and nothing to collide with.
  if (depth <= 0) return Number.POSITIVE_INFINITY;
  return (dy + view.pitch * dz) / depth;
}

/**
 * True when a label at `(x, z, labelY)` lands inside the screen box of an
 * unpassed gate's panel. Every world number that is not a gate's own obeys it.
 */
export function gateCoversLabel(
  gates: readonly GateState[],
  x: number,
  z: number,
  labelY: number,
  view: LabelView,
): boolean {
  return crowded(gates, x, z, labelY, view, false);
}

/**
 * The same, plus a block's own margin either side of the row. Blocks only:
 * see the note at the top of the file.
 */
export function gateCrowdsLabel(
  gates: readonly GateState[],
  x: number,
  z: number,
  labelY: number,
  view: LabelView,
): boolean {
  return crowded(gates, x, z, labelY, view, true);
}

function crowded(
  gates: readonly GateState[],
  x: number,
  z: number,
  labelY: number,
  view: LabelView,
  margin: boolean,
): boolean {
  const here = screenY(view, labelY, z);

  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    if (gate === undefined || gate.passed) continue;
    // Lanes are two metres apart, which is 55 px even three rows out — wider
    // than either number — so only a gate in the label's own lane can print on
    // the same patch of screen.
    if (Math.abs(laneCenter(gate.lane) - x) > BLOCK_LABEL_LANE_CLEARANCE) continue;

    if (margin) {
      // Behind is the wider window: a number beyond a gate prints *up* into that
      // gate's panel, while one in front prints below it, where a low anchor on
      // the body's own face already buys separation.
      const gap = z - gate.z;
      const share = gap >= 0 ? BLOCK_LABEL_CLEARANCE_BEHIND : BLOCK_LABEL_CLEARANCE_FRONT;
      if (Math.abs(gap) < (gate.z - view.eyeZ) * share) return true;
    }

    // A panel outside the draw range is not on screen, so there is nothing for
    // the number to stand on (`GateView.paintIdle` disables it there).
    const ahead = gate.z - view.squadZ;
    if (ahead >= GATE_DRAW_RANGE || ahead <= -LABEL_BEHIND * 2) continue;
    const top = screenY(view, GATE_CENTER_Y + GATE_HEIGHT / 2, gate.z);
    const bottom = screenY(view, GATE_CENTER_Y - GATE_HEIGHT / 2, gate.z);
    if (here <= top && here >= bottom) return true;
  }

  return false;
}
