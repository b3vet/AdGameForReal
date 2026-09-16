/**
 * The arithmetic of keeping the canvas's backing store the shape of the canvas
 * (docs/27-device-playtest-fixes.md, section A).
 *
 * Three sizes describe the canvas, and the scene is only drawn right when all
 * three are the same shape:
 *
 *   - the CSS box, which is what the player sees and what the HUD is laid out
 *     against;
 *   - the backing store (`canvas.width` and `canvas.height`), which Babylon sets
 *     from the box and the pixel ratio whenever it is asked to, and never
 *     otherwise;
 *   - the drawing buffer (`drawingBufferWidth` and `drawingBufferHeight`),
 *     which is what the browser actually allocated. Babylon takes the camera's
 *     aspect from this one.
 *
 * The first device run had a 440×956 box over a 1320×1320 buffer: the camera
 * framed a square, the compositor stretched it up the screen, and the road came
 * out a strip. `./backingStore.ts` is what keeps the three in step; this file is
 * the part of it that is plain numbers, so it is tested without a browser
 * (`./__tests__/backingFit.test.ts`), and so the device report can reach the
 * same verdict from the same rule (`src/core/reportCanvas.ts`).
 */

/**
 * How far two aspect ratios may differ, relative, and still be the same shape.
 *
 * Not zero, because the backing store is a truncation: a 393×852 box at 1.5x is
 * 589×1278, which is 0.08 percent off. One percent is twelve times that and
 * still a hundred times smaller than the fault it exists to catch, which was a
 * factor of 2.17.
 */
const ASPECT_TOLERANCE = 0.01;

/**
 * The fewest backing pixels per CSS pixel the fit will ever settle for. Only a
 * browser that could not allocate even a quarter-resolution buffer gets here,
 * and a blurry frame is still better than a zero-sized one.
 */
const MIN_FITTED_RATIO = 0.25;

/**
 * Steps the fitted ratio is rounded down to. A ratio that came out of a
 * division carries float noise, and the scaling level it becomes is compared
 * for equality before every resize (`./rendererQuality.ts`); rounding keeps one
 * limit from producing a stream of "different" levels that are the same.
 */
const RATIO_STEPS = 1000;

/**
 * The canvas, three ways, plus the verdict. Written in place by
 * `BackingStore.readout` for the debug panel, which holds one for the life of
 * the app (`src/ui/debugStats.ts` declares the same shape).
 */
export interface CanvasReadout {
  cssWidth: number;
  cssHeight: number;
  backingWidth: number;
  backingHeight: number;
  bufferWidth: number;
  bufferHeight: number;
  /** False when the backing store or the drawing buffer is not the box's shape. */
  inShape: boolean;
}

/** A readout of nothing: the renderer before `init`. */
export function clearReadout(out: CanvasReadout): void {
  out.cssWidth = 0;
  out.cssHeight = 0;
  out.backingWidth = 0;
  out.backingHeight = 0;
  out.bufferWidth = 0;
  out.bufferHeight = 0;
  out.inShape = false;
}

/**
 * What Babylon makes of a CSS length at a pixel ratio: the length divided by
 * the scaling level, truncated (`AbstractEngine.resize` and `setSize`). The
 * same expression, not `css * ratio`, so the two agree about the float noise.
 */
export function backingLength(css: number, ratio: number): number {
  return (css / (1 / ratio)) | 0;
}

/** Whether a×b and c×d are the same shape; nothing empty is ever in shape. */
export function sameShape(
  width: number,
  height: number,
  otherWidth: number,
  otherHeight: number,
): boolean {
  if (!(width > 0 && height > 0 && otherWidth > 0 && otherHeight > 0)) return false;
  const aspect = width / height;
  const other = otherWidth / otherHeight;
  return Math.abs(aspect - other) <= ASPECT_TOLERANCE * other;
}

/**
 * The verdict the panel and the report print: the backing store and the
 * drawing buffer are both the box's shape.
 */
export function readoutInShape(readout: Readonly<CanvasReadout>): boolean {
  return (
    sameShape(readout.backingWidth, readout.backingHeight, readout.cssWidth, readout.cssHeight) &&
    sameShape(readout.bufferWidth, readout.bufferHeight, readout.cssWidth, readout.cssHeight)
  );
}

/**
 * The highest pixel ratio at or under `wanted` whose backing store fits inside
 * `limitWidth` × `limitHeight`.
 *
 * One ratio for both axes, which is the whole point: a browser that cannot give
 * the height asked for clamps the height alone (WebKit's `clampedCanvasSize`
 * does exactly that), and the frame is then squeezed. Lowering the ratio shrinks
 * both sides together, so the frame gets softer instead of the wrong shape.
 *
 * `wanted` comes back untouched whenever it fits, so a device with room to
 * spare renders at exactly the ratio the ladder asked for, float and all.
 */
export function fittedPixelRatio(
  cssWidth: number,
  cssHeight: number,
  wanted: number,
  limitWidth: number,
  limitHeight: number,
): number {
  if (!(cssWidth > 0 && cssHeight > 0)) return wanted;
  if (
    backingLength(cssWidth, wanted) <= limitWidth &&
    backingLength(cssHeight, wanted) <= limitHeight
  ) {
    return wanted;
  }
  const fit = Math.min(wanted, limitWidth / cssWidth, limitHeight / cssHeight);
  return Math.max(MIN_FITTED_RATIO, Math.floor(fit * RATIO_STEPS) / RATIO_STEPS);
}

/**
 * The most a browser will allocate along one side, updated by what it just
 * did: asked for `requested`, it gave `got`. A smaller answer is a ceiling the
 * device has (a texture or viewport maximum); an equal one says nothing new.
 * A zero is a lost context, not a limit.
 */
export function learnedLimit(requested: number, got: number, limit: number): number {
  if (!(got > 0) || got >= requested) return limit;
  return Math.min(limit, got);
}
