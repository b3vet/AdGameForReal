/**
 * What the debug panel reads off a frame.
 *
 * Split out of `./frame.ts` in the Milestone 9 review, which had left that file
 * at 491 lines. The seam is the one the loop already had inside it: everything
 * here is *measurement* — a struct the panel reads, thirty fields copied into
 * it once a frame, and a heap tripwire — and nothing here decides anything
 * about a frame. `FrameDriver` keeps the clock, the pause and the order of the
 * work; it holds one of these and hands it the frame's numbers.
 *
 * Two rules from the loop come with it:
 *
 *   - the struct is allocated once and written in place. The panel holds the
 *     same object for the life of the app, and nothing on the frame path may
 *     allocate (CLAUDE.md);
 *   - it is only filled while `?debug` is up — except the frame's cost split
 *     and the two peaks, which are a few subtractions and a comparison and are
 *     written every frame (`costs`, `trackPeaks`). Reading Babylon's counters
 *     and the physics layer's stats is a dozen property reads, which is
 *     nothing next to a frame but is not free either, and no shipping build
 *     has a panel to spend it on.
 *
 * The draw-call and charger peaks moved here from the loop in the performance
 * pass after the second device playtest (docs/28, note 5), with the split of
 * the render into the views and `scene.render`: all of it is measurement.
 */

import type { Renderer } from '@/render/Renderer';
import type { RunState, SimEvent } from '@/sim';
import type { DebugStats } from '@/ui';

import type { FrameHost } from './frame';

/**
 * Chrome's non-standard heap readout, where it exists. Absent on Safari — which
 * is the device that matters — so this is a desktop tripwire for the allocation
 * audit, not a measurement anyone ships on.
 */
interface HeapMemory {
  usedJSHeapSize: number;
}

function heapBytes(): number {
  if (typeof performance === 'undefined') return 0;
  const memory = (performance as unknown as { memory?: HeapMemory }).memory;
  return memory === undefined ? 0 : memory.usedJSHeapSize;
}

/**
 * A drop of this many bytes between two frames reads as a collection rather
 * than as noise. A steady-state frame that allocates nothing never triggers
 * one; a frame that allocates a few kilobytes triggers one every few seconds,
 * which is the signal the audit is looking for.
 */
const HEAP_DROP_BYTES = 256 * 1024;

export class FrameStatsCollector {
  /** Re-used every frame: the debug panel reads it, nothing else may write it. */
  readonly stats: DebugStats = {
    simMs: 0,
    renderMs: 0,
    physicsMs: 0,
    viewsMs: 0,
    drawMs: 0,
    frameMs: 0,
    rafCallbacks: 0,
    activeMeshes: 0,
    triangles: 0,
    crowdWhole: 0,
    crowdSmall: 0,
    crowdCulled: 0,
    drawCalls: 0,
    drawCallsPeak: 0,
    streamBodies: 0,
    chargers: 0,
    labels: 0,
    labelGlyphs: 0,
    labelsDropped: 0,
    walls: 0,
    wisp: false,
    sparks: 0,
    burning: 0,
    timeScale: 1,
    ragdolls: 0,
    shards: 0,
    physicsBodies: 0,
    physicsQuality: 0,
    qualityRung: 0,
    qualityP95: 0,
    qualityReason: 'start',
    heapMb: 0,
    heapDrops: 0,
    pixelRatio: 0,
    devicePixelRatio: 1,
    canvas: {
      cssWidth: 0,
      cssHeight: 0,
      backingWidth: 0,
      backingHeight: 0,
      bufferWidth: 0,
      bufferHeight: 0,
      inShape: false,
    },
    audio: 'off',
    audioClips: 0,
  };

  /** Heap watch, `?debug` only: the last sample and how often it has fallen. */
  private lastHeap = 0;
  private heapDrops = 0;

  /**
   * Worst draw-call count since the last `resetPeaks`. Tracked on every frame
   * rather than only under `?debug`, because it is what the smoke test reads to
   * hold the frame budget (plan, "Performance"): one counter read per frame.
   */
  private peakDraws = 0;
  /**
   * Worst charger count since the last `resetPeaks`, tracked exactly like the
   * draw calls beside it and for one reader: the Frostfell smoke run asserts a
   * charger was actually drawn (D49). A single-frame sample cannot say that — a
   * charger is on the road for two seconds of a ninety-second run — and a peak
   * can, for one getter read per frame.
   */
  private peakChargers = 0;

  get peakDrawCalls(): number {
    return this.peakDraws;
  }

  get peakChargerBodies(): number {
    return this.peakChargers;
  }

  resetPeaks(): void {
    this.peakDraws = 0;
    this.peakChargers = 0;
  }

  /** Every drawn frame: the two peaks above. */
  trackPeaks(renderer: Renderer): void {
    const draws = renderer.drawCalls;
    if (draws > this.peakDraws) this.peakDraws = draws;
    const chargers = renderer.chargerBodies;
    if (chargers > this.peakChargers) this.peakChargers = chargers;
  }

  /**
   * Where a run frame's time went, from the loop's four clock readings and the
   * renderer's own `scene.render` time. Written every frame, panel or not, like
   * the three it has always written: it is four subtractions.
   *
   * The render is split in two because the two halves answer different
   * questions on a phone: `viewsMs` is ours (the views writing buffers), and
   * `drawMs` is Babylon's walk of the scene and the GL calls it makes.
   */
  costs(
    simStart: number,
    renderStart: number,
    physicsStart: number,
    physicsEnd: number,
    drawMs: number,
  ): void {
    const stats = this.stats;
    stats.simMs = renderStart - simStart;
    stats.renderMs = physicsStart - renderStart;
    stats.drawMs = Math.min(drawMs, stats.renderMs);
    stats.viewsMs = stats.renderMs - stats.drawMs;
    stats.physicsMs = physicsEnd - physicsStart;
  }

  /**
   * The whole frame callback up to the panel, and the display's callbacks so
   * far — drawn or skipped by the pacer — which is how a capture learns the
   * display's own rate (`src/ui/capture.ts`).
   */
  frameDone(frameMs: number, rafCallbacks: number): void {
    this.stats.frameMs = frameMs;
    this.stats.rafCallbacks = rafCallbacks;
  }

  /** A frame with no run on the road: nothing was measured. */
  idle(rafCallbacks: number): void {
    const stats = this.stats;
    stats.simMs = 0;
    stats.renderMs = 0;
    stats.viewsMs = 0;
    stats.drawMs = 0;
    stats.physicsMs = 0;
    stats.frameMs = 0;
    stats.rafCallbacks = rafCallbacks;
  }

  /**
   * Fills the struct off the live app and hands it to the panel.
   *
   * `dt` is the frame's own length and is 0 for an intermediate `?turbo` chunk,
   * which drew no frame and so must not move the panel's frame-rate average.
   */
  publish(
    host: FrameHost,
    state: Readonly<RunState> | null,
    events: readonly SimEvent[],
    dt: number,
  ): void {
    if (!host.overlay.debugEnabled) return;

    this.trackHeap();

    const physics = host.physics();
    const renderer = host.renderer;
    this.stats.drawCalls = renderer.drawCalls;
    this.stats.drawCallsPeak = this.peakDraws;
    this.stats.activeMeshes = renderer.activeMeshes;
    this.stats.triangles = renderer.triangles;
    const crowd = renderer.crowdStats;
    this.stats.crowdWhole = crowd.whole;
    this.stats.crowdSmall = crowd.small;
    this.stats.crowdCulled = crowd.culled;
    this.stats.streamBodies = host.renderer.streamBodies;
    this.stats.chargers = host.renderer.chargerBodies;
    const labels = host.renderer.labelStats;
    this.stats.labels = labels.labels;
    this.stats.labelGlyphs = labels.glyphs;
    this.stats.labelsDropped = labels.dropped;
    const features = host.renderer.featureStats;
    this.stats.walls = features.walls;
    this.stats.wisp = features.wisp;
    this.stats.sparks = features.sparks;
    this.stats.burning = features.burning;
    this.stats.ragdolls = physics?.stats.ragdolls ?? 0;
    this.stats.shards = physics?.stats.shards ?? 0;
    this.stats.physicsBodies = physics?.stats.bodies ?? 0;
    this.stats.physicsQuality = physics?.stats.quality ?? 0;
    this.stats.pixelRatio = host.renderer.pixelRatio;
    this.stats.devicePixelRatio = host.renderer.devicePixelRatio;
    host.renderer.readCanvas(this.stats.canvas);
    this.stats.audio = host.audio.muted ? `${host.audio.status} muted` : host.audio.status;
    this.stats.audioClips = host.audio.loadedCount;

    host.overlay.updateDebug(state, events, dt, host.phaseName(), this.stats);
  }

  /**
   * The allocation tripwire.
   *
   * Read it as a *relative* number, not an absolute one: the panel it reports
   * to composes a dozen strings of its own every frame, so `?debug` is itself
   * the loudest allocator on screen and the count is never zero. What it is
   * for is comparison — the same level, the same length of play, before and
   * after a change. A count that jumps is a new allocation in the loop.
   */
  private trackHeap(): void {
    const bytes = heapBytes();
    if (bytes === 0) return;
    if (this.lastHeap - bytes > HEAP_DROP_BYTES) this.heapDrops++;
    this.lastHeap = bytes;
    this.stats.heapMb = bytes / (1024 * 1024);
    this.stats.heapDrops = this.heapDrops;
  }
}
