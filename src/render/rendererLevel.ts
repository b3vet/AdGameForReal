/**
 * Loading a level into the scene, and repainting it in a biome (D49).
 *
 * Split out of `./Renderer.ts` in Milestone 7 Phase E for the file-size rule
 * (CLAUDE.md). It is the *sequence* that matters and that is what lives here:
 * the palette moves, then the scene, then the views, then the level's own
 * layout. `Renderer` keeps the one thing a sequence cannot own — which biome
 * the scene is currently painted in — and decides when to run this.
 */

import type { Scene } from '@babylonjs/core/scene';

import type { BiomeSpans } from './biomeSpans';
import type { CameraRig } from './camera';
import { setBiome as setPaletteBiome } from './palette';
import { applyBiomeToScene } from './scene';
import { ROAD_PAST_ARENA, ROAD_START_Z } from './theme';
import type { SceneViews } from './views';
import type { BiomeId } from '@/data/biome-types';
import type { LevelDef } from '@/sim';

/**
 * Repaints the whole scene in a biome.
 *
 * The palette switches first and the views re-read their roles after, which is
 * the whole order: `./palette.ts` rewrites every `Color3` a role has handed out
 * *in place*, so a material or a module constant holding one follows on its
 * own, and everything baked from a role — a vertex buffer, a painted texture, a
 * copied material colour — is repainted by the views.
 *
 * Nothing is allocated: every biome's ground albedo and every biome's prop
 * meshes are built at boot precisely so that this is a swap. The warm-up pass
 * the caller runs afterwards is therefore a no-op in the normal case, and the
 * guarantee that it stays one — a material that somehow did arrive late is
 * compiled during the level's load rather than inside the frame that draws it.
 */
export function repaintBiome(scene: Scene | null, views: SceneViews | null, id: BiomeId): void {
  setPaletteBiome(id);
  if (scene !== null) applyBiomeToScene(scene);
  views?.setBiome(id);
}

/**
 * The biome for the span the camera stands in, and the crossfade around the
 * boundary ahead of it (D52).
 *
 * Two things happen here and they happen at different moments. The *road* is
 * already right: its far half was laid in the next span's biome when the last
 * boundary was crossed, so there is nothing to change ahead of the camera.
 * What changes at the boundary is everything keyed to "the biome in force" —
 * the palette, the props' tint, the sky and the fog — and that switch is made
 * as the camera crosses, where the part of the road it would repaint is behind
 * the lens. The sky and the fog then *cross* that boundary rather than jumping
 * at it, over a few metres either side (`./biomeSpans.ts`).
 *
 * `setBiome` is the renderer's own, so the switch still goes through the one
 * place that knows which biome the scene is painted in.
 */
export function applySpan(
  spans: BiomeSpans,
  cameraZ: number,
  force: boolean,
  setBiome: (id: BiomeId) => void,
  scene: Scene | null,
  views: SceneViews | null,
): void {
  if (!spans.active) return;
  const index = spans.indexAt(cameraZ);
  if (force || index !== spans.current) {
    spans.setCurrent(index);
    setBiome(spans.biomeOf(index));
    views?.road.setSpanIndex(index);
  }
  spans.blendSky(scene, views, cameraZ);
}

/**
 * Builds the road for this level and hands every pool back to its owner.
 *
 * The road runs `ROAD_PAST_ARENA` beyond the fight because the camera can stand
 * at the arena and look down the rest of it (`./roadLook.ts`), and the camera
 * is reset last so the first frame of a level is framed on the squad's start
 * rather than easing over from wherever the last one ended.
 */
export function loadLevelInto(
  views: SceneViews | null,
  rig: CameraRig | null,
  level: LevelDef,
  spans: BiomeSpans,
): void {
  views?.loadLevel(level, ROAD_START_Z, level.arenaZ + ROAD_PAST_ARENA, spans);
  rig?.reset();
}
