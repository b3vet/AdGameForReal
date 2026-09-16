/**
 * The roads and scenes that are not the campaign: `?scene=stress`,
 * `?scene=render-test` and `?beat=`.
 *
 * Split out of `App` in Milestone 8 for the file-size rule (CLAUDE.md). The two
 * scenes belong outside the state machine, because they *bypass* it: both
 * drive the renderer themselves, so there is no session, no HUD, no frame loop
 * and no phase while one is up. All `App` keeps is the handle that stops them
 * again.
 *
 * `?beat=` is the other way round (document 31, 4.1): a designed beat on a
 * short road with no boss, played through the whole app — the HUD, the drag,
 * the pause menu, the bots — because a beat is only felt with a thumb on it.
 * What lives here is the road; the run on it is `RunStage.startBeat`.
 */

import { beats } from '@/data';
import type { BeatDef, BiomeId } from '@/data/types';
import type { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import type { PhysicsQuality } from '@/physics';
import { buildBeatLevel } from '@/sim';
import type { LevelDef } from '@/sim';

import type { PlayerState } from './player';
import { runStressScene } from './stress';
import type { StressHandle } from './stress';
import type { BeatPin, SceneKind } from './query';

/** The seed a `?beat=` road is laid on when the URL names none. */
export const BEAT_SEED = 1;

/** Whatever was started, with the one call that takes it down again. */
export interface DevScene {
  dispose: () => void;
}

/**
 * Starts the scene `kind` names. The caller has already hidden the overlay:
 * these scenes draw into the same canvas and there is nothing on them to tap.
 */
export async function startDevScene(
  kind: Exclude<SceneKind, 'game'>,
  renderer: Renderer,
  quality: PhysicsQuality,
): Promise<DevScene> {
  if (kind === 'render-test') {
    // Structural on purpose: the handle's shape is the render layer's to
    // change, and the app only ever stops it.
    const scene: { stop: () => void } = runRenderDevScene(renderer);
    return { dispose: () => { scene.stop(); } };
  }
  const stress: StressHandle = await runStressScene(renderer, { quality });
  return { dispose: () => { stress.dispose(); } };
}

/**
 * The one-beat road `pin` names, or null when there is none to build.
 *
 * Every way this can go wrong is a URL typed by hand, so each one is a console
 * warning and a normal boot rather than a thrown error: a beat the library does
 * not have names the ones it does, and a tier it does not have plays the
 * nearest one below it (or its first) and says so.
 *
 * The road is built for the squad the pin names and played with the player's
 * own kit, as the campaign would play it. A beat with a charger or a shielded
 * brute in it is a Frostfell beat (document 31, 3.9), so it is sized and
 * painted there unless `?biome=` says otherwise.
 */
export function beatRoad(
  pin: BeatPin,
  seed: number | null,
  biome: BiomeId | null,
  player: PlayerState,
): LevelDef | null {
  const def = beats.defs.find((candidate) => candidate.id === pin.id);
  if (def === undefined) {
    const known = beats.defs.map((candidate) => candidate.id).join(', ');
    console.warn(`[arcane-rush] ?beat=${pin.id}: no such beat in beats.json (known: ${known})`);
    return null;
  }
  const tier = tierFor(def, pin.tier);
  if (tier === null) {
    console.warn(`[arcane-rush] ?beat=${pin.id}: the beat has no tiers`);
    return null;
  }
  if (tier !== pin.tier) {
    const tiers = tiersOf(def).join(', ');
    console.warn(
      `[arcane-rush] ?beat=${pin.id}:${String(pin.tier)}: no such tier (${pin.id} has ${tiers}); ` +
        `playing tier ${String(tier)}`,
    );
  }
  try {
    return buildBeatLevel(pin.id, tier, pin.count, seed ?? BEAT_SEED, biome ?? biomeOf(def), {
      player,
      ...(pin.prize === null ? {} : { prize: pin.prize }),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[arcane-rush] ?beat=${pin.id}:${String(tier)}: ${reason}`);
    return null;
  }
}

/** The tiers a beat defines, in order. */
function tiersOf(def: BeatDef): number[] {
  return Object.keys(def.tiers)
    .map((key) => Number.parseInt(key, 10))
    .filter((tier) => Number.isFinite(tier))
    .sort((a, b) => a - b);
}

/** `wanted` if the beat has it, else the nearest tier below it, else its first. */
function tierFor(def: BeatDef, wanted: number): number | null {
  const tiers = tiersOf(def);
  if (tiers.includes(wanted)) return wanted;
  let best: number | null = null;
  for (const tier of tiers) if (tier <= wanted) best = tier;
  return best ?? tiers[0] ?? null;
}

/** Frostfell for a beat that stands a Frostfell kind at any tier. */
function biomeOf(def: BeatDef): BiomeId {
  for (const key of Object.keys(def.tiers)) {
    for (const enemy of def.tiers[key]?.enemies ?? []) {
      if (enemy.kind === 'charger' || enemy.kind === 'shieldBrute') return 'frost';
    }
  }
  return 'meadow';
}
