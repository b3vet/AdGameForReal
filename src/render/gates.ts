/**
 * Gate panels: a translucent slab per gate, tinted by kind, with the number the
 * player is deciding about printed across it.
 *
 * Slots are bound to gate ids the first time a gate shows up in `RunState`, and
 * released when its exit animation finishes. Panels, materials and labels are
 * all built in `Renderer.init`; `loadLevel` only unbinds them.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { TextBlock } from '@babylonjs/gui/2D/controls/textBlock';

import { hideLabel, linkLabel, scaleLabel, type LabelLayer } from './labels';
import {
  GATE_BASE_ALPHA,
  GATE_CENTER_Y,
  GATE_EXIT_DURATION,
  GATE_HEIGHT,
  GATE_LABEL_MIN,
  GATE_LABEL_RANGE,
  GATE_LABEL_SIZE,
  GATE_PULSE_DURATION,
  GATE_TINTS,
  GATE_WIDTH,
  GATE_WORD_MIN,
  GATE_WORD_SIZE,
  LABEL_BEHIND,
  LANE_WIDTH,
  POOL,
  SIDE_GATE_LABEL_RANGE,
} from './theme';
import type { GateKind, GateState, RunState, WeaponId } from '@/sim';

type Exit = 'none' | 'chosen' | 'skipped';

/**
 * What a staff gate prints. The sim's ids are lower case; a table rather than
 * `charAt(0).toUpperCase()` so the panel's word is chosen here, in render, and
 * so a new staff cannot ship without one.
 */
const STAFF_NAMES: Record<WeaponId, string> = {
  ember: 'Ember',
  storm: 'Storm',
  frost: 'Frost',
};

/** Metres behind the squad at which an exiting panel is dropped outright. */
const EXIT_CUTOFF_BEHIND = 2;

interface GateSlot {
  panel: Mesh;
  material: StandardMaterial;
  label: TextBlock;
  gateId: number;
  rowIndex: number;
  /** Last kind painted. A shot-down `sub` gate flips to `add` and must re-tint. */
  kind: GateKind;
  /** Last value printed. Re-building the string every frame allocates. */
  shownValue: number;
  /** Last font size applied; see `scaleLabel`. */
  shownSize: number;
  /** Seconds left on the hit flash. */
  pulse: number;
  exit: Exit;
  exitAge: number;
  /** Frame counter of the last `RunState` that still listed this gate. */
  seen: number;
}

export class GateView {
  private readonly slots: GateSlot[] = [];
  private readonly byGateId = new Map<number, GateSlot>();
  private frame = 0;

  constructor(scene: Scene, labels: LabelLayer) {
    for (let i = 0; i < POOL.gates; i++) {
      const material = new StandardMaterial(`gateMat-${String(i)}`, scene);
      material.specularColor = Color3.Black();
      material.backFaceCulling = false;
      material.alpha = GATE_BASE_ALPHA;

      const panel = CreateBox(
        `gate-${String(i)}`,
        { width: GATE_WIDTH, height: GATE_HEIGHT, depth: 0.12 },
        scene,
      );
      panel.material = material;
      panel.isPickable = false;
      panel.setEnabled(false);

      const label = labels.create({ fontSize: GATE_LABEL_SIZE, color: '#ffffff', outline: 6 });
      linkLabel(label, panel, 0);

      this.slots.push({
        panel,
        material,
        label,
        gateId: -1,
        rowIndex: -1,
        kind: 'add',
        shownValue: Number.NaN,
        shownSize: Number.NaN,
        pulse: 0,
        exit: 'none',
        exitAge: 0,
        seen: 0,
      });
    }
  }

  /** Hands every panel back to the pool. Called from `loadLevel`. */
  reset(): void {
    this.byGateId.clear();
    for (const slot of this.slots) this.release(slot);
  }

  /** A shot landed on this gate: flash it so the player sees the number move. */
  onHit(gateId: number): void {
    const slot = this.byGateId.get(gateId);
    if (slot === undefined || slot.exit !== 'none') return;
    slot.pulse = GATE_PULSE_DURATION;
  }

  /**
   * The squad crossed this row. The gate that applied blows outward; its
   * siblings in the same row simply fade, so the choice reads back to the player.
   */
  onPassed(gateId: number): void {
    const chosen = this.byGateId.get(gateId);
    if (chosen === undefined) return;
    this.startExit(chosen, 'chosen');
    for (const slot of this.slots) {
      if (slot.gateId < 0 || slot === chosen) continue;
      if (slot.rowIndex === chosen.rowIndex) this.startExit(slot, 'skipped');
    }
  }

  update(state: RunState, dt: number): void {
    this.frame++;
    const squadZ = state.squad.z;

    for (const gate of state.gates) {
      const slot = this.bind(gate);
      if (slot === undefined) continue;
      slot.seen = this.frame;
      if (slot.exit !== 'none') continue;

      // The sim mutates `passed` even when it emits no event for the skipped
      // lanes, so treat a passed-but-unanimated gate as a fade.
      if (gate.passed || gate.z < squadZ - 1.5) {
        this.startExit(slot, 'skipped');
        continue;
      }

      this.paintIdle(slot, gate, squadZ);
    }

    for (const slot of this.slots) {
      if (slot.gateId < 0) continue;
      if (slot.exit === 'none') {
        // Gone from the state without a `gatePassed`: retire it quietly.
        if (slot.seen !== this.frame) this.release(slot);
        else slot.pulse = Math.max(0, slot.pulse - dt);
        continue;
      }
      this.advanceExit(slot, dt, squadZ);
    }
  }

  dispose(): void {
    for (const slot of this.slots) slot.panel.dispose();
    this.slots.length = 0;
    this.byGateId.clear();
  }

  private bind(gate: GateState): GateSlot | undefined {
    const existing = this.byGateId.get(gate.id);
    if (existing !== undefined) return existing;
    if (gate.passed) return undefined;

    const slot = this.freeSlot();
    if (slot === undefined) return undefined;

    slot.gateId = gate.id;
    slot.rowIndex = gate.rowIndex;
    slot.shownValue = Number.NaN;
    slot.shownSize = Number.NaN;
    slot.pulse = 0;
    slot.exit = 'none';
    slot.exitAge = 0;

    slot.panel.position.set(gate.lane * LANE_WIDTH, GATE_CENTER_Y, gate.z);
    slot.panel.scaling.setAll(1);
    slot.panel.setEnabled(true);
    slot.material.alpha = GATE_BASE_ALPHA;
    this.tint(slot, gate.kind);

    this.byGateId.set(gate.id, slot);
    return slot;
  }

  /** First unbound slot, or undefined when the pool is full. An index loop
   *  rather than `find`: this runs per gate per frame and a closure per call is
   *  an allocation in the steady-state path. */
  private freeSlot(): GateSlot | undefined {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (slot !== undefined && slot.gateId < 0) return slot;
    }
    return undefined;
  }

  private paintIdle(slot: GateSlot, gate: GateState, squadZ: number): void {
    // Shooting a `sub` gate to zero turns it into an `add` gate: the colour has
    // to follow, or the player reads a red panel offering a bonus.
    if (gate.kind !== slot.kind) this.tint(slot, gate.kind);

    const tint = GATE_TINTS[gate.kind];
    const pulse = slot.pulse / GATE_PULSE_DURATION;
    // Written into the material's own colour: `scale` would allocate a Color3
    // for every visible gate on every frame.
    tint.scaleToRef(0.35 + pulse * 0.9, slot.material.emissiveColor);
    slot.material.alpha = GATE_BASE_ALPHA + pulse * 0.35;

    const ahead = gate.z - squadZ;
    // A far row shows one number, the near row shows all three: at thirty
    // metres out the three lanes are close enough on screen that side labels
    // overlap the middle one, and the nearest row has to stay fully readable.
    const range = gate.lane === 0 ? GATE_LABEL_RANGE : SIDE_GATE_LABEL_RANGE;
    const readable = ahead < range && ahead > -LABEL_BEHIND;
    slot.label.isVisible = readable;
    if (readable) {
      // Only when the number actually moved: building the string every frame
      // allocates, and the GUI re-measures the block on every `text` write.
      if (gate.value !== slot.shownValue) {
        slot.shownValue = gate.value;
        slot.label.text = gateText(gate.kind, gate.value, gate.weaponId);
      }
      const word = gate.kind === 'weapon';
      slot.shownSize = scaleLabel(
        slot.label,
        word ? GATE_WORD_SIZE : GATE_LABEL_SIZE,
        word ? GATE_WORD_MIN : GATE_LABEL_MIN,
        ahead,
        slot.shownSize,
      );
    }
  }

  private tint(slot: GateSlot, kind: GateKind): void {
    slot.kind = kind;
    // The kind changed, so the number is about to be re-printed with a new sign.
    slot.shownValue = Number.NaN;
    const tint = GATE_TINTS[kind];
    tint.scaleToRef(0.5, slot.material.diffuseColor);
    tint.scaleToRef(0.35, slot.material.emissiveColor);
  }

  private startExit(slot: GateSlot, exit: Exit): void {
    if (slot.exit !== 'none' || exit === 'none') return;
    slot.exit = exit;
    slot.exitAge = 0;
    hideLabel(slot.label);
  }

  private advanceExit(slot: GateSlot, dt: number, squadZ: number): void {
    slot.exitAge += dt;
    const p = Math.min(1, slot.exitAge / GATE_EXIT_DURATION);
    // A panel between the squad and the camera fills the screen, so cut it
    // short once the squad is properly through rather than letting it linger.
    if (p >= 1 || slot.panel.position.z < squadZ - EXIT_CUTOFF_BEHIND) {
      this.release(slot);
      return;
    }

    const grow = slot.exit === 'chosen' ? 1 + p * 0.7 : 1 - p * 0.2;
    slot.panel.scaling.set(grow, grow, 1);
    slot.material.alpha = GATE_BASE_ALPHA * (1 - p);
  }

  private release(slot: GateSlot): void {
    if (slot.gateId >= 0) this.byGateId.delete(slot.gateId);
    slot.gateId = -1;
    slot.rowIndex = -1;
    slot.exit = 'none';
    slot.exitAge = 0;
    slot.pulse = 0;
    slot.panel.setEnabled(false);
    slot.panel.scaling.setAll(1);
    hideLabel(slot.label);
  }
}

/**
 * What the player reads. Gate values are floats — growth is rate-based — so
 * every branch rounds; `sub` stores its penalty positive, so it prints the sign.
 */
export function gateText(kind: GateKind, value: number, weaponId?: WeaponId): string {
  switch (kind) {
    case 'mul':
      return `x${String(whole(value))}`;
    case 'add':
      return `+${String(whole(value))}`;
    case 'sub': {
      const penalty = whole(value);
      // A shot-down `sub` spends its last fraction of a unit before the sim
      // flips it to `add`. Gluing the sign on would print "-0" for that frame.
      return penalty === 0 ? '0' : `-${String(penalty)}`;
    }
    case 'fireRate':
      return `+${String(whole(value * 100))}%`;
    case 'weapon':
      return weaponId === undefined ? 'Staff' : STAFF_NAMES[weaponId];
  }
}

/** `Math.round` hands back `-0` for small negatives, which prints with a sign. */
function whole(value: number): number {
  const rounded = Math.round(value);
  return rounded === 0 ? 0 : rounded;
}
