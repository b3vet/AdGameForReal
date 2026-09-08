/**
 * `?debug` panel: FPS, squad count, live projectiles, enemies alive and the
 * last few sim events, as a monospace block in the top-left corner.
 *
 * Development-only, but it ships in the bundle so a hosted playtest link can be
 * debugged with a query parameter instead of a new build.
 */

import type { RunState, SimEvent } from '@/sim';

import './debug.css';

/** How many event lines the panel keeps. */
const LOG_LIMIT = 8;

/** DOM writes per second. The panel is for reading, not for measuring itself. */
const REFRESH_INTERVAL = 0.1;

interface LogEntry {
  text: string;
  repeats: number;
}

export class DebugPanel {
  private readonly element: HTMLElement;
  private readonly log: LogEntry[] = [];

  private enabled = false;
  private fps = 0;
  private sinceRefresh = REFRESH_INTERVAL;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.element.hidden = !enabled;
  }

  update(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
    phase: string,
  ): void {
    if (!this.enabled) return;

    // Exponential smoothing: raw 1/dt jitters too much to read.
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;

    for (const event of events) this.push(describe(event));

    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH_INTERVAL) return;
    this.sinceRefresh = 0;

    this.element.textContent = this.compose(state, phase);
  }

  private compose(state: Readonly<RunState> | null, phase: string): string {
    const lines = [`fps ${this.fps.toFixed(0).padStart(3)}  phase ${phase}`];

    if (state === null) {
      lines.push('no run');
    } else {
      const projectiles = countAlive(state.projectiles);
      const enemies = countAlive(state.enemies);
      lines.push(
        `lvl ${String(state.levelIndex)} seed ${String(state.seed)} ${state.status}`,
        `t ${state.time.toFixed(1)}s  z ${state.squad.z.toFixed(1)}`,
        `count ${String(state.squad.count)}  peak ${String(state.peakCount)}`,
        `proj ${String(projectiles)}  enemies ${String(enemies)}`,
      );
      const boss = state.boss;
      if (boss !== null) {
        lines.push(
          `boss ${boss.hp.toFixed(0)}/${boss.maxHp.toFixed(0)} ${boss.active ? 'active' : 'idle'}`,
        );
      }
    }

    lines.push('- events -');
    if (this.log.length === 0) lines.push('(none)');
    else {
      for (const entry of this.log) {
        lines.push(entry.repeats > 1 ? `${entry.text} x${String(entry.repeats)}` : entry.text);
      }
    }

    return lines.join('\n');
  }

  /** Repeats collapse into a counter so one noisy event cannot flush the log. */
  private push(text: string): void {
    const last = this.log[this.log.length - 1];
    if (last !== undefined && last.text === text) {
      last.repeats++;
      return;
    }
    this.log.push({ text, repeats: 1 });
    if (this.log.length > LOG_LIMIT) this.log.shift();
  }
}

function countAlive(items: readonly { alive: boolean }[]): number {
  let alive = 0;
  for (const item of items) if (item.alive) alive++;
  return alive;
}

function describe(event: SimEvent): string {
  switch (event.type) {
    case 'projectileFired':
      return 'fire';
    case 'gateHit':
      return `gateHit ${event.kind} ${String(event.value)}`;
    case 'gatePassed':
      return `gate ${event.kind} ${String(event.value)} ${String(event.countBefore)}>${String(event.countAfter)}`;
    case 'enemyActivated':
      return `activate #${String(event.enemyId)}`;
    case 'enemyHit':
      return `hit #${String(event.enemyId)} hp ${event.hp.toFixed(0)}`;
    case 'enemyKilled':
      return `kill #${String(event.enemyId)} ${event.kind}`;
    case 'unitsGained':
      return `+${event.amount.toFixed(0)} units`;
    case 'unitsLost':
      return `-${event.amount.toFixed(1)} units (${event.reason})`;
    case 'bossActivated':
      return 'boss active';
    case 'bossStomp':
      return 'boss stomp';
    case 'bossKilled':
      return 'boss killed';
    case 'runEnded':
      return `runEnded ${event.status} surv ${String(event.survivors)}`;
  }
}
