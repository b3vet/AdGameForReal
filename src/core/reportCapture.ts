/**
 * The device report's capture section: the numbers of the last capture the
 * debug panel took (`src/ui/capture.ts`), laid out for a chat window.
 *
 * A file of its own for the file-size rule (CLAUDE.md), beside `./report.ts`
 * and on the terms of `./reportCanvas.ts`: pure formatting over a plain value,
 * handing back labelled rows for that file to align.
 */

import type { CaptureSummary } from '@/ui';

/** What an unknown field prints as. A dash is a reading; a blank is a bug. */
const MISSING = '-';

/**
 * The capture's numbers, not its pasteable block: the block is composed to fit
 * a 390 px panel and this one is read in a chat window, so the two are allowed
 * to disagree about width. The frame rate is quoted three ways on purpose —
 * the average is what the target is set in, the median is what it feels like
 * and the p95 is what it stumbles at.
 *
 * After the second device playtest (docs/28, note 5) the section also says
 * where the time went, well enough to decide the next change without a Mac on
 * the phone: the display's own rate (a ProMotion screen that hands the page
 * 120 callbacks a second shows as 120 here, drawn at 60), the frame's
 * JavaScript and its four phases as means (Safari's clock is coarse; a mean
 * over a thousand frames is still a good number), what the GPU was handed —
 * draw calls and triangles — and how the crowd was drawn. A phone whose phases
 * add up to a few milliseconds and still drops frames is waiting on its GPU,
 * and the triangles and the pixel ratio are the two dials for that. `draw` is
 * `scene.render`, which is where Babylon steps Havok too; `physics` is only the
 * layer's own bookkeeping around it.
 */
export function captureRows(capture: CaptureSummary | null): [label: string, value: string][] {
  if (capture === null) return [];
  const crowd = capture.crowd;
  return [
    ['window', `${capture.seconds.toFixed(1)}s, ${String(capture.frames)} frames`],
    [
      'fps',
      `avg ${ms(capture.fpsAverage, 1)} med ${ms(capture.fpsMedian, 0)} p95 ${ms(capture.fpsP95, 0)}`,
    ],
    [
      'display',
      capture.rafHz > 0
        ? `${ms(capture.rafHz, 0)} Hz, ${ms(capture.fpsAverage, 1)} drawn a second`
        : MISSING,
    ],
    ['frame p95', `${ms(capture.frameMs.p95, 1)} ms (med ${ms(capture.frameMs.median, 1)})`],
    ['>20ms', String(capture.over20)],
    ['js', spread(capture.js)],
    ['sim', spread(capture.sim)],
    ['views', spread(capture.views)],
    ['draw', spread(capture.draw)],
    ['render', spread(capture.render)],
    ['physics', spread(capture.physics)],
    [
      'draws',
      `med ${round(capture.draws.median)}, peak ${String(capture.drawPeak)},` +
        ` rung peak ${String(capture.rungPeak)}`,
    ],
    ['triangles', `med ${thousands(capture.triangles.median)}, max ${thousands(capture.triangles.max)}`],
    [
      'crowd',
      `whole ${round(crowd.whole)}, lod ${round(crowd.small)}, culled ${round(crowd.culled)} (med)`,
    ],
    [
      'ratio',
      `${ratio(capture.pixelRatio)}, min ${ratio(capture.pixelRatioMin)} of ${ratio(capture.devicePixelRatio)}`,
    ],
  ];
}

function spread(value: { mean: number; median: number; p95: number }): string {
  return `mean ${ms(value.mean, 2)} med ${ms(value.median, 2)} p95 ${ms(value.p95, 2)} ms`;
}

/** `612k`, `1.9M`. */
function thousands(value: number): string {
  if (!Number.isFinite(value)) return MISSING;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${String(Math.round(value / 1e3))}k`;
  return String(Math.round(value));
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
