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

import { RunTracker } from './missions';
import type { RunTally } from './missions';
import { bossIdOf, buildLevel, buildRun } from './player';
import type { PlayerState } from './player';
import type { QueryOptions } from './query';
import { unlockLevel } from './save';

/** Steers the squad in place of a finger; see `createBot`. */
export type BotPolicy = (state: RunState) => number;

/**
 * The kinds the Bestiary has a card for, in the order the cards read. The boss
 * is not here: it is named by the level (`bossIdOf`), because there are two of
 * them (D49) and which one is standing in the arena is the level's business.
 */
const CARD_KINDS: readonly EnemyKind[] = ['grunt', 'brute', 'charger', 'shieldBrute'];

export class RunSession {
  readonly level: LevelDef;
  readonly run: Run;
  /**
   * Constructed once per session: the policy carries its own RNG stream, so
   * rebuilding it every tick would reset that stream and break determinism.
   * Dropped for good when a hand takes the wheel (`takeWheel`).
   */
  private policy: BotPolicy | null;

  /**
   * Bestiary ids met in this run. Small and append-only: the app reads it once,
   * when the run ends.
   */
  readonly seen = new Set<string>();

  private readonly bossId: string;

  /**
   * What this run is worth to the meta layer (D51, D53): missions, kill
   * counters, the boss clock, whether the column ever broke.
   *
   * It lives on the session rather than beside it because the session is
   * already the one thing walking every event (`absorb`), and a second walk of
   * the same list every sim chunk is the kind of per-frame waste CLAUDE.md
   * rules out. Nothing in the sim knows it exists.
   */
  private readonly tracker: RunTracker;

  /** Seconds left of the beat before the result screen, or null. */
  private countdown: number | null = null;

  /**
   * Which of `CARD_KINDS` this run has already recorded, so `absorb` can stop
   * looking things up. A stream fires `enemyActivated` about twenty times a
   * second (D29) and the lookup is a scan of the enemy array; once every kind
   * the road can hold has been met there is nothing left for it to find.
   */
  private readonly sawKind = new Set<EnemyKind>();

  /**
   * `seed` overrides the level's own (`levels.json`) and the query's, which is
   * what makes "same road again" a thing the result sheet can offer: the run's
   * seed comes back off `RunSession.seed` and goes straight into the next one.
   */
  constructor(
    levelIndex: number,
    options: QueryOptions,
    player: PlayerState,
    seed: number | null = null,
  ) {
    this.level = buildLevel(levelIndex, seed ?? options.seed, player);
    this.run = buildRun(this.level, balance, player);
    // The same tuning object the run was built on: a bot steers by the crowd's
    // own width and the clamp it leaves, and both come out of the balance.
    this.policy = options.bot === null ? null : createBot(options.bot, this.level.seed, balance);
    this.bossId = bossIdOf(this.level);
    this.tracker = new RunTracker(this.bossId === 'rime' ? 'rime' : 'demon');
  }

  get state(): RunState {
    return this.run.state;
  }

  /** The seed this road was generated from. Replay it and you get this road. */
  get seed(): number {
    return this.level.seed;
  }

  get won(): boolean {
    return this.run.state.status === 'won';
  }

  get finished(): boolean {
    return this.run.state.status !== 'running';
  }

  /** The policy steering this session, or null while a finger has it. */
  get bot(): BotPolicy | null {
    return this.policy;
  }

  /** Hands the bot's decision to the run, if this session has one. */
  steer(): void {
    const policy = this.policy;
    if (policy !== null && this.run.state.status === 'running') {
      this.run.setTargetX(policy(this.run.state));
    }
  }

  /**
   * A hand takes the wheel: the bot lets go for the rest of the run and the
   * head goes to `x` metres, 1:1, exactly as a finger would put it there.
   *
   * The hero set is why this exists (`ArcaneDebugHandle.steer`,
   * `scripts/smoke-hero.mjs`). A whip and a fence jam are *swipes*, and a swipe
   * has to start on a named frame at a named squad size — which is a thing no
   * bot will do on request, and which fighting a bot for the target every step
   * cannot produce either. Taking the wheel means the run is no longer a run
   * anything may be measured off, so nothing but the debug handle calls it.
   */
  takeWheel(x: number): void {
    this.policy = null;
    this.run.setTargetX(x);
  }

  /**
   * Notes what the player has met, for the Bestiary.
   *
   * Kinds rather than bodies: the cards are the four road kinds and the level's
   * boss, so the whole job is answering "has one of these been on screen
   * alive". A body is only looked up while a kind is still missing, and the
   * boss costs nothing at all — `bossActivated` is one event per run.
   */
  absorb(events: readonly SimEvent[]): void {
    // The meta layer's counters, off the same list and in the same pass.
    this.tracker.absorb(events, this.run.state);

    for (const event of events) {
      if (event.type === 'bossActivated') {
        this.seen.add(this.bossId);
        continue;
      }
      if (event.type !== 'enemyActivated') continue;
      if (this.sawKind.size >= CARD_KINDS.length) continue;

      const kind = this.kindOf(event.enemyId);
      if (kind === null) continue;
      if (kind === 'boss') {
        this.seen.add(this.bossId);
        continue;
      }
      if (this.sawKind.has(kind) || !CARD_KINDS.includes(kind)) continue;
      this.sawKind.add(kind);
      this.seen.add(kind);
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

  /**
   * What this run was worth to the meta layer. Called once, by `payRun`, after
   * the run has finished.
   *
   * An endless run is measured in metres and a campaign run is not (D52), which
   * is why the distance is read off the state here rather than assumed: the
   * field is written by the endless generator's own run semantics and is absent
   * on every campaign road.
   */
  tally(): RunTally {
    const endless = this.run.state.endless;
    return this.tracker.tally(this.run.state, endless === undefined ? null : endless.metres);
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
