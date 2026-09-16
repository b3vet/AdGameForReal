/**
 * What the debug panel says: the block the product owner reads off a phone in
 * one glance (docs/06-milestone-2-plan.md, definition of done 9).
 *
 * Split out of `./debug.ts` when the readout grew the frame's phase split and
 * the crowd's detail line (docs/28, note 5), which would have taken that file
 * past the size rule: that file is the panel's behaviour — buttons, the
 * capture, the report — and this is its text.
 */

import type { RunState } from '@/sim';

import { count } from './captureText';
import type { DebugCanvas, DebugStats } from './debugStats';
import { SPIKE_MS, SPIKE_WINDOW_SECONDS } from './spikeWindow';

/** One line of the event log, with how many times in a row it happened. */
export interface LogEntry {
  text: string;
  repeats: number;
}

/**
 * The panel's smoothed numbers: raw per-frame numbers jitter too much to read,
 * and a phone's hot spot shows up as a rising average, not as one bad frame.
 * `spikes` is the live count of frames over `SPIKE_MS` in the last
 * `SPIKE_WINDOW_SECONDS`.
 */
export interface PanelAverages {
  fps: number;
  simMs: number;
  viewsMs: number;
  drawMs: number;
  physicsMs: number;
  frameMs: number;
  spikes: number;
}

/**
 * Frame rate, where the frame went, what it cost to draw, how much of the
 * horde and how many world numbers are on screen, how much of the crowd came
 * from its low-polygon copy, which rung of the degrade ladder is in force at
 * what resolution, what physics is alive, and whether sound is on.
 *
 * `bodies` and `lbl` are the two ceilings Milestone 3 added that a level can
 * quietly run into — `POOL.grunts` and the glyph budget — so they are printed
 * next to the draw calls rather than left to be inferred from a missing
 * skeleton or a missing number. `DROP` only appears when the atlas actually
 * refused a glyph, which is the one case that is a bug rather than a reading.
 */
export function composeReadout(
  state: Readonly<RunState> | null,
  phase: string,
  stats: DebugStats,
  averages: Readonly<PanelAverages>,
  log: readonly LogEntry[],
): string {
  const lines = [
    `fps ${averages.fps.toFixed(0).padStart(3)}  phase ${phase}  x${stats.timeScale.toFixed(2)}`,
    `js ${averages.frameMs.toFixed(2)}ms  sim ${averages.simMs.toFixed(2)}` +
      `  phys ${averages.physicsMs.toFixed(2)}`,
    `views ${averages.viewsMs.toFixed(2)}ms  draw ${averages.drawMs.toFixed(2)}ms`,
    `draws ${String(stats.drawCalls)} peak ${String(stats.drawCallsPeak)}` +
      `  px ${stats.pixelRatio.toFixed(2)}/${stats.devicePixelRatio.toFixed(2)}`,
    `mesh ${String(stats.activeMeshes)}  tris ${count(stats.triangles)}` +
      `  crowd ${String(stats.crowdWhole)}+${String(stats.crowdSmall)}lod` +
      ` -${String(stats.crowdCulled)}`,
    canvasLine(stats.canvas),
    `bodies ${String(stats.streamBodies)}  chg ${String(stats.chargers)}` +
      `  lbl ${String(stats.labels)}` +
      `/${String(stats.labelGlyphs)}g` +
      (stats.labelsDropped > 0 ? ` DROP ${String(stats.labelsDropped)}` : ''),
    `wall ${String(stats.walls)}  wisp ${stats.wisp ? 'on' : 'off'}` +
      `  spark ${String(stats.sparks)}  burn ${String(stats.burning)}`,
    `rung ${String(stats.qualityRung)} ${stats.qualityReason}` +
      `  p95 ${stats.qualityP95.toFixed(1)}ms` +
      `  >${String(SPIKE_MS)}ms ${String(averages.spikes)}/${String(SPIKE_WINDOW_SECONDS)}s`,
    `rag ${String(stats.ragdolls)}  shard ${String(stats.shards)}` +
      `  bodies ${String(stats.physicsBodies)}  physq ${String(stats.physicsQuality)}`,
    // The heap rides with the audio line rather than with the ladder's: the
    // ladder line is already the longest the panel composes, and the two
    // together ran off the right edge of a 390 px phone, which is exactly the
    // clipping `debug.css` warns about. Chrome only, so on the phone this
    // line is the short one it has always been.
    `audio ${stats.audio} ${String(stats.audioClips)} clips` +
      (stats.heapMb > 0 ? `  heap ${stats.heapMb.toFixed(0)}MB gc ${String(stats.heapDrops)}` : ''),
  ];

  if (state === null) {
    lines.push('no run');
  } else {
    lines.push(
      `lvl ${String(state.levelIndex)} seed ${String(state.seed)} ${state.status}`,
      `t ${state.time.toFixed(1)}s  z ${state.squad.z.toFixed(1)}`,
      `count ${String(state.squad.count)}  peak ${String(state.peakCount)}`,
      `proj ${String(countAlive(state.projectiles))}  enemies ${String(countAlive(state.enemies))}`,
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
  if (log.length === 0) lines.push('(none)');
  else {
    for (const entry of log) {
      lines.push(entry.repeats > 1 ? `${entry.text} x${String(entry.repeats)}` : entry.text);
    }
  }

  return lines.join('\n');
}

/**
 * `css 440x956 bk 1320x2868 buf 1320x2868`: the box, the backing store and the
 * drawing buffer (`./debugStats.ts`). `SKEW` only when they are not one shape,
 * like `DROP` above — the one case that is a fault rather than a reading.
 * Forty-odd characters, inside the panel's width at 10 px.
 */
function canvasLine(canvas: Readonly<DebugCanvas>): string {
  return (
    `css ${String(canvas.cssWidth)}x${String(canvas.cssHeight)}` +
    ` bk ${String(canvas.backingWidth)}x${String(canvas.backingHeight)}` +
    ` buf ${String(canvas.bufferWidth)}x${String(canvas.bufferHeight)}` +
    (canvas.inShape ? '' : ' SKEW')
  );
}

function countAlive(items: readonly { alive: boolean }[]): number {
  let alive = 0;
  for (const item of items) if (item.alive) alive++;
  return alive;
}
