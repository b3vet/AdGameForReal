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
 *   ?endless=1      boot straight onto the endless road instead of a level
 *   ?perf           the scripted performance run; see `PERF_LEVEL` below
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
  /**
   * The scripted performance run (Milestone 9, section D): level `PERF_LEVEL`
   * under the greedy bot, the debug panel up, a thirty-second capture once the
   * warm-up is done, and the device report shown and copied at the end
   * (`./perf.ts`).
   *
   * It is one flag rather than four because it is one *thing the owner does*:
   * open the link on the phone, put it down, pick it up and paste. Every part
   * of it can still be asked for separately — `?level=20&bot=greedy&debug` is
   * the same run without the scripting — and an explicit parameter beside
   * `?perf` wins, so `?perf&level=8` certifies level 8.
   */
  perf: boolean;
  /**
   * Boot straight onto the endless road (D52) rather than the Academy.
   *
   * A probe affordance like `?biome=`: Endless is a card on the picker, and a
   * probe that had to find and tap it would be photographing the picker.
   */
  endless: boolean;
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

/**
 * The level `?perf` certifies on.
 *
 * Twenty is the campaign's last meadow level: the widest crowd, the fullest
 * road and the demon at the end of it, which is the frame the phone has to
 * hold. A save that has not got there yet runs the highest level it has
 * unlocked instead — a report from level 6 is worth having, and a locked level
 * 20 the player has never seen is not the run they are about to play.
 */
export const PERF_LEVEL = 20;

export function clampLevel(level: number, levelCount: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(Math.max(1, Math.floor(level)), levelCount);
}

export function parseQuery(search: string, levelCount: number): QueryOptions {
  const params = new URLSearchParams(search);
  const save = loadSave();

  const perf = parseFlag(params.get('perf'));

  const levelParam = Number.parseInt(params.get('level') ?? '', 10);
  // `?perf` picks the level itself — `PERF_LEVEL`, or the highest the save has
  // reached when that is lower — unless the URL named one, which wins.
  const perfLevel = Math.min(PERF_LEVEL, save.unlockedLevel);
  const level = Number.isFinite(levelParam)
    ? clampLevel(levelParam, levelCount)
    : clampLevel(perf ? perfLevel : save.unlockedLevel, levelCount);

  const botParam = params.get('bot');
  const namedBot: BotKind | null =
    botParam === 'greedy' || botParam === 'human' || botParam === 'random' || botParam === 'worst'
      ? botParam
      : null;
  // Nobody is holding the phone during a scripted capture, and an unsteered
  // squad walks into the first curse it meets — so the run needs a driver, and
  // greedy is the one that plays the road rather than surviving it.
  const bot: BotKind | null = namedBot ?? (perf ? 'greedy' : null);

  const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
  const qualityParam = Number.parseInt(params.get('quality') ?? '', 10);
  const turboParam = Number.parseFloat(params.get('turbo') ?? '');
  const sceneParam = params.get('scene');

  return {
    level,
    bot,
    seed: Number.isFinite(seedParam) ? seedParam : null,
    // The scripted run ends by showing the report in the panel, so the panel
    // has to be up. Like `?debug`, that is written to the save on the way past.
    debug: params.has('debug') || perf,
    scene: parseScene(sceneParam),
    turbo: Number.isFinite(turboParam) ? Math.min(MAX_TURBO, Math.max(1, turboParam)) : 1,
    physicsQuality: parseQuality(params.get('physics')),
    qualityRung: Number.isFinite(qualityParam) ? clampRung(qualityParam) : null,
    muted: save.muted,
    biome: parseBiome(params.get('biome')),
    endless: parseFlag(params.get('endless')),
    perf,
  };
}

/** `?endless`, `?endless=1` and `?endless=true` are all on; `=0` is off. */
function parseFlag(raw: string | null): boolean {
  if (raw === null) return false;
  return raw !== '0' && raw !== 'false';
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
