/**
 * `?debug` panel: frame cost, squad count, live projectiles, enemies alive,
 * physics, audio, draw calls, time scale and the last few sim events, as a
 * monospace block in the bottom-left corner.
 *
 * Development-only, but it ships in the bundle so a hosted playtest link can be
 * debugged with a query parameter instead of a new build. Nothing in here runs
 * while the panel is hidden — not even building an event's string, which is a
 * per-event allocation the game does not otherwise make.
 */

import type { GateKind, RunState, SimEvent } from '@/sim';

import './debug.css';

/** How many event lines the panel keeps. */
const LOG_LIMIT = 8;

/** DOM writes per second. The panel is for reading, not for measuring itself. */
const REFRESH_INTERVAL = 0.1;

/** Exponential smoothing weight for the per-frame cost readouts. */
const AVERAGE_WEIGHT = 0.1;

interface LogEntry {
  text: string;
  repeats: number;
}

/**
 * What the app knows about the frame it just ran. The app owns one instance and
 * overwrites it every frame, so nothing here may hold on to it.
 */
export interface DebugStats {
  /** The whole `Run.tick` sequence, in milliseconds. */
  simMs: number;
  /** The whole `Renderer.update`, including `scene.render`. */
  renderMs: number;
  /** `PhysicsLayer.onEvents` plus `update`. */
  physicsMs: number;
  /** From the renderer's instrumentation; 0 when it has none yet. */
  drawCalls: number;
  /** The app-level time scale: 1 normal, 0 during hit-stop. */
  timeScale: number;
  ragdolls: number;
  shards: number;
  physicsQuality: number;
  /** Which rung of the app's degrade ladder is in force; 0 is everything on. */
  qualityRung: number;
  /** `off`, `loading`, `locked` or `unlocked`, plus a mute marker. */
  audio: string;
}

export class DebugPanel {
  private readonly element: HTMLElement;
  private readonly log: LogEntry[] = [];

  private enabled = false;
  private fps = 0;
  private simMs = 0;
  private renderMs = 0;
  private physicsMs = 0;
  private sinceRefresh = REFRESH_INTERVAL;

  constructor(element: HTMLElement) {
    this.element = element;
  }

  /** The app skips gathering panel-only numbers when this is false. */
  get isEnabled(): boolean {
    return this.enabled;
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
    stats: DebugStats,
  ): void {
    if (!this.enabled) return;

    // Exponential smoothing: raw per-frame numbers jitter too much to read, and
    // a phone's hot spot shows up as a rising average, not as one bad frame.
    if (dt > 0) {
      this.fps += (1 / dt - this.fps) * AVERAGE_WEIGHT;
      this.simMs += (stats.simMs - this.simMs) * AVERAGE_WEIGHT;
      this.renderMs += (stats.renderMs - this.renderMs) * AVERAGE_WEIGHT;
      this.physicsMs += (stats.physicsMs - this.physicsMs) * AVERAGE_WEIGHT;
    }

    for (const event of events) this.push(describe(event));

    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH_INTERVAL) return;
    this.sinceRefresh = 0;

    this.element.textContent = this.compose(state, phase, stats);
  }

  private compose(state: Readonly<RunState> | null, phase: string, stats: DebugStats): string {
    const lines = [
      `fps ${this.fps.toFixed(0).padStart(3)}  phase ${phase}  x${stats.timeScale.toFixed(2)}`,
      `sim ${this.simMs.toFixed(2)}ms  render ${this.renderMs.toFixed(2)}ms`,
      `phys ${this.physicsMs.toFixed(2)}ms  draws ${String(stats.drawCalls)}`,
      `rag ${String(stats.ragdolls)}  shard ${String(stats.shards)}` +
        `  physq${String(stats.physicsQuality)}  rung ${String(stats.qualityRung)}`,
      `audio ${stats.audio}`,
    ];

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
          `boss ${boss.hp.toFixed(0)}/${boss.maxHp.toFixed(0)} ${boss.active ? 'active' : 'idle'}` +
            (boss.enraged === true ? ' ENRAGED' : ''),
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
    case 'projectileHit':
      return `impact ${event.weaponId}`;
    case 'gateHit':
      return `gateHit ${event.kind} ${gateValue(event.kind, event.value)}`;
    case 'gatePassed':
      return (
        `gate ${event.kind} ${gateValue(event.kind, event.value)} ` +
        `${String(event.countBefore)}>${String(event.countAfter)}`
      );
    case 'enemyActivated':
      return `activate #${String(event.enemyId)}`;
    case 'enemyHit':
      return `hit #${String(event.enemyId)} hp ${event.hp.toFixed(0)}`;
    case 'enemyKilled':
      return `kill #${String(event.enemyId)} ${event.kind}`;
    case 'enemyShattered':
      return `shatter #${String(event.enemyId)}`;
    case 'enemySlowed':
      return `slow #${String(event.enemyId)} ${event.seconds.toFixed(1)}s`;
    case 'splash':
      return `splash r${event.radius.toFixed(1)}`;
    case 'chain':
      return `chain #${String(event.from)}>#${String(event.to)}`;
    case 'weaponChanged':
      return `staff ${event.from}>${event.to}`;
    case 'unitsGained':
      return `+${event.amount.toFixed(0)} units`;
    case 'unitsLost':
      return `-${event.amount.toFixed(1)} units (${event.reason})`;
    case 'bossActivated':
      return 'boss active';
    case 'bossStomp':
      return 'boss stomp';
    case 'bossEnraged':
      return `boss enraged #${String(event.enemyId)}`;
    case 'bossKilled':
      return 'boss killed';
    case 'runEnded':
      return `runEnded ${event.status} surv ${String(event.survivors)}`;
  }
}

/**
 * Gate values are floats now, so the raw number is fifteen digits of noise in a
 * panel eight lines tall. Rounded the way the gate's own panel rounds it, and
 * `fireRate` in the percent the player reads rather than in hundredths.
 */
function gateValue(kind: GateKind, value: number): string {
  const scaled = kind === 'fireRate' ? value * 100 : value;
  const rounded = Math.round(scaled);
  // `Math.round` hands back `-0`, which prints as "-0" once a sign is glued on.
  return String(rounded === 0 ? 0 : rounded);
}
