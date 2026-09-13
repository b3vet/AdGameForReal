/**
 * The staff a `weapon` gate offers, turning slowly above its arch.
 *
 * One prop per weapon, not one per gate: a level can carry several gates
 * offering the same staff, and only the nearest one in view is worth a floating
 * model. Each is the *same mesh the mages carry*, pulled out of `mage.glb`
 * (`loadPropMeshes`), so the arch offering "Frost" shows the exact grimoire the
 * crowd will be holding a second later.
 *
 * Immediate mode, driven by `./gates.ts`: `begin` forgets last frame's choices,
 * `offer` names a gate that is showing this staff, and `place` puts each prop
 * over the nearest gate that offered it and hides the rest.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import { ARCH_HEIGHT } from './gateLook';
import { loadPropMeshes, meshExtent } from './models';
import { GATE_PROP_HEIGHT, GATE_PROP_SPIN, GATE_PROP_Y } from './theme';
import { weaponIds } from '@/sim';
import type { WeaponId } from '@/sim';

/** Which mesh inside `mage.glb` each weapon's prop is. */
const STAFF_MESHES: Record<WeaponId, string> = {
  ember: '2H_Staff',
  storm: '1H_Wand',
  frost: 'Spellbook_open',
};

/** How far above the arch the prop floats, and how far it bobs. */
const STAFF_Y = Math.max(GATE_PROP_Y, ARCH_HEIGHT + 0.35);
const STAFF_BOB = 0.06;

/** Where one staff is being offered this frame, or `null`. */
interface Target {
  x: number;
  z: number;
}

export class StaffProps {
  private readonly scene: Scene;
  /**
   * Both arrays are indexed by `weaponIds` rather than keyed by it: the targets
   * are rewritten every frame, and iterating a `Map` allocates a two-element
   * array per entry per frame.
   */
  private readonly meshes: (Mesh | null)[] = [];
  private readonly targets: (Target | null)[] = [];
  private spin = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    for (let i = 0; i < weaponIds.length; i++) {
      this.meshes.push(null);
      this.targets.push(null);
    }
  }

  /** Pulls the three props out of the mage model. Fail-soft, like every loader. */
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
      this.meshes[i] = mesh;
    }
  }

  /** Forgets last frame's offers. Called once per frame, before any `offer`. */
  begin(): void {
    for (let i = 0; i < this.targets.length; i++) this.targets[i] = null;
  }

  /** A gate at `(x, z)` is offering `weaponId`. The nearest offer wins. */
  offer(weaponId: WeaponId, x: number, z: number): void {
    const at = weaponIds.indexOf(weaponId);
    if (at < 0) return;
    const held = this.targets[at] ?? null;
    if (held !== null && held.z <= z) return;
    // The slot object is reused rather than replaced: this runs per gate per
    // frame and a fresh object here is an allocation in the steady-state path.
    if (held === null) this.targets[at] = { x, z };
    else {
      held.x = x;
      held.z = z;
    }
  }

  /**
   * Places every offered staff and hides the rest. Turning slowly, so the
   * silhouette reads from any angle, and bobbing, so it reads as floating.
   */
  place(dt: number): void {
    this.spin += dt * GATE_PROP_SPIN;
    const bob = Math.sin(this.spin * 2) * STAFF_BOB;
    for (let i = 0; i < this.meshes.length; i++) {
      const mesh = this.meshes[i];
      if (mesh === null || mesh === undefined) continue;
      const target = this.targets[i] ?? null;
      if (target === null) {
        if (mesh.isEnabled()) mesh.setEnabled(false);
        continue;
      }
      mesh.setEnabled(true);
      mesh.position.set(target.x, STAFF_Y + bob, target.z);
      mesh.rotation.y = this.spin;
      mesh.rotation.z = 0.35;
    }
  }

  /** Takes every prop off the road; `GateView.reset` calls this per level. */
  hideAll(): void {
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i]?.setEnabled(false);
      this.targets[i] = null;
    }
  }

  dispose(): void {
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i]?.dispose();
    this.meshes.length = 0;
    this.targets.length = 0;
  }
}
