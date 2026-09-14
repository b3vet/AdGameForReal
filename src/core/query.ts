/**
 * The query string, parsed once at boot.
 *
 * Split out of `App` so the state machine reads as a state machine. Every
 * parameter here is a debugging or scripting affordance — the game itself never
 * writes a URL.
 *
 *   ?level=3        start on a level, ignoring the save's unlock state
 *   ?bot=greedy     hand steering to a scripted policy (greedy|human|random|worst)
 *   ?seed=7         override the level's generator seed
 *   ?debug          show the debug panel
 *   ?turbo=8        run the sim this many times faster than the wall clock
 *   ?physics=0|1|2  physics quality: 0 skips Havok entirely
 *   ?quality=3      pin a rung of the degrade ladder (0 best, 5 worst)
 *   ?screenshot=1   keep the drawing buffer readable, for the smoke's frames
 *   ?scene=stress   the performance scene; ?scene=render-test the render one
 *   ?biome=frost    pin every level to one biome, whatever the level says
 */

import type { BiomeId } from '@/data/biome-types';
import type { PhysicsQuality } from '@/physics';
import type { BotKind } from '@/sim';

import { clampRung } from './quality';
import { loadSave } from './save';

export type SceneKind = 'game' | 'render-test' | 'stress';

export interface QueryOptions {
  level: number;
  bot: BotKind | null;
  seed: number | null;
  debug: boolean;
  scene: SceneKind;
  /** Sim seconds per real second. 1 is normal play; `?turbo=8` is for scripts. */
  turbo: number;
  /** Starting physics quality. The app's degrade ladder may lower it. */
  physicsQuality: PhysicsQuality;
  /**
   * A pinned rung of the degrade ladder (`src/core/quality.ts`), or null for
   * the automatic ladder. Pinning is how a phone's worst case is looked at on
   * a desktop; a pinned ladder never steps on its own.
   *
   * The ladder is six rungs, 0 to 5, and `clampRung` is what says so. Milestone
   * 5 (D38) put the native pixel ratio on top of it and moved the ragdolls to
   * the bottom, so the table is now
   *
   *   0  ratio 3, physics 2      3  ratio 1,   physics 2
   *   1  ratio 2, physics 2      4  ratio 1,   physics 1
   *   2  ratio 1.5, physics 2    5  ratio 1,   physics 0
   *
   * where the ratio is a *ceiling*: rung 0 on a 2x screen renders at 2.
   */
  qualityRung: number | null;
  /** Sound starts muted. Read from the save, not from the URL. */
  muted: boolean;
  /**
   * Pins the look to one biome, or null to follow each level's own (D49).
   *
   * A probe affordance: the campaign decides which levels are Frostfell, and
   * this is how a Frostfell frame is photographed on any level — including the
   * meadow ones the hero set already uses.
   */
  biome: BiomeId | null;
}

/**
 * Ceiling on `?turbo`.
 *
 * Raised from 20 in Milestone 2. The old ceiling assumed a sixteen-millisecond
 * frame, where a frame's worth of fast-forwarded sim starts to cost more than
 * it saves. Milestone 2's scene draws at about one frame a second under the
 * smoke's software rasteriser, so a scripted run's wall clock is frames and
 * nothing else, and sixty ticks of sim per frame still cost single-digit
 * milliseconds. Sixty is what keeps `npm run smoke` inside its five-minute
 * budget; past it the renderer is being handed three-second jumps and the
 * screenshots stop resembling play.
 */
export const MAX_TURBO = 60;

export function clampLevel(level: number, levelCount: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(Math.max(1, Math.floor(level)), levelCount);
}

export function parseQuery(search: string, levelCount: number): QueryOptions {
  const params = new URLSearchParams(search);
  const save = loadSave();

  const levelParam = Number.parseInt(params.get('level') ?? '', 10);
  const level = Number.isFinite(levelParam)
    ? clampLevel(levelParam, levelCount)
    : clampLevel(save.unlockedLevel, levelCount);

  const botParam = params.get('bot');
  const bot: BotKind | null =
    botParam === 'greedy' || botParam === 'human' || botParam === 'random' || botParam === 'worst'
      ? botParam
      : null;

  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const qualityParam = Number.parseInt(params.get('quality') ?? '', 10);
  const turboParam = Number.parseFloat(params.get('turbo') ?? '');
  const sceneParam = params.get('scene');

  return {
    level,
    bot,
    seed: Number.isFinite(seedParam) ? seedParam : null,
    debug: params.has('debug'),
    scene: parseScene(sceneParam),
    turbo: Number.isFinite(turboParam) ? Math.min(MAX_TURBO, Math.max(1, turboParam)) : 1,
    physicsQuality: parseQuality(params.get('physics')),
    qualityRung: Number.isFinite(qualityParam) ? clampRung(qualityParam) : null,
    muted: save.muted,
    biome: parseBiome(params.get('biome')),
  };
}

function parseBiome(raw: string | null): BiomeId | null {
  if (raw === 'frost') return 'frost';
  if (raw === 'meadow') return 'meadow';
  return null;
}

function parseScene(raw: string | null): SceneKind {
  if (raw === 'render-test') return 'render-test';
  if (raw === 'stress') return 'stress';
  return 'game';
}

function parseQuality(raw: string | null): PhysicsQuality {
  if (raw === '0') return 0;
  if (raw === '1') return 1;
  return 2;
}
