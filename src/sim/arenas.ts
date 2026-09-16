/**
 * The endless road's bosses, as a run meets them (document 28).
 *
 * A campaign level has one boss and it is the end of the level: the squad stops
 * at `arenaZ`, and the kill is the win. The endless road has one every few
 * hundred metres and none of them is the end. So on that road `RunState.arenaZ`
 * is the *next* line the squad stops at — the line of the boss it has still to
 * beat, or the road's own end once the last one is down — and everything that
 * already reads it keeps its meaning: the column halts there, stragglers halt
 * there, nothing past it wakes while the fight is on (`contact.ts`,
 * `streams.ts`), and render stands the crowd to fight when it gets there.
 *
 * Two moments, and they are kept apart on purpose. The kill opens the road: the
 * line moves on at once, so the column walks away from the fight in the step
 * after the killing blow. The *boss on the state* moves on later, when the
 * column has walked past the body. Until then `RunState.boss` is the one that
 * fell, which is what every reader of the kill needs it to be — the tracker
 * crediting the right boss, render playing the death where the body stands,
 * the bar hiding rather than opening on the next one.
 *
 * Every boss was built with the world (`spawn.ts`), so this allocates nothing.
 */

import type { LevelDef } from './level';
import type { EnemyState, RunState } from './types';
import type { Balance } from '@/data/types';

export class Arenas {
  private readonly level: LevelDef;
  private readonly bosses: readonly EnemyState[];
  /** How long any body stays on the road once it has died (`enemies.corpseSeconds`). */
  private readonly corpseSeconds: number;
  /** Index into `bosses` of the one on the state. */
  private current = 0;
  /** Sim time the fallen boss's line lets the column go, or -1 while none has fallen. */
  private openAt = -1;

  constructor(level: LevelDef, bosses: readonly EnemyState[], balance: Balance) {
    this.level = level;
    this.bosses = bosses;
    this.corpseSeconds = balance.enemies.corpseSeconds;
  }

  /** Where the squad stops first: the first arena, or the road's end without one. */
  get firstLine(): number {
    return this.level.arenas?.[0]?.z ?? this.level.arenaZ;
  }

  /** The share of the stomp and the grind the boss on the state bites with (D31). */
  get bite(): number {
    return this.level.arenas?.[this.current]?.bite ?? 1;
  }

  /**
   * The boss on the state is dead: the road opens to the next line once the
   * column has stood over the body for its stop's `hold`. That beat is the
   * kill's — the slow-mo, the death, the body going into the road — and a
   * column that walked on at once walked through a boss still falling.
   */
  opened(state: RunState): void {
    this.openAt = state.time + Math.max(0, this.level.arenas?.[this.current]?.hold ?? 0);
    this.release(state);
  }

  /** Moves the line on when the hold is over. Called every step, before anyone walks. */
  release(state: RunState): void {
    if (this.openAt < 0 || state.time < this.openAt) return;
    this.openAt = -1;
    state.arenaZ = this.level.arenas?.[this.current + 1]?.z ?? this.level.arenaZ;
  }

  /**
   * Puts the next boss on the state once the column is past the one that fell,
   * and returns it so `Run` can file it for the sweeps; null on every other
   * step. Never before the body has lain as long as any corpse does: the Rime
   * Fiend can die mid-charge *behind* the column's front, and the step after
   * its death is too soon for anything reading the kill to find it gone. The
   * last boss's body stays on the state for the rest of the road: a dead boss
   * is one every reader already knows how to ignore.
   */
  advance(state: RunState): EnemyState | null {
    const boss = state.boss;
    if (boss === null || boss.alive || state.squad.z < boss.z) return null;
    if (state.time - (boss.diedAt ?? 0) < this.corpseSeconds) return null;
    const next = this.bosses[this.current + 1];
    if (next === undefined) return null;
    this.current++;
    state.boss = next;
    return next;
  }
}
