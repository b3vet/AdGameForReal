/**
 * The charger (D49): the one body on the road that is drawn as itself rather
 * than as a block of skeletons.
 *
 * It is still a crowd — the same thin-instanced VAT machinery every other
 * character uses (`./characters/VatCrowd.ts`) — because that is what costs one
 * draw call for every charger on the level and needs no per-body material. A
 * level deals at most `POOL.chargers` of them, which is its own row count
 * rather than a guess (`./pools.ts`).
 *
 * What it draws is the sim's own state, read and never remembered: `idle`
 * while the body has not triggered, `run` from the step it commits to a lane
 * (`EnemyState.charge`), and — because the sim kills a charger the moment it
 * reaches the crowd — `attack` into `death` when it died at the squad's feet,
 * or `death` alone when it was shot out of the lane on the way in. The dust it
 * tears off the road is a pooled emitter in the shared ground-decal batch, so
 * the trail costs no draw call either.
 *
 * Split out of `./enemies.ts`, which is about binding bodies to slots and
 * painting their numbers; this is one kind's geometry and clips.
 */

import type { Scene } from '@babylonjs/core/scene';

import type { Crowd } from './characters';
import { FrostSpray } from './frostSpray';
import type { GroundDecals } from './groundDecals';
import { loadCrowd } from './models';
import type { ShadowLayer } from './shadows';
import {
  CHARGER_LEAN_MAX,
  CHARGER_LEAN_PER_METRE,
  CHARGER_SCALE,
  CHARGER_SPRAY_BEHIND,
  CHARGER_SPRAY_COLOR,
  CHARGER_SPRAY_SIZE,
  CHARGER_SPRAY_SPREAD,
  ENEMY_COLOR,
  POOL,
  SHADOW,
} from './theme';

/** Bodies face the squad, which is behind them down the road. */
const FACING = Math.PI;

/**
 * How a dead charger is being taken off the road.
 *
 * `shot` is the ordinary one — it fell where the fire caught it. `arrived` is
 * the charger that reached the crowd, which the sim resolves as a kill on the
 * same step it takes its bite: the body swings first and falls afterwards, so
 * what the player sees is the thing that just cost them six apprentices.
 */
export type ChargerDeath = 'shot' | 'arrived';

/** The four baked ranges this view plays, in the order it falls back through. */
const CLIPS = ['idle', 'run', 'attack', 'death'] as const;
type Clip = (typeof CLIPS)[number];

export class ChargerBodies {
  private readonly dust = new FrostSpray(
    CHARGER_SPRAY_SIZE,
    CHARGER_SPRAY_COLOR,
    CHARGER_SPRAY_SPREAD,
  );
  private crowd: Crowd | null = null;
  private written = 0;
  /**
   * What each clip resolves to on the crowd that actually loaded.
   *
   * `VatCrowd` *throws* on a range its bake does not carry, and it throws from
   * `setInstance` — which is the frame path. So the four are resolved once,
   * here, and a bake missing one falls back to a range it does have rather than
   * taking the app down on the frame a charger first moves.
   */
  private readonly clips = new Map<Clip, string>();
  /** The baked clips' own lengths, so the one-shots play exactly once. */
  private attackSeconds = 0.6;
  private deathSeconds = 1;

  async load(scene: Scene): Promise<void> {
    const crowd = await loadCrowd(scene, {
      modelId: 'charger',
      capacity: POOL.chargers,
      fallbackColor: ENEMY_COLOR,
      fallbackName: 'charger',
    });
    this.crowd = crowd;
    const have = CLIPS.filter((id) => secondsOf(crowd, id) !== null);
    const fallback = have[0] ?? 'idle';
    for (const id of CLIPS) this.clips.set(id, have.includes(id) ? id : fallback);
    this.attackSeconds = secondsOf(crowd, this.clip('attack')) ?? this.attackSeconds;
    this.deathSeconds = secondsOf(crowd, this.clip('death')) ?? this.deathSeconds;
  }

  /** The baked range that stands in for one of the four. */
  private clip(id: Clip): string {
    return this.clips.get(id) ?? id;
  }

  /** How long a body is kept after it dies, by how it died. */
  deathLength(style: ChargerDeath): number {
    return style === 'arrived' ? this.attackSeconds + this.deathSeconds : this.deathSeconds;
  }

  reset(): void {
    this.dust.clear();
    this.written = 0;
    this.crowd?.setCount(0);
    this.crowd?.commit();
  }

  /** Once a frame, before any body is written. */
  begin(): void {
    this.written = 0;
  }

  /**
   * One live charger. `laneGap` is how far it still has to travel across the
   * road to reach the lane it committed to, which is both its lean and the
   * direction its dust is thrown; 0 for a body that has not triggered.
   */
  writeLive(
    id: number,
    x: number,
    z: number,
    charging: boolean,
    laneGap: number,
    shadows: ShadowLayer | null,
    shadowAlpha: number,
    dt: number,
  ): void {
    const crowd = this.crowd;
    if (crowd === null || this.written >= crowd.capacity) return;
    // Derived from the body's id rather than from anything that moves: the
    // shader's clock is `sharedTime + offset`, so an offset that changed with
    // the body's position would stutter the run instead of playing it (the
    // same rule the stream bodies follow, `./streamBodies.ts`).
    const phase = (id % 37) * 0.043;
    const lean = charging ? clampLean(laneGap) : 0;
    crowd.setInstance(
      this.written,
      x,
      0,
      z,
      FACING + lean,
      CHARGER_SCALE,
      this.clip(charging ? 'run' : 'idle'),
      phase,
    );
    this.written++;
    if (shadows !== null && shadowAlpha > 0) shadows.add(x, z, SHADOW.charger, shadowAlpha);
    // Behind it, because it is running at the camera: the dust is what it has
    // already torn up, not what it is about to.
    if (charging) this.dust.emit(x, z + CHARGER_SPRAY_BEHIND, laneGap, dt);
  }

  /**
   * One dying charger, `age` seconds into its death. A body that arrived plays
   * its swing first and falls out of it; one that was shot simply falls.
   *
   * Speed 0 is what makes a looping baked range play a one-shot exactly once:
   * the shader's clock is `offset` alone at that speed, so the offset *is* the
   * frame (`VatCrowd.setInstance`, and docs/ASSETS.md open issue 4).
   */
  writeDying(x: number, z: number, age: number, style: ChargerDeath): void {
    const crowd = this.crowd;
    if (crowd === null || this.written >= crowd.capacity) return;
    const swinging = style === 'arrived' && age < this.attackSeconds;
    const into = swinging ? age : Math.max(0, age - (style === 'arrived' ? this.attackSeconds : 0));
    crowd.setInstance(
      this.written,
      x,
      0,
      z,
      FACING,
      CHARGER_SCALE,
      this.clip(swinging ? 'attack' : 'death'),
      into,
      0,
    );
    this.written++;
  }

  /** Uploads the frame's bodies and draws the dust. Once a frame, after both. */
  commit(decals: GroundDecals | null, dt: number): void {
    const crowd = this.crowd;
    if (crowd !== null) {
      crowd.setCount(this.written);
      crowd.commit();
      crowd.update(dt);
    }
    if (decals !== null) this.dust.draw(decals, dt);
  }

  /** Bodies drawn last frame, for the debug panel and the dev harness. */
  get count(): number {
    return this.written;
  }

  dispose(): void {
    this.crowd?.dispose();
    this.crowd = null;
  }
}

/** A range's length, or null when the bake does not carry it. */
function secondsOf(crowd: Crowd, id: string): number | null {
  try {
    return crowd.durationOf(id);
  } catch {
    // A bake without this range. The caller falls back to one it has.
    return null;
  }
}

/**
 * Turn toward the lane it is crossing to, capped so it never runs sideways.
 *
 * Negated because the body already faces down the road: a yaw of `FACING` looks
 * along -z, and Babylon's left-handed yaw turns that toward -x, so a body that
 * has to move toward +x leans by a *negative* offset.
 */
function clampLean(laneGap: number): number {
  const lean = -laneGap * CHARGER_LEAN_PER_METRE;
  if (lean > CHARGER_LEAN_MAX) return CHARGER_LEAN_MAX;
  if (lean < -CHARGER_LEAN_MAX) return -CHARGER_LEAN_MAX;
  return lean;
}
