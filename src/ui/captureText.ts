/**
 * A capture as the panel prints it: a dozen short lines, composed to fit a
 * 390 px phone at the panel's type size, because a readout that needs a
 * horizontal scroll is not a readout.
 *
 * Split out of `./capture.ts` when the capture grew the phase split (docs/28,
 * note 5); the device report prints the same numbers in its own layout
 * (`src/core/report.ts`).
 */

import type { CaptureSummary, Spread } from './capture';
import { SPIKE_MS } from './spikeWindow';

/**
 * The block. `drew` is false for a window in which no frame was drawn, which
 * says so rather than printing a column of zeros.
 */
export function composeCapture(summary: CaptureSummary, drew: boolean): string {
  const header = `arcane-rush ${summary.seconds.toFixed(1)}s / ${String(summary.frames)} frames`;
  if (!drew) return `${header}\nno frames drawn`;

  const run =
    summary.run === null
      ? 'no run'
      : `lvl ${String(summary.run.level)} squad ${String(summary.run.squadMin)}-` +
        `${String(summary.run.squadMax)}`;
  const crowd = summary.crowd;

  return [
    header,
    `fps avg ${summary.fpsAverage.toFixed(1)} med ${summary.fpsMedian.toFixed(0)}` +
      ` p95 ${summary.fpsP95.toFixed(0)}  >${String(SPIKE_MS)}ms ${String(summary.over20)}`,
    `raf ${hz(summary.rafHz)}  px ${summary.pixelRatio.toFixed(2)}` +
      ` min ${summary.pixelRatioMin.toFixed(2)}/${summary.devicePixelRatio.toFixed(2)}`,
    `frm ${triple(summary.frameMs, 1)} ms (med/p95/max)`,
    `js  ${pair(summary.js)} ms (mean/p95)`,
    `sim ${pair(summary.sim)}  phy ${pair(summary.physics)}`,
    `vw  ${pair(summary.views)}  drw ${pair(summary.draw)}`,
    `draws ${String(Math.round(summary.draws.median))}/${String(summary.drawPeak)}` +
      ` tris ${count(summary.triangles.median)}/${count(summary.triangles.max)}` +
      ` rung ${String(summary.rungPeak)}`,
    `crowd whole ${String(Math.round(crowd.whole))} lod ${String(Math.round(crowd.small))}` +
      ` cull ${String(Math.round(crowd.culled))}`,
    run,
  ].join('\n');
}

/** The three the panel has room for: the middle, the bad, and the worst. */
function triple(value: Spread, digits: number): string {
  return (
    `${value.median.toFixed(digits)}/${value.p95.toFixed(digits)}/${value.max.toFixed(digits)}`
  );
}

/** A phase: its mean, which a coarse clock still gets right, and its p95. */
function pair(value: Spread): string {
  return `${value.mean.toFixed(2)}/${value.p95.toFixed(1)}`;
}

/** `612k`, `1.9M`: a triangle count in four characters. */
export function count(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${Math.round(value / 1e3).toString()}k`;
  return Math.round(value).toString();
}

/** `120Hz`, or a dash where the loop did not say. */
export function hz(value: number): string {
  return value > 0 ? `${value.toFixed(0)}Hz` : '-';
}
