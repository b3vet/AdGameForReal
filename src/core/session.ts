/**
 * One playthrough: the level it is played on, the `Run` that is the game, the
 * policy steering it when a bot does, the beat the app holds before the result
 * screen, and what the player met on the way (the bestiary, D33).
 *
 * Split out of `App` so the state machine is about screens and the session is
 * about a run. The Academy's backdrop is a session too — one that is never
 * ticked — which is why the renderer can be handed a real level and a real
 * state behind the menu without the app growing a second code path.
 */

import { balance, levelCount } from '@/data';
import { createBot } from '@/sim';
import type { EnemyKind, LevelDef, Run, RunState, SimEvent } from '@/sim';

import { bossIdOf, buildLevel, buildRun } from './player';
import type { PlayerState } from './player';
import type { QueryOptions } from './query';
import { unlockLevel } from './save';

/** Steers the squad in place of a finger; see `createBot`. */
export type BotPolicy = (state: RunState) => number;

export class RunSession {
  readonly level: LevelDef;
  readonly run: Run;
  /**
   * Constructed once per session: the policy carries its own RNG stream, so
   * rebuilding it every tick would reset that stream and break determinism.
   */
  readonly bot: BotPolicy | null;

  /**
   * Bestiary ids met in this run. Small and append-only: the app reads it once,
   * when the run ends.
   */
  readonly seen = new Set<string>();

  private readonly bossId: string;

  /** Seconds left of the beat before the result screen, or null. */
  private countdown: number | null = null;

  /**
   * Both block kinds seen, so `absorb` can stop looking things up. A stream
   * fires `enemyActivated` about twenty times a second (D29) and the lookup is
   * a scan of the enemy array; after the first grunt and the first brute there
   * is nothing left for it to find.
   */
  private sawGrunt = false;
  private sawBrute = false;

  constructor(levelIndex: number, options: QueryOptions, player: PlayerState) {
    this.level = buildLevel(levelIndex, options.seed, player);
    this.run = buildRun(this.level, balance, player);
    this.bot = options.bot === null ? null : createBot(options.bot, this.level.seed);
    this.bossId = bossIdOf(this.level);
  }

  get state(): RunState {
    return this.run.state;
  }

  get won(): boolean {
    return this.run.state.status === 'won';
  }

  get finished(): boolean {
    return this.run.state.status !== 'running';
  }

  /** Hands the bot's decision to the run, if this session has one. */
  steer(): void {
    if (this.bot !== null && this.run.state.status === 'running') {
      this.run.setTargetX(this.bot(this.run.state));
    }
  }

  /**
   * Notes what the player has met, for the Bestiary.
   *
   * Kinds rather than bodies: the cards are grunt, brute and the level's boss,
   * so the whole job is answering "has one of these been on screen alive". A
   * body is only looked up while a kind is still missing, and the boss costs
   * nothing at all — `bossActivated` is one event per run.
   */
  absorb(events: readonly SimEvent[]): void {
    for (const event of events) {
      if (event.type === 'bossActivated') {
        this.seen.add(this.bossId);
        continue;
      }
      if (event.type !== 'enemyActivated') continue;
      if (this.sawGrunt && this.sawBrute) continue;

      const kind = this.kindOf(event.enemyId);
      if (kind === 'grunt') {
        this.sawGrunt = true;
        this.seen.add('grunt');
      } else if (kind === 'brute') {
        this.sawBrute = true;
        this.seen.add('brute');
      } else if (kind === 'boss') {
        this.seen.add(this.bossId);
      }
    }
  }

  /**
   * Holds the result screen back for a beat so the killing blow is visible, and
   * returns true on the frame it should show.
   *
   * `dt` is unclamped wall-clock time: the beat is a beat, not a frame count.
   * The unlock happens as soon as the run is won rather than when the player
   * taps Ascend, so closing the tab on the result screen keeps the progress.
   */
  advanceEnding(dt: number, levelIndex: number): boolean {
    if (this.countdown === null) {
      if (!this.finished) return false;
      this.countdown = balance.ui.resultDelay;
      if (this.won && levelIndex < levelCount) unlockLevel(levelIndex + 1);
      return false;
    }

    this.countdown -= dt;
    if (this.countdown > 0) return false;
    this.countdown = null;
    return true;
  }

  /** Backwards: a body that has just activated is near the end of the array. */
  private kindOf(id: number): EnemyKind | null {
    const enemies = this.run.state.enemies;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const enemy = enemies[i];
      if (enemy !== undefined && enemy.id === id) return enemy.kind;
    }
    return null;
  }
}
