/**
 * The frame: which view writes into which shared buffer, and in what order.
 *
 * Split out of `./Renderer.ts` in Milestone 7 Phase E for the file-size rule
 * (CLAUDE.md). It is one function on purpose — the order below *is* the
 * content, and every line of it has a reason that only makes sense next to the
 * line before it. `./views.ts` deliberately does not own this: the order is the
 * frame's business, not the bundle's.
 *
 * Nothing here allocates and nothing here mutates sim state.
 */

import type { CameraRig } from './camera';
import type { PreviewBackdrop } from './preview';
import { writeBossShadow } from './shadows';
import type { SceneViews } from './views';
import { weaponOf } from '@/sim';
import type { RunState, SimEvent } from '@/sim';

export interface FrameContext {
  views: SceneViews;
  rig: CameraRig;
  preview: PreviewBackdrop;
  /**
   * The ratio between the sim time this frame covers and the wall clock it
   * took. The boss's animation groups run on the scene's own clock, so this is
   * what carries the app's hit-stop and slow-mo through to them.
   */
  timeScale: number;
}

/**
 * Writes every view for one frame. `events` are the events from the tick this
 * frame draws, in the order the sim produced them: they start animations, while
 * every position comes from `state`. `dt` is sim time, which the app scales for
 * hit-stop and slow-mo, so every animation here is driven by it rather than by
 * the frame clock.
 *
 * The caller renders the scene afterwards; this only fills the buffers.
 */
export function drawFrame(
  context: FrameContext,
  state: RunState,
  events: readonly SimEvent[],
  dt: number,
): void {
  const { views, rig, preview } = context;

  views.events.observe(state.boss?.id, weaponOf(state.squad));
  views.events.apply(events);

  // Before any view writes into it: the roadside's own blobs are already in
  // the buffer and this rewinds to just past them (`./shadows.ts`).
  views.shadows.begin();
  // The marks on the road are opened with the shadows, because that is what
  // they are drawn among: a charger's dust and the Rime Fiend's wake
  // (`./groundDecals.ts`).
  views.decals.begin();

  // The sprite batch is opened before anything writes into it and closed
  // after everything has: projectiles, their trails, impacts and flashes all
  // land in the same buffer and the same draw call. The squad is inside it
  // rather than before it because the dust its units kick up at a fence goes
  // into the same batch (`./squadDust.ts`).
  views.sprites.begin();
  views.squad.update(state, dt, views.shadows, views.sprites);
  views.projectiles.update(state.projectiles, weaponOf(state.squad), dt);
  views.gates.update(state, dt);
  views.enemies.update(state, dt, views.shadows);
  // The sim's clock as well as the frame's: `EnemyState.charge.until` is an
  // absolute sim time, and it is what tells the Rime Fiend's run in from its
  // walk home (D49).
  views.boss.update(state.boss, state.squad.z, dt, context.timeScale, state.time);
  views.effects.update(dt);
  // After the enemies, because both read positions the enemy view has just
  // refreshed: the wall's flare sprite and the wisp's spark, which homes on
  // its target through `EnemyView.positionOf`.
  views.walls.update(state.squad.z, dt);
  views.wisp.update(preview.familiarFor(state), views.events.targetLookup, dt);
  views.burn.update(state, dt);
  views.sprites.end();
  // After both views that emit one, and before the shadows close: the decals
  // are a ground layer and this is the frame's one upload of it.
  views.decals.end();

  // The boss's own blob, and the frame's one upload of the whole buffer.
  writeBossShadow(views.shadows, state);

  rig.update(state.squad, dt);
  // After the rig, because the sky rides on the camera: a dome that follows a
  // frame late shears against the fog on a fast lateral drag.
  const camera = rig.camera;
  views.road.update(camera.position.x, camera.position.z, dt);
  views.sky.update(camera.position.x, camera.position.z, dt);

  // Last, and after the rig: every label is billboarded against the camera's
  // final pose for this frame, so a number never lags the thing it names.
  views.labels.commit();
}

/**
 * The crowd and its blob shadows and nothing else, for a caller that renders
 * the scene itself: the stress scene (`src/core/stress.ts`), whose whole job is
 * to measure the frame the game draws at five hundred units.
 *
 * It opens and closes both shared buffers around the one view that writes into
 * them here, exactly as `drawFrame` does, so the scene measures the real path —
 * the interpolation, the flags, the five hundred instance writes and the five
 * hundred contact patches — rather than a crowd written once at startup and
 * left there.
 */
export function drawSquadOnly(views: SceneViews, state: RunState, dt: number): void {
  views.shadows.begin();
  views.sprites.begin();
  views.squad.update(state, dt, views.shadows, views.sprites);
  views.sprites.end();
  views.shadows.commit();
}
