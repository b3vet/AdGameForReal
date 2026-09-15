/**
 * The device report: one block of plain text the product owner copies off the
 * phone and pastes into feedback (docs/25-milestone-9-plan.md, section D).
 *
 * The debug panel already prints everything a *live* reading needs, but a photo
 * of a panel is not a number anyone can compare against the last build, and the
 * panel says nothing at all about the phone it is running on. This is the other
 * half: what the device is, what the ladder settled at, what the last capture
 * measured, what the last run did, and where the save has got to — as text, so
 * it travels in a chat message.
 *
 * Two halves, deliberately split:
 *
 *   `buildReport`   pure formatting over a plain `ReportInput`. Every field is
 *                   optional-by-null and a missing one prints `-`, because this
 *                   runs on a phone that may have no engine yet, no capture, no
 *                   run and a fresh save, and a report that throws is worse than
 *                   a report with a dash in it.
 *   `collectReport` reads the live app through narrow thunks. Structural types
 *                   rather than `App`, `Renderer` and `QualityLadder`, so this
 *                   file stays testable with fixtures and imports none of them.
 *
 * Nothing here reports an identifier. The user-agent string carries the OS
 * version and the browser, the GL strings carry the GPU, and that is the whole
 * of what leaves the device; there is no id of any kind (D6 — we collect
 * nothing, and a report the owner pastes by hand is not a exception to that).
 */

import type { RunState } from '@/sim';
import type { CaptureSummary } from '@/ui';

/**
 * Stamped by the build (`vite.config.ts` and its two siblings). `dev` where it
 * was not — the dev server defines it, the unit tests do not, and neither is a
 * build anyone reports a number from.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_KIND__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** `web`, `hosted`, `artifact`, or `dev` outside a build. */
export const BUILD_KIND: string = typeof __BUILD_KIND__ === 'string' ? __BUILD_KIND__ : 'dev';

/** What the WebGL context says it is, through `WEBGL_debug_renderer_info`. */
export interface ReportGpu {
  vendor: string;
  renderer: string;
  version: string;
}

/** Where the degrade ladder has got to, and what it is rendering at (D27, D38). */
export interface ReportQuality {
  rung: number;
  /** The ladder's own line: `start 3x`, `p95 2x`. */
  reason: string;
  /** Backing-store pixels per CSS pixel, as the renderer is set right now. */
  pixelRatio: number;
  /** What the screen offers, so a lowered ratio reads as a decision. */
  devicePixelRatio: number;
  /** Ragdoll quality: 2 spawns eight per kill, 1 four, 0 none. */
  physics: number;
}

/** The save's headline. Five numbers; nothing that identifies anybody. */
export interface ReportSave {
  bestLevel: number;
  coins: number;
  streakDays: number;
  missionsDone: number;
  missionsTotal: number;
  /** Cosmetic tints the bestiary's kill ladders have handed over (D53). */
  tiers: number;
}

/** Everything the report prints. Every part is nullable; see the file note. */
export interface ReportInput {
  version: string;
  /** `web`, `hosted`, `artifact`, or `native` inside the Capacitor app. */
  build: string;
  platform: string;
  userAgent: string;
  screen: { width: number; height: number; pixelRatio: number } | null;
  gpu: ReportGpu | null;
  quality: ReportQuality | null;
  capture: CaptureSummary | null;
  /** The last run the panel saw, live or finished. */
  run: Readonly<RunState> | null;
  save: ReportSave | null;
}

/** Widest label in any section, so the values line up in a monospace block. */
const LABEL_WIDTH = 10;

/** What an unknown field prints as. A dash is a reading; a blank is a bug. */
const MISSING = '-';

export function buildReport(input: ReportInput): string {
  const lines: string[] = [`arcane-rush ${text(input.version)} report`];
  pushSection(lines, 'device', deviceRows(input));
  pushSection(lines, 'quality', qualityRows(input.quality));
  pushSection(lines, 'capture', captureRows(input.capture));
  pushSection(lines, 'run', runRows(input.run));
  pushSection(lines, 'save', saveRows(input.save));
  return lines.join('\n');
}

/**
 * A section is always printed, even when it has nothing in it: an owner reading
 * the report has to be able to tell "no capture was taken" from "the capture
 * section is missing because this build is older than it".
 */
function pushSection(lines: string[], heading: string, rows: readonly string[]): void {
  lines.push('', heading);
  if (rows.length === 0) lines.push(row('', MISSING));
  else lines.push(...rows);
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(LABEL_WIDTH)} ${value}`;
}

function deviceRows(input: ReportInput): string[] {
  const screen = input.screen;
  const gpu = input.gpu;
  return [
    row('build', text(input.build)),
    row('platform', text(input.platform)),
    row(
      'screen',
      screen === null ? MISSING : `${size(screen)} css, dpr ${ratio(screen.pixelRatio)}`,
    ),
    row('gpu', gpu === null ? MISSING : text(gpu.renderer)),
    row('vendor', gpu === null ? MISSING : text(gpu.vendor)),
    row('gl', gpu === null ? MISSING : text(gpu.version)),
    row('ua', text(input.userAgent)),
  ];
}

function size(screen: { width: number; height: number }): string {
  return `${round(screen.width)}x${round(screen.height)}`;
}

function qualityRows(quality: ReportQuality | null): string[] {
  if (quality === null) return [];
  return [
    row('rung', `${String(quality.rung)} (${text(quality.reason)})`),
    row('pixels', `${ratio(quality.pixelRatio)} of ${ratio(quality.devicePixelRatio)}`),
    row('physics', String(quality.physics)),
  ];
}

/**
 * The capture's numbers, not its pasteable block: the block is composed to fit
 * a 390 px panel and this one is read in a chat window, so the two are allowed
 * to disagree about width. The frame rate is quoted twice on purpose — the
 * median is what it feels like and the p95 is what it stumbles at, and a device
 * that holds 60 with a p95 of 41 is a different report from one that sits at 45.
 */
function captureRows(capture: CaptureSummary | null): string[] {
  if (capture === null) return [];
  return [
    row('window', `${capture.seconds.toFixed(1)}s, ${String(capture.frames)} frames`),
    row('fps', `med ${ms(capture.fpsMedian, 0)} p95 ${ms(capture.fpsP95, 0)}`),
    row('frame p95', `${ms(capture.frameMs.p95, 1)} ms (med ${ms(capture.frameMs.median, 1)})`),
    row('>20ms', String(capture.over20)),
    row('draws', `peak ${String(capture.drawPeak)}, rung peak ${String(capture.rungPeak)}`),
    row('sim', spread(capture.sim)),
    row('render', spread(capture.render)),
    row('physics', spread(capture.physics)),
  ];
}

function spread(value: { median: number; p95: number }): string {
  return `med ${ms(value.median, 2)} p95 ${ms(value.p95, 2)} ms`;
}

/**
 * The last run the panel was handed, which on the result sheet and back in the
 * Academy is the one just walked — the report is usually copied *after* a run,
 * and a run section that emptied itself the moment the sheet closed would be
 * the one section nobody could ever read.
 */
function runRows(state: Readonly<RunState> | null): string[] {
  if (state === null) return [];
  const metres = state.endless?.metres;
  return [
    row(
      'road',
      metres === undefined ? `level ${String(state.levelIndex)}` : `endless ${round(metres)} m`,
    ),
    row('status', `${text(state.status)}, ${ms(state.time, 1)}s`),
    row('squad', `count ${round(state.squad.count)}, peak ${round(state.peakCount)}`),
    row('survivors', round(state.survivors)),
    row('seed', String(state.seed)),
  ];
}

function saveRows(save: ReportSave | null): string[] {
  if (save === null) return [];
  return [
    row('best', `level ${String(save.bestLevel)}`),
    row('coins', String(save.coins)),
    row('streak', `${String(save.streakDays)} days`),
    row('missions', `${String(save.missionsDone)}/${String(save.missionsTotal)} done`),
    row('tiers', `${String(save.tiers)} tints held`),
  ];
}

/** Anything the device declined to answer prints as a dash, never as blank. */
function text(value: string | null | undefined): string {
  if (typeof value !== 'string') return MISSING;
  const trimmed = value.trim();
  return trimmed === '' ? MISSING : trimmed;
}

function ms(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : MISSING;
}

function ratio(value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function round(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : MISSING;
}

// --- Collecting it off the live app ----------------------------------------

/**
 * The GL strings, or null where there is no context to ask.
 *
 * Babylon fills them from `WEBGL_debug_renderer_info` where the browser offers
 * it and falls back to the masked `RENDERER` where it does not, which is the
 * behaviour this wants: the unmasked string is what says whether an iPhone is
 * running the GPU everyone assumed it was.
 *
 * `unknown` rather than a typed engine on purpose. `Scene.getEngine()` is typed
 * as `AbstractEngine`, which does not declare `getGlInfo` — it is a `ThinEngine`
 * method, and the WebGPU engine has no equivalent — so this duck-types the call
 * and validates what comes back rather than asserting a shape Babylon does not
 * promise. It is also what keeps this file free of Babylon imports.
 */
export function readGl(source: unknown): ReportGpu | null {
  if (typeof source !== 'object' || source === null) return null;
  const read = (source as { getGlInfo?: unknown }).getGlInfo;
  if (typeof read !== 'function') return null;
  try {
    const info: unknown = (read as () => unknown).call(source);
    if (typeof info !== 'object' || info === null) return null;
    const fields = info as Record<string, unknown>;
    return {
      vendor: readString(fields.vendor),
      renderer: readString(fields.renderer),
      version: readString(fields.version),
    };
  } catch {
    // A lost context throws rather than answering. The rest of the report is
    // still worth having, so this is a dash and not an exception.
    return null;
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** What `collectReport` needs from the app. Thunks, so it reads live. */
export interface ReportDeps {
  /** `ios`, `android` or `web` (`src/device/platform.ts`). */
  platform: () => string;
  /** The engine, or null before `Renderer.init` has run; see `readGl`. */
  gl: () => unknown;
  quality: () => ReportQuality;
  save: () => ReportSave;
}

/**
 * The live report. `capture` and `state` come from the debug panel, which is
 * the only thing that sees either: the panel is handed every frame's state and
 * it owns the recorder, so threading them in beats a second copy of both.
 */
export function collectReport(
  deps: ReportDeps,
  capture: CaptureSummary | null,
  state: Readonly<RunState> | null,
): string {
  const platform = deps.platform();
  return buildReport({
    version: APP_VERSION,
    // Inside the app the build kind is "native" whatever bundler made it: the
    // owner reporting a number needs to know it came off the phone's WebView
    // and not off a browser tab pointed at the same build.
    build: platform === 'web' ? BUILD_KIND : 'native',
    platform,
    userAgent: browserAgent(),
    screen: browserScreen(),
    gpu: readGl(deps.gl()),
    quality: deps.quality(),
    capture,
    run: state,
    save: deps.save(),
  });
}

function browserAgent(): string {
  return typeof navigator === 'undefined' ? '' : navigator.userAgent;
}

function browserScreen(): { width: number; height: number; pixelRatio: number } | null {
  if (typeof window === 'undefined') return null;
  return {
    // CSS pixels of the window, not of the screen: the WebView is what the
    // game lays out in, and on a phone with a notch the two differ.
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
  };
}
