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

import { labelPixels, type NumberLabels } from './labels';
import { loadPropMeshes, meshExtent } from './models';
import {
  GATE_BASE_ALPHA,
  GATE_CENTER_Y,
  GATE_DRAW_RANGE,
  GATE_EXIT_DURATION,
  GATE_HEIGHT,
  GATE_LABEL_COLOR,
  GATE_LABEL_MIN,
  GATE_LABEL_RANGE,
  GATE_LABEL_SIZE,
  GATE_PROP_HEIGHT,
  GATE_PROP_SPIN,
  GATE_PROP_Y,
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
import { weaponIds } from '@/sim';
import type { GateKind, GateState, RunState, WeaponId } from '@/sim';

/**
 * The staff each weapon gate floats above its panel, by mesh name inside
 * `mage.glb`. They are the same meshes the mages carry, so the panel offering
 * "Frost" shows the exact grimoire the crowd will be holding a second later.
 */
const STAFF_MESHES: Record<WeaponId, string> = {
  ember: '2H_Staff',
  storm: '1H_Wand',
  frost: 'Spellbook_open',
};

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

/** How far the number floats in front of the panel it is printed on. */
const GATE_LABEL_LIFT = 0.1;

interface GateSlot {
  panel: Mesh;
  material: StandardMaterial;
  /** This slot's label id in the shared atlas; see `src/render/labels.ts`. */
  label: number;
  gateId: number;
  rowIndex: number;
  /** Last kind painted. A shot-down `sub` gate flips to `add` and must re-tint. */
  kind: GateKind;
  /** Last value printed. Re-building the string every frame allocates. */
  shownValue: number;
  /** The string that value produced, handed back to the atlas every frame. */
  shownText: string;
  /** Seconds left on the hit flash. */
  pulse: number;
  exit: Exit;
  exitAge: number;
  /** Whether the panel is inside the draw range; see `paintIdle`. */
  drawn: boolean;
  /** Frame counter of the last `RunState` that still listed this gate. */
  seen: number;
}

export class GateView {
  private readonly slots: GateSlot[] = [];
  private readonly byGateId = new Map<number, GateSlot>();
  private readonly scene: Scene;
  private readonly labels: NumberLabels;
  /**
   * One floating staff per weapon, shown above the nearest gate offering it,
   * and the gate each is hovering over this frame. Both are plain arrays
   * indexed by `weaponIds`, not maps: the second one is rebuilt every frame,
   * and iterating a `Map` allocates a two-element array per entry per frame.
   */
  private readonly staffMeshes: (Mesh | null)[] = [];
  private readonly staffTargets: (GateSlot | null)[] = [];
  private frame = 0;
  private spin = 0;

  constructor(scene: Scene, labels: NumberLabels) {
    this.scene = scene;
    this.labels = labels;
    for (let i = 0; i < weaponIds.length; i++) {
      this.staffMeshes.push(null);
      this.staffTargets.push(null);
    }
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

      this.slots.push({
        panel,
        material,
        label: labels.claim(),
        gateId: -1,
        rowIndex: -1,
        kind: 'add',
        shownValue: Number.NaN,
        shownText: '',
        pulse: 0,
        exit: 'none',
        exitAge: 0,
        drawn: false,
        seen: 0,
      });
    }
  }

  /** Pulls the three staff props out of the mage model. */
  async load(): Promise<void> {
    const meshes = await loadPropMeshes(this.scene, 'mage', Object.values(STAFF_MESHES));
    for (let i = 0; i < weaponIds.length; i++) {
      const id = weaponIds[i];
      if (id === undefined) continue;
      const mesh = meshes.get(STAFF_MESHES[id]);
      if (mesh === undefined) continue;
      const height = Math.max(0.01, meshExtent(mesh).y);
      mesh.scaling.setAll(GATE_PROP_HEIGHT / height);
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.staffMeshes[i] = mesh;
    }
  }

  /** Hands every panel back to the pool. Called from `loadLevel`. */
  reset(): void {
    this.byGateId.clear();
    for (const slot of this.slots) this.release(slot);
    for (let i = 0; i < this.staffMeshes.length; i++) {
      this.staffMeshes[i]?.setEnabled(false);
      this.staffTargets[i] = null;
    }
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
    for (let i = 0; i < this.staffTargets.length; i++) this.staffTargets[i] = null;

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
      if (gate.kind === 'weapon' && gate.weaponId !== undefined && slot.drawn) {
        const at = weaponIds.indexOf(gate.weaponId);
        const held = at < 0 ? null : (this.staffTargets[at] ?? null);
        if (at >= 0 && (held === null || slot.panel.position.z < held.panel.position.z)) {
          this.staffTargets[at] = slot;
        }
      }
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

    this.placeStaffs(dt);
  }

  dispose(): void {
    // The material too: `Mesh.dispose` leaves it behind by default, and a
    // renderer that is torn down and rebuilt (the dev scenes, a hot reload)
    // would otherwise leak sixty of them per cycle.
    for (const slot of this.slots) {
      slot.material.dispose();
      slot.panel.dispose();
    }
    this.slots.length = 0;
    this.byGateId.clear();
    for (let i = 0; i < this.staffMeshes.length; i++) this.staffMeshes[i]?.dispose();
    this.staffMeshes.length = 0;
    this.staffTargets.length = 0;
  }

  /**
   * Floats each staff over the nearest gate offering it, turning slowly so the
   * silhouette reads from any angle, and hides the ones nobody is offering.
   */
  private placeStaffs(dt: number): void {
    this.spin += dt * GATE_PROP_SPIN;
    const bob = Math.sin(this.spin * 2) * 0.06;
    for (let i = 0; i < this.staffMeshes.length; i++) {
      const mesh = this.staffMeshes[i];
      if (mesh === null || mesh === undefined) continue;
      const slot = this.staffTargets[i] ?? null;
      if (slot === null) {
        if (mesh.isEnabled()) mesh.setEnabled(false);
        continue;
      }
      mesh.setEnabled(true);
      mesh.position.set(slot.panel.position.x, GATE_PROP_Y + bob, slot.panel.position.z);
      mesh.rotation.y = this.spin;
      mesh.rotation.z = 0.35;
    }
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
    slot.shownText = '';
    slot.pulse = 0;
    slot.exit = 'none';
    slot.exitAge = 0;

    slot.panel.position.set(gate.lane * LANE_WIDTH, GATE_CENTER_Y, gate.z);
    slot.panel.scaling.setAll(1);
    slot.drawn = true;
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
    const ahead = gate.z - squadZ;
    // A level carries up to sixty panels and each is its own draw call, so the
    // ones deep in the fog are not drawn at all. Three rows are in frame at
    // 11 m spacing, which is everything the player can act on.
    const drawn = ahead < GATE_DRAW_RANGE && ahead > -LABEL_BEHIND * 2;
    if (drawn !== slot.drawn) {
      slot.drawn = drawn;
      slot.panel.setEnabled(drawn);
    }
    if (!drawn) return;

    // Shooting a `sub` gate to zero turns it into an `add` gate: the colour has
    // to follow, or the player reads a red panel offering a bonus.
    if (gate.kind !== slot.kind) this.tint(slot, gate.kind);

    const tint = GATE_TINTS[gate.kind];
    const pulse = slot.pulse / GATE_PULSE_DURATION;
    // Written into the material's own colour: `scale` would allocate a Color3
    // for every visible gate on every frame.
    tint.scaleToRef(0.35 + pulse * 0.9, slot.material.emissiveColor);
    slot.material.alpha = GATE_BASE_ALPHA + pulse * 0.35;

    // A far row shows one number, the near row shows all three: at thirty
    // metres out the three lanes are close enough on screen that side labels
    // overlap the middle one, and the nearest row has to stay fully readable.
    const range = gate.lane === 0 ? GATE_LABEL_RANGE : SIDE_GATE_LABEL_RANGE;
    if (ahead >= range || ahead <= -LABEL_BEHIND) return;

    // Only when the number actually moved: building the string every frame
    // allocates, and the atlas is handed the cached one.
    if (gate.value !== slot.shownValue) {
      slot.shownValue = gate.value;
      slot.shownText = gateText(gate.kind, gate.value, gate.weaponId);
    }
    const word = gate.kind === 'weapon';
    this.labels.set(
      slot.label,
      slot.shownText,
      slot.panel.position.x,
      GATE_CENTER_Y,
      // A hair in front of the panel's own face, toward the camera: the label
      // does not test depth, but keeping it off the plane stops the two from
      // z-fighting if that ever changes.
      slot.panel.position.z - GATE_LABEL_LIFT,
      GATE_LABEL_COLOR,
      labelPixels(
        word ? GATE_WORD_SIZE : GATE_LABEL_SIZE,
        word ? GATE_WORD_MIN : GATE_LABEL_MIN,
        ahead,
      ),
    );
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
    slot.drawn = false;
    slot.shownText = '';
    slot.panel.setEnabled(false);
    slot.panel.scaling.setAll(1);
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
