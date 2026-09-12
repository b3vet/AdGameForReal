/**
 * Ember's evolution (D33, tier 2): the bodies a burning staff has set alight.
 *
 * Read off the sim's state rather than off events. `Burn.ignite` writes
 * `EnemyState.burning` and `burnUntil` on the body itself and clears them the
 * step the fire goes out, so "is this thing on fire right now" is a field, not
 * a subscription — which matters because a river is three hundred bodies dying
 * and being recycled, and a view holding its own list of burning ids would have
 * to be told about every one of those deaths. The `enemyBurning` event exists
 * for audio and physics; this needs none of it.
 *
 * What a burning body gets is a soft additive wash the size of its footprint
 * plus a flame licking off the top of it, both billboarded quads in the shared
 * sprite batch (`./sprites.ts`). The wash *is* the "ember tint": the crowds are
 * one baked-animation mesh with one material and no per-instance colour
 * (`./characters/VatCrowd.ts`), so there is nowhere to tint a single skeleton —
 * and an additive warm wash over the body is what a tint looks like anyway.
 *
 * Capped at `POOL.burning` bodies a frame, with the starting point rotating, so
 * a river entirely alight is a field of flames rather than six hundred quads
 * and an empty sprite pool.
 */

import type { SpriteLayer } from './sprites';
import { bookCellLooping } from './spriteSheets';
import {
  BURN_COLOR,
  BURN_DRAW_RANGE,
  BURN_FLAME_FPS,
  BURN_FLAME_SIZE,
  BURN_FLAME_Y,
  BURN_SPARK_EVERY,
  BURN_SPARK_SIZE,
  BURN_WASH_SIZE,
  LABEL_BEHIND,
  POOL,
} from './theme';
import { enemyHalfWidth } from '@/sim';
import { balance } from '@/data';
import type { EnemyState, RunState } from '@/sim';

export class BurnView {
  private readonly sprites: SpriteLayer;
  /** Rotates the window into the burning bodies, frame by frame. */
  private cursor = 0;
  private phase = 0;
  private drawnCount = 0;

  constructor(sprites: SpriteLayer) {
    this.sprites = sprites;
  }

  reset(): void {
    this.cursor = 0;
    this.phase = 0;
    this.drawnCount = 0;
  }

  /** Bodies drawn alight last frame, for the debug panel and the harness. */
  get drawn(): number {
    return this.drawnCount;
  }

  update(state: RunState, dt: number): void {
    this.phase += dt;
    const enemies = state.enemies;
    const squadZ = state.squad.z;
    const time = state.time;
    let drawn = 0;

    // One pass from a rotating start, wrapping once: every burning body gets
    // its turn over a handful of frames without the list being sorted.
    const total = enemies.length;
    if (total === 0) {
      this.drawnCount = 0;
      return;
    }
    const start = this.cursor % total;
    for (let step = 0; step < total && drawn < POOL.burning; step++) {
      const enemy = enemies[(start + step) % total];
      if (enemy === undefined || !alight(enemy, time)) continue;
      const ahead = enemy.z - squadZ;
      if (ahead > BURN_DRAW_RANGE || ahead < -LABEL_BEHIND) continue;
      this.draw(enemy, drawn);
      drawn++;
    }
    // Advance past what was drawn, so the next frame starts where this one
    // ran out; a crowd under the cap simply sees the same bodies every frame.
    this.cursor = drawn >= POOL.burning ? (start + POOL.burning) % total : 0;
    this.drawnCount = drawn;
  }

  private draw(enemy: EnemyState, index: number): void {
    // The sim's own half-width, which is what tells a block from a body: a
    // block is many skeletons in one footprint and its wash has to cover them,
    // while a stream body is one person and carries `streams.footprint`.
    const width = Math.max(0.5, enemyHalfWidth(enemy, balance));

    this.sprites.add(
      bookCellLooping('sparkle', this.phase * 1.5 + index * 0.17),
      enemy.x,
      BURN_FLAME_Y * 0.6,
      enemy.z,
      width * BURN_WASH_SIZE,
      BURN_COLOR.r,
      BURN_COLOR.g,
      BURN_COLOR.b,
      0.45,
    );

    // The flame itself: the ember projectile's own book, which is a fireball
    // with a lick coming off it — exactly the shape a body on fire wants, and
    // no extra cells on the sheet.
    this.sprites.add(
      bookCellLooping('ember', (this.phase + index * 0.31) * (BURN_FLAME_FPS / 12)),
      enemy.x,
      BURN_FLAME_Y,
      enemy.z,
      BURN_FLAME_SIZE * Math.min(1.6, 0.8 + width * 0.4),
      BURN_COLOR.r,
      BURN_COLOR.g,
      BURN_COLOR.b,
      0.9,
    );

    // And the odd spark thrown clear, on a rotation rather than every body
    // every frame: at forty-eight flames, all of them spitting is a bonfire.
    if ((index + Math.floor(this.phase * 30)) % BURN_SPARK_EVERY !== 0) return;
    const swirl = this.phase * 3 + index;
    this.sprites.add(
      bookCellLooping('sparkle', swirl),
      enemy.x + Math.cos(swirl) * width * 0.4,
      BURN_FLAME_Y + 0.35,
      enemy.z + Math.sin(swirl) * 0.25,
      BURN_SPARK_SIZE,
      BURN_COLOR.r,
      BURN_COLOR.g,
      BURN_COLOR.b,
      0.85,
    );
  }
}

/**
 * Is this body alight right now?
 *
 * Both halves are checked because both can go stale for a frame: `burning` is
 * cleared by the burn's own update, which runs once a step and not at all after
 * the run ends, and `burnUntil` is the deadline that says the fire is over even
 * if nothing has swept it yet.
 */
function alight(enemy: EnemyState, time: number): boolean {
  return enemy.alive && enemy.burning === true && (enemy.burnUntil ?? 0) > time;
}
