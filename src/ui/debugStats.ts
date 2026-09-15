/**
 * `DebugStats`: what the app knows about the frame it just ran.
 *
 * A file of its own because it is a *contract* between the frame loop and the
 * panel — `src/core/frame.ts` owns one instance and overwrites it every frame,
 * and `./debug.ts` is the only thing that reads it — and a contract should not
 * have to be found inside a 400-line panel. Split out in Milestone 9 for the
 * file-size rule (CLAUDE.md) when the panel grew the device report.
 *
 * Keep the shape stable, and add rather than rename: every field here is a
 * number the product owner reads off a phone.
 */

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
  /** Stream bodies the renderer wrote into the crowd last frame (D29). */
  streamBodies: number;
  /** Chargers drawn last frame (D49); `POOL.chargers` is what it can run into. */
  chargers: number;
  /** World number labels drawn last frame, and the glyphs they cost. */
  labels: number;
  labelGlyphs: number;
  /** Glyphs the atlas budget refused; anything but 0 means numbers went missing. */
  labelsDropped: number;
  /**
   * What Milestone 4 put on the road (`Renderer.featureStats`): fence pieces
   * drawn, whether the wisp is out, its sparks in flight, and bodies burning.
   * Each has a pool a level can quietly run into, and all four are invisible in
   * a frame that is simply missing them — a wall that never draws and a wisp
   * that was never bound look the same.
   */
  walls: number;
  wisp: boolean;
  sparks: number;
  burning: number;
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
