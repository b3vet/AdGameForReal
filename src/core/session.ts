/**
 * One playthrough: the level it is played on, the `Run` that is the game, the
 * policy steering it when a bot does, and the beat the app holds before the
 * result screen.
 *
 * Split out of `App` so the state machine is about screens and the session is
 * about a run. The title screen's backdrop is a session too — one that is never
 * ticked — which is why the renderer can be handed a real level and a real
 * state behind the menu without the app growing a second code path.
 */

import { balance, levelConfig, levelCount } from '@/data';
import { Run, createBot, generateLevel } from '@/sim';
import type { LevelDef, RunState } from '@/sim';

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

  /** Seconds left of the beat before the result screen, or null. */
  private countdown: number | null = null;

  constructor(levelIndex: number, options: QueryOptions) {
    const config = levelConfig(levelIndex);
    this.level = generateLevel(levelIndex, config, options.seed ?? config.seed);
    this.run = new Run(this.level, balance);
    this.bot = options.bot === null ? null : createBot(options.bot, this.level.seed);
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
}
