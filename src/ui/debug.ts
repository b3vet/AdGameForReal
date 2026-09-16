/**
 * Debug panel: frame cost, squad count, live projectiles, enemies alive, the
 * horde on screen and the numbers floating over it, physics, audio, draw calls,
 * time scale and the last few sim events, as a monospace block in the
 * bottom-left corner, plus three buttons — "Capture", which records a window of
 * those numbers into one pasteable summary, "Copy report", which puts the whole
 * device report on the clipboard (`src/core/report.ts`), and "Show report",
 * which renders that report in the panel so a photograph carries it when the
 * clipboard will not.
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

import type { RunState, SimEvent } from '@/sim';

import { CAPTURE_SECONDS, CaptureRecorder } from './capture';
import type { CaptureSummary } from './capture';
import { browserSurface, copyText } from './clipboard';
import type { CopySurface } from './clipboard';
import { describeEvent } from './debugEvents';
import type { DebugStats } from './debugStats';
import { composeReadout } from './debugText';
import type { LogEntry, PanelAverages } from './debugText';
import { SpikeWindow } from './spikeWindow';
import './debug.css';

/** How many event lines the panel keeps. */
const LOG_LIMIT = 8;

/** DOM writes per second. The panel is for reading, not for measuring itself. */
const REFRESH_INTERVAL = 0.1;

/** Exponential smoothing weight for the per-frame cost readouts. */
const AVERAGE_WEIGHT = 0.1;

const IDLE_LABEL = `Capture ${String(CAPTURE_SECONDS)}s`;
/** Same label plus a tick: the capture is over *and* the clipboard took it. */
const CAPTURE_COPIED_LABEL = `${IDLE_LABEL} ✓`;

const COPY_LABEL = 'Copy report';
const COPIED_LABEL = 'Copied ✓';
const COPY_FAILED_LABEL = 'Copy failed';
const SHOW_LABEL = 'Show report';
const HIDE_LABEL = 'Hide report';

/** How long a button holds its "it worked" label before going back. */
const CONFIRM_MS = 2000;

/** Before the app has handed the panel a report source (`setReportSource`). */
const NO_REPORT = 'arcane-rush report\n\n  -  no source (the app has not booted)';

/** Wall clock for the capture window. Presentation only; the sim has its own. */
const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

/**
 * How the panel asks for the device report. The app supplies it
 * (`src/core/publishHandle.ts`); the two things only the panel can see — the
 * last capture and the last run state — are handed back in.
 */
export type ReportSource = (
  capture: CaptureSummary | null,
  state: Readonly<RunState> | null,
) => string;

export type { DebugStats };

/**
 * The panel's markup (`index.html`). The root is inert; only the buttons take
 * pointer events, so the rest of the panel never eats a drag.
 */
export interface DebugElements {
  root: HTMLElement;
  text: HTMLElement;
  /** The last capture's summary. Hidden until there is one. */
  summary: HTMLElement;
  /** The device report, rendered for a photograph. Hidden until asked for. */
  report: HTMLElement;
  button: HTMLButtonElement;
  copyButton: HTMLButtonElement;
  showButton: HTMLButtonElement;
}

export class DebugPanel {
  private readonly elements: DebugElements;
  private readonly log: LogEntry[] = [];
  private readonly capture = new CaptureRecorder();
  /** Frames over 20 ms in the last ten seconds — Milestone 4's hitch hunt. */
  private readonly spikes = new SpikeWindow();
  /** Where a copy is attempted; the tests hand in their own (`./clipboard.ts`). */
  private readonly surface: CopySurface;

  private enabled = false;
  /** The smoothed numbers the readout prints (`./debugText.ts`). */
  private readonly averages: PanelAverages = {
    fps: 0,
    simMs: 0,
    viewsMs: 0,
    drawMs: 0,
    physicsMs: 0,
    frameMs: 0,
    spikes: 0,
  };
  private sinceRefresh = REFRESH_INTERVAL;
  private shownLabel = '';

  private source: ReportSource | null = null;
  private lastSummary: CaptureSummary | null = null;
  /**
   * The last run the panel was handed, live or finished.
   *
   * A reference, never a copy: the report's run section is read *after* a run
   * as often as during one — the owner taps "Copy report" on the result sheet —
   * and the app clears its session the moment the Academy comes back. One dead
   * run held by a panel that is only up when someone is looking at it is a
   * cheaper price than a per-frame snapshot of six numbers.
   */
  private lastState: Readonly<RunState> | null = null;
  private reportShown = false;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    elements: DebugElements,
    signal: AbortSignal,
    surface: CopySurface = browserSurface(),
  ) {
    this.elements = elements;
    this.surface = surface;
    this.setLabel(IDLE_LABEL);
    elements.copyButton.textContent = COPY_LABEL;
    elements.showButton.textContent = SHOW_LABEL;
    elements.button.addEventListener(
      'click',
      () => {
        this.onCaptureClick();
      },
      { signal },
    );
    elements.copyButton.addEventListener(
      'click',
      () => {
        void this.copyReport();
      },
      { signal },
    );
    elements.showButton.addEventListener(
      'click',
      () => {
        this.showReport(!this.reportShown);
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
    // The window is wall-clock, and a hidden panel is fed no frames at all, so
    // a count carried across a gap would describe a time nobody was watching.
    if (enabled) this.spikes.reset();
    // A hidden panel stops being fed frames, so a capture left running would
    // hang half-recorded until the panel came back.
    if (!enabled && this.capture.active) this.stopCapture();
    if (!enabled) this.clearConfirm();
  }

  /** Where the report comes from; see `ReportSource`. */
  setReportSource(source: ReportSource): void {
    this.source = source;
  }

  /** The report as text, for the clipboard, the panel and `__arcane.report()`. */
  report(): string {
    const source = this.source;
    if (source === null) return NO_REPORT;
    try {
      return source(this.lastSummary, this.lastState);
    } catch {
      // The report is the thing a broken build is reported *with*, so it may
      // not be the thing that breaks. A source that throws is a dash.
      return NO_REPORT;
    }
  }

  /** The last finished capture, or null. Read by the report and by `?perf`. */
  get lastCapture(): CaptureSummary | null {
    return this.lastSummary;
  }

  get captureActive(): boolean {
    return this.capture.active;
  }

  /** Starts a capture of `seconds`; `?perf` asks for a long one. */
  startCapture(seconds: number = CAPTURE_SECONDS): void {
    this.elements.summary.hidden = true;
    this.showReport(false);
    this.capture.start(now(), seconds);
    this.setLabel(`Recording ${String(this.capture.secondsLeft(now()))}s`);
  }

  /**
   * Renders the report in the panel in place of the live readout.
   *
   * In place of, not beside: the report is thirty lines and the readout is
   * twenty, and the two together run off the top of a 390x844 phone — and this
   * exists to be photographed.
   */
  showReport(shown: boolean): void {
    this.reportShown = shown;
    // A snapshot, not a live view: what is wanted is the numbers as they were
    // when the button was pressed, held still long enough to photograph.
    if (shown) this.elements.report.textContent = this.report();
    this.elements.report.hidden = !shown;
    this.elements.text.hidden = shown;
    this.elements.summary.hidden = shown || this.lastSummary === null;
    this.elements.showButton.textContent = shown ? HIDE_LABEL : SHOW_LABEL;
  }

  /**
   * Puts the report on the clipboard and says so on the button for two seconds.
   * A refused clipboard renders the report instead, so the next thing the owner
   * does is take a photograph rather than wonder what happened.
   */
  async copyReport(): Promise<boolean> {
    const copied = await copyText(this.report(), this.surface);
    this.confirm(this.elements.copyButton, copied ? COPIED_LABEL : COPY_FAILED_LABEL, COPY_LABEL);
    if (!copied) this.showReport(true);
    return copied;
  }

  update(
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
    phase: string,
    stats: DebugStats,
  ): void {
    if (!this.enabled) return;
    if (state !== null) this.lastState = state;

    // Exponential smoothing: raw per-frame numbers jitter too much to read, and
    // a phone's hot spot shows up as a rising average, not as one bad frame.
    // The capture is the opposite — it keeps every raw sample.
    if (dt > 0) {
      const a = this.averages;
      a.spikes = this.spikes.add(now());
      a.fps += (1 / dt - a.fps) * AVERAGE_WEIGHT;
      a.simMs += (stats.simMs - a.simMs) * AVERAGE_WEIGHT;
      a.viewsMs += (stats.viewsMs - a.viewsMs) * AVERAGE_WEIGHT;
      a.drawMs += (stats.drawMs - a.drawMs) * AVERAGE_WEIGHT;
      a.physicsMs += (stats.physicsMs - a.physicsMs) * AVERAGE_WEIGHT;
      a.frameMs += (stats.frameMs - a.frameMs) * AVERAGE_WEIGHT;
    }

    for (const event of events) this.push(describeEvent(event));

    if (this.capture.active) {
      const summary = this.capture.add(now(), dt, state, stats);
      if (summary !== null) this.finishCapture(summary);
    }

    this.sinceRefresh += dt;
    if (this.sinceRefresh < REFRESH_INTERVAL) return;
    this.sinceRefresh = 0;

    // Composing the readout into a hidden element is a dozen strings a second
    // nobody can see; the report is what is on screen.
    if (!this.reportShown) {
      this.elements.text.textContent = composeReadout(state, phase, stats, this.averages, this.log);
    }
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
    this.startCapture();
  }

  private stopCapture(): void {
    this.capture.cancel();
    this.setLabel(IDLE_LABEL);
  }

  private finishCapture(summary: CaptureSummary): void {
    this.lastSummary = summary;
    this.elements.summary.textContent = summary.text;
    this.elements.summary.hidden = this.reportShown;
    this.setLabel(IDLE_LABEL);
    void copyText(summary.text, this.surface).then((copied) => {
      this.setLabel(copied ? CAPTURE_COPIED_LABEL : IDLE_LABEL);
    });
  }

  /** The capture button's label, which is rewritten ten times a second. */
  private setLabel(label: string): void {
    if (label === this.shownLabel) return;
    this.shownLabel = label;
    this.elements.button.textContent = label;
  }

  /** Holds `label` on a button for two seconds, then puts `idle` back. */
  private confirm(button: HTMLButtonElement, label: string, idle: string): void {
    this.clearConfirm();
    button.textContent = label;
    this.confirmTimer = setTimeout(() => {
      this.confirmTimer = null;
      button.textContent = idle;
    }, CONFIRM_MS);
  }

  private clearConfirm(): void {
    if (this.confirmTimer === null) return;
    clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.elements.copyButton.textContent = COPY_LABEL;
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
