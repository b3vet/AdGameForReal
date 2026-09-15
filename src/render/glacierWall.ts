/**
 * Frost tier 4 (D54): the wall of ice that holds one lane's river where it
 * stands.
 *
 * One box, one material, allocated at boot and enabled only while a wall is
 * up — so a player who has never bought the evolution pays one disabled mesh
 * for it, and one who has pays one draw call for a few seconds at a time.
 *
 * Driven by `RunState.ice` rather than by the `glacier` event, and that is the
 * point: the wall is *state*, not news. The sim writes where it is and when it
 * lets go, `contact.ts` holds the bodies against exactly that line, and this
 * draws the same three numbers — so the ice can never be somewhere the bodies
 * are not stopping, and a run photographed mid-wall replays with the wall in it.
 *
 * It rises out of the road and melts back into it (`./evolutionLook.ts`): a
 * wall that blinks on reads as a bug, and one that fades out leaves the river
 * walking through a ghost.
 */

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

import {
  GLACIER_ALPHA,
  GLACIER_EMISSIVE,
  GLACIER_HEIGHT,
  GLACIER_MELT_SECONDS,
  GLACIER_RISE_SECONDS,
  GLACIER_THICKNESS,
} from './evolutionLook';
import { paletteColor } from './palette';
import { laneCenter } from '@/sim';
import type { RunState } from '@/sim';
import { balance } from '@/data';

export class GlacierWall {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;

  /** Sim time the wall in the state went up, so the rise can be drawn. */
  private raisedAt = 0;
  /** The `until` of the wall currently drawn, to notice a second one. */
  private until = -1;
  private visible = false;

  constructor(scene: Scene) {
    // A lane wide, thin along the road, as tall as the look asks. Unit height
    // so the rise is a `scaling.y` rather than a rebuild.
    this.mesh = CreateBox(
      'glacier',
      { width: balance.road.laneWidth * 0.98, height: 1, depth: GLACIER_THICKNESS },
      scene,
    );
    const ice = paletteColor('spell.frost.body');
    this.material = new StandardMaterial('glacierMat', scene);
    this.material.diffuseColor = paletteColor('spell.frost.core').scale(0.7);
    // Lit from inside, which is what separates ice from a pale stone block.
    this.material.emissiveColor = ice.scale(GLACIER_EMISSIVE);
    this.material.specularColor = Color3.Black();
    this.material.alpha = GLACIER_ALPHA;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.setEnabled(false);
  }

  reset(): void {
    this.until = -1;
    this.visible = false;
    this.mesh.setEnabled(false);
  }

  /**
   * Places the wall the state is holding, or takes the last one away.
   *
   * `state.time` is the sim's own clock and `ice.until` is on it, so the melt
   * is measured in sim seconds — a hit-stop holds the wall exactly as long as
   * it holds the bodies behind it.
   */
  update(state: RunState): void {
    const ice = state.ice;
    if (ice === undefined || ice === null) {
      if (this.visible) this.hide();
      return;
    }

    if (ice.until !== this.until) {
      // A new wall: remember when it went up so the rise starts from now.
      this.until = ice.until;
      this.raisedAt = state.time;
    }

    const risen = Math.min(1, Math.max(0, (state.time - this.raisedAt) / GLACIER_RISE_SECONDS));
    const left = ice.until - state.time;
    const melt = Math.min(1, Math.max(0, left / GLACIER_MELT_SECONDS));
    const height = GLACIER_HEIGHT * risen * melt;
    if (height <= 0.01) {
      if (this.visible) this.hide();
      return;
    }

    this.mesh.scaling.y = height;
    this.mesh.position.set(
      laneCenter(ice.lane, balance.road.laneWidth),
      height / 2,
      ice.z,
    );
    this.material.alpha = GLACIER_ALPHA * melt;
    if (!this.visible) {
      this.visible = true;
      this.mesh.setEnabled(true);
    }
  }

  /** True while the wall is drawn, for the debug panel and the probes. */
  get drawn(): boolean {
    return this.visible;
  }

  dispose(): void {
    this.material.dispose();
    this.mesh.dispose();
  }

  private hide(): void {
    this.visible = false;
    this.mesh.setEnabled(false);
  }
}
