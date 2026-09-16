/**
 * The device report's canvas section (docs/27-device-playtest-fixes.md,
 * section A): the canvas's CSS box, the backing store sized from it, and the
 * drawing buffer the browser actually allocated, with a verdict on whether the
 * three are one shape.
 *
 * The first build in the iOS app drew a 440x956 box over a 1320x1320 buffer and
 * the only way to see that was a Mac with Safari's inspector attached. This is
 * the same reading as text the product owner can paste, so the next device run
 * says whether the fix held without one.
 *
 * A file of its own for the file-size rule (CLAUDE.md), beside `./report.ts`
 * and on its terms: pure formatting over a plain `ReportCanvas`, and a reader
 * that duck-types the engine rather than importing Babylon.
 */

import { sameShape } from '@/render/backingFit';

/** The canvas three ways, in pixels; see the file note. */
export interface ReportCanvas {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  bufferWidth: number;
  bufferHeight: number;
}

/**
 * The rows of the section, labelled for `row` in `./report.ts`. Empty when
 * there is no canvas to read, which that file prints as a dash.
 */
export function canvasRows(canvas: ReportCanvas | null): [label: string, value: string][] {
  if (canvas === null) return [];
  const box = pair(canvas.cssWidth, canvas.cssHeight);
  const perCss = canvas.cssWidth > 0 ? canvas.backingWidth / canvas.cssWidth : Number.NaN;
  return [
    ['css', box],
    ['backing', `${pair(canvas.backingWidth, canvas.backingHeight)} (${ratioText(perCss)}x)`],
    ['buffer', pair(canvas.bufferWidth, canvas.bufferHeight) + bufferNote(canvas)],
    ['shape', shapeText(canvas)],
  ];
}

/**
 * A lost context reads as a zero buffer, and says so rather than looking like
 * a fault. A buffer smaller than the backing store is the browser saying no;
 * the renderer lowers its ratio when it hears that, so a clamp should only be
 * read on a build older than that fix.
 */
function bufferNote(canvas: ReportCanvas): string {
  if (canvas.bufferWidth === 0 && canvas.bufferHeight === 0) return ' (no context)';
  const clamped =
    canvas.bufferWidth < canvas.backingWidth || canvas.bufferHeight < canvas.backingHeight;
  return clamped ? ' (clamped)' : '';
}

/**
 * `ok` when the backing store and the buffer are both the box's shape (the
 * renderer's own rule, `sameShape`), and otherwise the three aspect ratios, so
 * a stretched frame is a number and not a description of a photo.
 */
function shapeText(canvas: ReportCanvas): string {
  const { cssWidth: w, cssHeight: h } = canvas;
  const backingOk = sameShape(canvas.backingWidth, canvas.backingHeight, w, h);
  const bufferOk = sameShape(canvas.bufferWidth, canvas.bufferHeight, w, h);
  if (backingOk && bufferOk) return 'ok';
  return (
    `SKEWED w/h css ${aspect(w, h)}` +
    ` backing ${aspect(canvas.backingWidth, canvas.backingHeight)}` +
    ` buffer ${aspect(canvas.bufferWidth, canvas.bufferHeight)}`
  );
}

/**
 * The three sizes off the engine `collectReport` already holds, or null.
 *
 * Duck-typed for the reason `readGl` is: the engine arrives as `unknown`, and
 * this file must not import Babylon. The buffer is read with `true` — the
 * screen's buffer, whatever render target happens to be bound — and a lost
 * context answers zeroes, which `bufferNote` names.
 */
export function readCanvas(source: unknown): ReportCanvas | null {
  if (typeof source !== 'object' || source === null) return null;
  const engine = source as Record<string, unknown>;
  const getCanvas = engine.getRenderingCanvas;
  const getWidth = engine.getRenderWidth;
  const getHeight = engine.getRenderHeight;
  if (
    typeof getCanvas !== 'function' ||
    typeof getWidth !== 'function' ||
    typeof getHeight !== 'function'
  ) {
    return null;
  }
  try {
    const canvas: unknown = (getCanvas as () => unknown).call(source);
    if (typeof canvas !== 'object' || canvas === null) return null;
    const element = canvas as Record<string, unknown>;
    return {
      // Read fresh, unlike the debug panel's copy: the report is one button
      // press, and a layout for it costs nothing anyone can feel.
      cssWidth: readNumber(element.clientWidth),
      cssHeight: readNumber(element.clientHeight),
      backingWidth: readNumber(element.width),
      backingHeight: readNumber(element.height),
      bufferWidth: readNumber((getWidth as (useScreen: boolean) => unknown).call(source, true)),
      bufferHeight: readNumber((getHeight as (useScreen: boolean) => unknown).call(source, true)),
    };
  } catch {
    // A disposed engine, or a context that throws rather than answering.
    return null;
  }
}

function readNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.NaN;
}

/** `440x956`, with a dash for a side the device fumbled. */
function pair(width: number, height: number): string {
  return `${whole(width)}x${whole(height)}`;
}

function whole(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : '-';
}

function ratioText(value: number): string {
  if (!Number.isFinite(value)) return '-';
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function aspect(width: number, height: number): string {
  return width > 0 && height > 0 ? (width / height).toFixed(3) : '-';
}
