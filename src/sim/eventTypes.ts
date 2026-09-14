/**
 * What one `tick` tells the world happened.
 *
 * Split out of `./types.ts` in Milestone 8, when the six evolutions (D54) took
 * that file past the size rule (CLAUDE.md). The seam is the one the sim already
 * has: `./types.ts` is the *state* — what a run is at an instant, which render
 * reads every frame — and this is the *news*, which render, audio and the
 * physics layer consume once and discard. `./types.ts` re-exports `SimEvent`,
 * so `@/sim` and every file inside it still import it from one place.
 *
 * Every event is pooled (`./eventPools.ts`), so an object here lives exactly as
 * long as the tick that produced it: anything kept longer must be copied.
 */

import type { EnemyKind, GateKind, Lane, RunStatus, UnitLossReason, WeaponId } from './types';

export type SimEvent =
  | { type: 'projectileFired'; x: number; z: number }
  | { type: 'projectileHit'; weaponId: WeaponId; x: number; z: number }
  | { type: 'gateHit'; gateId: number; kind: GateKind; value: number }
  | {
      type: 'gatePassed';
      gateId: number;
      kind: GateKind;
      value: number;
      countBefore: number;
      countAfter: number;
    }
  | { type: 'enemyActivated'; enemyId: number }
  | { type: 'enemyHit'; enemyId: number; damage: number; hp: number; x: number; z: number }
  | {
      type: 'enemyKilled';
      enemyId: number;
      kind: EnemyKind;
      x: number;
      z: number;
      /** Set when this body belonged to a stream; absent for a block or the boss. */
      streamId?: number;
    }
  | { type: 'enemyLeaked'; enemyId: number; streamId: number; x: number; z: number }
  | { type: 'streamStarted'; streamId: number; lane: Lane; count: number }
  | { type: 'streamCleared'; streamId: number; lane: Lane; leaked: number }
  | {
      type: 'enemyShattered';
      enemyId: number;
      x: number;
      z: number;
      /**
       * Set when this body belonged to a stream, exactly as on `enemyKilled`.
       * A stream is hundreds of single bodies (D29) and the physics layer
       * throws no debris for them, so it has to be able to tell one apart from
       * a block without holding the kill event that came just before.
       */
      streamId?: number;
    }
  | { type: 'enemySlowed'; enemyId: number; seconds: number }
  /** A shielded brute's shield reached zero. Fires once per body (D49). */
  | { type: 'shieldBreak'; enemyId: number; x: number; z: number }
  /**
   * A charger set off, or the Rime Fiend started a charge (D49). `kind` is
   * which of the two, since they look and sound nothing like each other.
   */
  | { type: 'charge'; enemyId: number; kind: EnemyKind; lane: Lane }
  /**
   * A body was set alight by an evolved ember staff. Emitted when the burn
   * *starts*, not on every tick: a tick is four a second on every burning body
   * and a river is hundreds of them, so the ticks are ordinary `enemyHit`s and
   * this is the one render needs to attach a flame for `seconds`.
   */
  | { type: 'enemyBurning'; enemyId: number; x: number; z: number; seconds: number }
  | { type: 'familiarShot'; x: number; z: number; targetId: number }
  /** The wall clamp pushed the squad this step; `boundary` is which side. */
  | { type: 'wallBlocked'; boundary: -1 | 1; x: number; z: number }
  | { type: 'splash'; x: number; z: number; radius: number }
  | { type: 'chain'; from: number; to: number }
  /**
   * Ember tier 4 (D54): a charged shot landed here. Carries its own radius
   * because the crater is the whole of what render draws — there is no
   * projectile, no shooter and no target, only a place the sky hit.
   */
  | { type: 'meteor'; x: number; z: number; radius: number }
  /**
   * Storm tier 4 (D54): the volley arced to everything in range at once.
   * `targets` is how many it actually reached, so render can skip the flash
   * when the road was empty and scale it when it was not.
   */
  | { type: 'overcharge'; x: number; z: number; radius: number; targets: number }
  /** Frost tier 3 (D54): a body that died frozen chilled everything around it. */
  | { type: 'freezePulse'; x: number; z: number; radius: number }
  /**
   * Frost tier 4 (D54): a wall of ice went up across one lane. `until` is the
   * sim time it lets go, so render can hold the mesh for exactly as long as
   * the sim holds the bodies.
   */
  | { type: 'glacier'; lane: Lane; z: number; until: number }
  | { type: 'weaponChanged'; from: WeaponId; to: WeaponId }
  | { type: 'unitsGained'; amount: number; reason: 'gate' }
  | { type: 'unitsLost'; amount: number; reason: UnitLossReason }
  | { type: 'bossActivated'; enemyId: number }
  | { type: 'bossStomp'; x: number; z: number }
  | { type: 'bossEnraged'; enemyId: number }
  | { type: 'bossKilled' }
  | { type: 'runEnded'; status: RunStatus; survivors: number; peakCount: number };
