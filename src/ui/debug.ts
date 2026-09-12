/**
 * Debug panel: frame cost, squad count, live projectiles, enemies alive,
 * physics, audio, draw calls, time scale and the last few sim events, as a
 * monospace block in the bottom-left corner, plus a "Capture" button that
 * records ten seconds of those numbers into one pasteable summary.
 *
 * Reached with `?debug` or, because the hosted playtest wrapper may swallow the
 * query string, by triple-tapping the wordmark or the level chip (`./taps.ts`).
 * Either way the choice is written to the save, so the next load comes up the
 * way the panel was left.
 *
 * Development-only, but it ships in the bundle so a hosted playtest link can be
 * debugged without a new build. Nothing in here runs while the panel is hidden —
 * not even building an event's string, which is a per-event allocation the game
 * does not otherwise make.
 */

import type { GateKind, RunState, SimEvent } from '@/sim';

import { CAPTURE_SECONDS, CaptureRecorder } from './capture';
import './debug.css';

/** How many event lines the panel keeps. */
const LOG_LIMIT = 8;

/** DOM writes per second. The panel is for reading, not for measuring itself. */
const REFRESH_INTERVAL = 0.1;

/** Exponential smoothing weight for the per-frame cost readouts. */
const AVERAGE_WEIGHT = 0.1;

const IDLE_LABEL = `Capture ${String(CAPTURE_SECONDS)}s`;
/** Same label plus a tick: the capture is over *and* the clipboard took it. */
const COPIED_LABEL = `${IDLE_LABEL} ✓`;

/** Wall clock for the capture window. Presentation only; the sim has its own. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

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
  /** Worst draw-call count since the run started; the smoke's budget is on this. */
  drawCallsPeak: number;
  /** The app-level time scale: 1 normal, 0 during hit-stop. */
  timeScale: number;
  ragdolls: number;
  shards: number;
  /** Live Havok bodies behind those: eleven per ragdoll, one per shard. */
  physicsBodies: number;
  physicsQuality: number;
  /** Which rung of the app's degrade ladder is in force; 0 is everything on. */
  qualityRung: number;
  /** The ladder's last three-second window, as a 95th-percentile frame in ms. */
  qualityP95: number;
  /** Why the rung last moved: `start`, `level`, `p95` or `pinned`. */
  qualityReason: string;
  /** JS heap in MB where the browser reports it (Chrome only), else 0. */
  heapMb: number;
  /** Collections seen since boot; a rising count means the frame allocates. */
  heapDrops: number;
  /** Backing-store pixels per CSS pixel, which the ladder's top rungs lower. */
  pixelRatio: number;
  /** What the screen offers, so a lowered `pixelRatio` reads as a decision. */
  devicePixelRatio: number;
  /** `off`, `loading`, `locked` or `unlocked`, plus a mute marker. */
  audio: string;
  /** Clips decoded and playable, so a silent game says which kind of silent. */
  audioClips: number;
}

/**
 * The panel's markup (`index.html`). The root is inert; only the button takes
 * pointer events, so the rest of the panel never eats a drag.
 */
export interface DebugElements {
  root: HTMLElement;
  text: HTMLElement;
  /** The last capture's summary. Hidden until there is one. */
  summary: HTMLElement;
  button: HTMLButtonElement;
}

export class DebugPanel {
  private readonly elements: DebugElements;
  private readonly log: LogEntry[] = [];
  private readonly capture = new CaptureRecorder();

  private enabled = false;
  private fps = 0;
  private simMs = 0;
  private renderMs = 0;
  private physicsMs = 0;
  private sinceRefresh = REFRESH_INTERVAL;
  private shownLabel = '';

  constructor(elements: DebugElements, signal: AbortSignal) {
    this.elements = elements;
    this.setLabel(IDLE_LABEL);
    elements.button.addEventListener(
      'click',
      () => {
        this.onCaptureClick();
      },
      { signal },
    );
  }

  /** The app skips gathering panel-only numbers when this is false. */
  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.elements.root.hidden = !enabled;
    // A hidden panel stops being fed frames, so a capture left running would
    // hang half-recorded until the panel came back.
    if (!enabled && this.capture.active) this.stopCapture();
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
    // The capture is the opposite — it keeps every raw sample.
    if (dt > 0) {
      this.fps += (1 / dt - this.fps) * AVERAGE_WEIGHT;
      this.simMs += (stats.simMs - this.simMs) * AVERAGE_WEIGHT;
      this.renderMs += (stats.renderMs - this.renderMs) * AVERAGE_WEIGHT;
      this.physicsMs += (stats.physicsMs - this.physicsMs) * AVERAGE_WEIGHT;
    }

    for (const event of events) this.push(describe(event));

    if (this.capture.active) {
      const summary = this.capture.add(now(), dt, state, stats);
      if (summary !== null) this.finishCapture(summary);
    }

    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH_INTERVAL) return;
    this.sinceRefresh = 0;

    this.elements.text.textContent = this.compose(state, phase, stats);
    if (this.capture.active) {
      this.setLabel(`Recording ${String(this.capture.secondsLeft(now()))}s`);
    }
  }

  /** Starts a capture, or cancels the one running. */
  private onCaptureClick(): void {
    if (this.capture.active) {
      this.stopCapture();
      return;
    }
    this.elements.summary.hidden = true;
    this.capture.start(now());
    this.setLabel(`Recording ${String(CAPTURE_SECONDS)}s`);
  }

  private stopCapture(): void {
    this.capture.cancel();
    this.setLabel(IDLE_LABEL);
  }

  private finishCapture(summary: string): void {
    this.elements.summary.textContent = summary;
    this.elements.summary.hidden = false;
    this.setLabel(IDLE_LABEL);
    copyToClipboard(summary, (copied) => {
      this.setLabel(copied ? COPIED_LABEL : IDLE_LABEL);
    });
  }

  private setLabel(label: string): void {
    if (label === this.shownLabel) return;
    this.shownLabel = label;
    this.elements.button.textContent = label;
  }

  /**
   * The block the product owner reads off a phone in one glance
   * (docs/06-milestone-2-plan.md, definition of done 9): frame rate, where the
   * frame went, what it cost to draw, which rung of the degrade ladder is in
   * force at what resolution, what physics is alive, and whether sound is on.
   */
  private compose(state: Readonly<RunState> | null, phase: string, stats: DebugStats): string {
    const lines = [
      `fps ${this.fps.toFixed(0).padStart(3)}  phase ${phase}  x${stats.timeScale.toFixed(2)}`,
      `sim ${this.simMs.toFixed(2)}ms  render ${this.renderMs.toFixed(2)}ms` +
        `  phys ${this.physicsMs.toFixed(2)}ms`,
      `draws ${String(stats.drawCalls)} peak ${String(stats.drawCallsPeak)}` +
        `  px ${stats.pixelRatio.toFixed(2)}/${stats.devicePixelRatio.toFixed(2)}`,
      `rung ${String(stats.qualityRung)} ${stats.qualityReason}` +
        `  p95 ${stats.qualityP95.toFixed(1)}ms` +
        (stats.heapMb > 0
          ? `  heap ${stats.heapMb.toFixed(0)}MB gc ${String(stats.heapDrops)}`
          : ''),
      `rag ${String(stats.ragdolls)}  shard ${String(stats.shards)}` +
        `  bodies ${String(stats.physicsBodies)}  physq ${String(stats.physicsQuality)}`,
      `audio ${stats.audio} ${String(stats.audioClips)} clips`,
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

/**
 * Best effort, never fatal: an insecure context has no `navigator.clipboard` at
 * all and a permission can be denied. The summary is on screen either way, so a
 * failed copy only changes the button's label.
 */
function copyToClipboard(text: string, onDone: (copied: boolean) => void): void {
  try {
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) {
      onDone(false);
      return;
    }
    void clipboard.writeText(text).then(
      () => {
        onDone(true);
      },
      () => {
        onDone(false);
      },
    );
  } catch {
    onDone(false);
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
    case 'enemyLeaked':
      return `leak #${String(event.enemyId)} str ${String(event.streamId)}`;
    case 'streamStarted':
      return `stream ${String(event.streamId)} lane ${String(event.lane)} x${String(event.count)}`;
    case 'streamCleared':
      return `stream ${String(event.streamId)} done leak ${String(event.leaked)}`;
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
