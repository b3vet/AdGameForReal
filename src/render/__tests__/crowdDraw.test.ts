/**
 * The crowd's GPU side (`../characters/crowdDraw.ts`), on Babylon's own null
 * engine: which of the two meshes is on after a render, and what happens when
 * the crowd is hidden from outside.
 *
 * The case this exists for: the squad hides the old staff's crowd by its full
 * mesh alone (`../squad.ts`). The copy is a second mesh the squad does not
 * know about, and it has to come down with it, or the old crowd's small units
 * go on standing in the road behind the new ones.
 */

import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CrowdBuffers } from '../characters/crowdCull';
import { CrowdDraw, FULL_DETAIL, setCrowdDetailScale } from '../characters/crowdDraw';

const CAPACITY = 64;

let engine: NullEngine;
let scene: Scene;

beforeEach(() => {
  engine = new NullEngine({ renderHeight: 956, renderWidth: 440, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 1 });
  scene = new Scene(engine);
  const camera = new FreeCamera('camera', new Vector3(0, 6, -8), scene);
  camera.setTarget(new Vector3(0, 0, 10));
});

afterEach(() => {
  setCrowdDetailScale(1);
  scene.dispose();
  engine.dispose();
});

/** A crowd of `count` units down the road in front of the camera. */
function crowd(count: number): { source: CrowdBuffers; whole: Mesh; copy: Mesh; draw: CrowdDraw } {
  const source: CrowdBuffers = {
    matrices: new Float32Array(CAPACITY * 16),
    settings: new Float32Array(CAPACITY * 4),
    count: 0,
  };
  for (let i = 0; i < count; i++) {
    source.matrices.set(Matrix.Translation(0, 0, 2 + i * 0.5).m, i * 16);
  }
  const whole = CreateBox('whole', { size: 1 }, scene);
  const copy = CreateBox('copy', { size: 1 }, scene);
  const draw = new CrowdDraw(source, whole, copy, CAPACITY);
  return { source, whole, copy, draw };
}

describe('CrowdDraw', () => {
  it('turns the copy on only when it has units to draw', () => {
    const { whole, copy, draw } = crowd(60);
    draw.commit(60);
    setCrowdDetailScale(FULL_DETAIL);
    scene.render();
    expect(whole.isEnabled()).toBe(true);
    expect(whole.thinInstanceCount).toBe(60);
    expect(copy.isEnabled()).toBe(false);

    setCrowdDetailScale(0);
    scene.render();
    expect(copy.isEnabled()).toBe(true);
    expect(copy.thinInstanceCount).toBe(60);
    // The full mesh is hidden rather than switched off: its switch is the
    // crowd's, and it keeps an instance so the warm-up compiles the right
    // shader for it.
    expect(whole.isEnabled()).toBe(true);
    expect(whole.isVisible).toBe(false);
    expect(whole.thinInstanceCount).toBeGreaterThan(0);
  });

  it('takes the copy down when the crowd is hidden from outside', () => {
    const { whole, copy, draw } = crowd(60);
    draw.commit(60);
    setCrowdDetailScale(0);
    scene.render();
    expect(copy.isEnabled()).toBe(true);

    // A staff change: the squad switches the old crowd's full mesh off and
    // stops committing it.
    whole.setEnabled(false);
    scene.render();
    expect(copy.isEnabled()).toBe(false);
  });

  it('switches both meshes off and empties them when the crowd is empty', () => {
    const { whole, copy, draw } = crowd(60);
    draw.commit(60);
    setCrowdDetailScale(0);
    scene.render();
    draw.commit(0);
    expect(whole.isEnabled()).toBe(false);
    expect(copy.isEnabled()).toBe(false);
    expect(whole.thinInstanceCount).toBe(0);
    expect(copy.thinInstanceCount).toBe(0);
  });

  it('counts what it drew', () => {
    const { draw } = crowd(60);
    draw.commit(60);
    setCrowdDetailScale(FULL_DETAIL);
    scene.render();
    expect(draw.stats.whole + draw.stats.small + draw.stats.culled).toBe(60);
    expect(draw.stats.small).toBe(0);
  });
});
