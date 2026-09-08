/**
 * What a frame's events do to how the game *feels*: hit-stop, slow-mo, camera
 * shake and the colour draining out of a lost run.
 *
 * Split out of `App` because it is a rule set rather than a state machine: the
 * app hands it every tick's events and calls `apply` once, after the render.
 * The rules themselves are the plan's juice checklist
 * (docs/06-milestone-2-plan.md).
 *
 * Nothing here touches the sim. `TimeScale` in `./timeScale.ts` holds the pure
 * timers and is unit-tested on its own.
 */

import type { SimEvent } from '@/sim';

import { BOSS_KILL_SCALE, BOSS_KILL_SECONDS, DEFEAT_SCALE, TimeScale } from './timeScale';

/** Camera shake, in the renderer's own units: a stomp, then the boss going down. */
const SHAKE_STOMP = 0.35;
const SHAKE_STOMP_SECONDS = 0.28;
const SHAKE_BOSS_KILL = 0.8;
const SHAKE_BOSS_KILL_SECONDS = 0.7;

/** Drains the colour out of the scene while a lost run plays out. */
const DEFEAT_CLASS = 'is-defeated';

/** Just the part of the renderer this needs, so it never reaches for more. */
interface Shaker {
  shake(strength: number, seconds: number): void;
}

export class Juice {
  readonly timeScale = new TimeScale();

  private blockKills = 0;
  private stomps = 0;
  private bossKilled = false;
  private runLost = false;

  /**
   * `timeEffects` is false under `?turbo`: a frame there advances up to two
   * seconds of sim, so a 40 ms hit-stop is not a 40 ms freeze — it is a whole
   * frame of the run thrown away, which is both wrong to look at and a fifth of
   * a scripted run's wall clock. Shake and the defeat drain cost nothing and
   * stay on at any speed.
   */
  constructor(
    private readonly canvas: HTMLElement,
    private readonly renderer: Shaker,
    private readonly timeEffects: boolean,
  ) {}

  /** What this frame's real delta must be multiplied by. */
  get scale(): number {
    return this.timeScale.value;
  }

  /** Ages the timers by one frame of real time, before the scale is read. */
  advance(frameDt: number): void {
    this.timeScale.advance(frameDt);
  }

  /** Forgets what the last frame's events asked for. Called once per frame. */
  beginFrame(): void {
    this.blockKills = 0;
    this.stomps = 0;
    this.bossKilled = false;
    this.runLost = false;
  }

  /** Notes what one tick's events want; `apply` acts once, after the render. */
  scan(events: readonly SimEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'enemyKilled':
          if (event.kind !== 'boss') this.blockKills++;
          break;
        case 'bossStomp':
          this.stomps++;
          break;
        case 'bossKilled':
          this.bossKilled = true;
          break;
        case 'runEnded':
          if (event.status === 'lost') this.runLost = true;
          break;
        default:
          break;
      }
    }
  }

  apply(): void {
    if (this.stomps > 0) this.renderer.shake(SHAKE_STOMP, SHAKE_STOMP_SECONDS);
    if (this.bossKilled) this.renderer.shake(SHAKE_BOSS_KILL, SHAKE_BOSS_KILL_SECONDS);
    if (this.runLost) this.canvas.classList.add(DEFEAT_CLASS);

    if (!this.timeEffects) return;
    // The throttle inside `hitStop` is what keeps a wiped row to one hitch.
    if (this.blockKills > 0) this.timeScale.hitStop();
    if (this.bossKilled) this.timeScale.slowMo(BOSS_KILL_SCALE, BOSS_KILL_SECONDS);
    if (this.runLost) this.timeScale.setHold(DEFEAT_SCALE);
  }

  /**
   * The defeat crawl ends when the result screen replaces the run (plan, juice
   * checklist); the drained colour stays until the next run starts.
   */
  endDefeatCrawl(): void {
    this.timeScale.setHold(1);
  }

  /** A fresh run: normal speed, full colour. */
  reset(): void {
    this.timeScale.reset();
    this.canvas.classList.remove(DEFEAT_CLASS);
  }
}
