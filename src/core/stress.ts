/**
 * The performance stress scene: 500 mages, 40 skeletons, 300 stream bodies and
 * a physics layer being fed a kill every 50 ms, on top of the renderer's scene.
 *
 * It lives in `src/core` rather than in `dev/` because the smoke test drives it
 * through the app (`?scene=stress`) and `dist/` carries no dev pages;
 * `dev/stress-test.html` is a thin wrapper around this same function so a human
 * can look at it with a HUD. It is the app agent's scene, not the renderer's:
 * it draws no gameplay, only a worst-case crowd, and it never touches a `Run`.
 *
 * What it is for (docs/06-milestone-2-plan.md, "Performance"): draw calls under
 * 40 at 500 units, and a render-millisecond tripwire the smoke can fail on.
 * Milestone 3 adds the horde the target is now stated against (plan,
 * "Performance": 60 fps at 300 units plus 200 live stream enemies) — three
 * hundred walking bodies in the *same* crowd as the block skeletons, so they
 * cost instances and animation but not a draw call, dying twenty times a second
 * so the death range, the corpse recycle and the ragdoll rule are all in frame.
 */

import { PhysicsLayer } from '@/physics';
import type { PhysicsQuality } from '@/physics';
import { VatCrowd, loadCharacterAsset } from '@/render/characters';
import type { Renderer } from '@/render/Renderer';
import { crowdScale } from '@/render/squad';
import { GRUNT_SCALE, MAGE_SCALE } from '@/render/theme';
import { balance } from '@/data';
import { formationOffsets, mulberry32 } from '@/sim';
import type { LevelDef, RunState, SimEvent } from '@/sim';

import { StressBodies } from './stressBodies';

export interface StressOptions {
  mages?: number;
  skeletons?: number;
  /** Live bodies in the two stream lanes. 0 leaves the road empty. */
  streamBodies?: number;
  /** Seconds between scripted kills. 0 turns the physics script off. */
  killEvery?: number;
  quality?: PhysicsQuality;
}

export interface StressStats {
  drawCalls: number;
  /**
   * Median cost of the `scene.render` call, in milliseconds, over every frame
   * but the first.
   *
   * A median and not an average: the frame a ragdoll first appears on compiles
   * its shader and is worth hundreds of times a steady frame. With only a
   * handful of frames in the window — a software rasteriser gets three or four
   * into eight seconds — one such spike would own an average.
   */
  renderMs: number;
  /** The worst of those frames, which is usually one of those compiles. */
  renderMsMax: number;
  /**
   * The first frame, kept out of the median and reported on its own: it is the
   * crowd's shader compilation, which is hundreds of milliseconds and says
   * nothing about the cost of drawing a frame.
   */
  renderMsFirst: number;
  /** How many frames the median is taken over. Single digits under SwiftShader. */
  renderSamples: number;
  /**
   * Rolling wall-clock gap between frames, in milliseconds. On a real GPU this
   * tracks `renderMs`; under SwiftShader it is several times larger, because
   * `scene.render` only queues the work and the rasteriser finishes it before
   * the next frame is scheduled. Both numbers are reported so a regression in
   * either is visible.
   */
  frameMs: number;
  fps: number;
  frames: number;
  mages: number;
  skeletons: number;
  /** Stream bodies on their feet in the measured frame. */
  streamBodies: number;
  ragdolls: number;
  shards: number;
  quality: number;
  /** Wall-clock seconds since the first frame. */
  seconds: number;
}

export interface StressHandle {
  ready: boolean;
  stats: () => StressStats;
  /**
   * Stops the frame loop and leaves the last frame on the canvas.
   *
   * A screenshot tool asks the compositor for a fresh frame and waits for it;
   * a scene that takes over a second per frame under SwiftShader starves that
   * request until the tool gives up, so the smoke pauses before it shoots.
   */
  pause: () => void;
  /**
   * Throws away the render costs collected so far, so the next `stats()` reads
   * a fresh window.
   *
   * The smoke samples three windows and fails only if two of them are over
   * budget (`scripts/smoke-stress.mjs`): one busy machine hiccup lands in one
   * window, and a cumulative median would carry it into the next two.
   */
  resetSamples: () => void;
  dispose: () => void;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __stress: StressHandle | undefined;
}

const DEFAULT_MAGES = 500;
const DEFAULT_SKELETONS = 40;
/** The plan's horde: two lanes of the sim's own ceiling on live bodies. */
const DEFAULT_STREAM_BODIES = 300;
/** The lanes a horde row pours down: neighbours, so the squad can answer both. */
const STREAM_LANES = [-1, 0] as const;
/**
 * Seconds between scripted kills. Twenty a second is what a squad clearing a
 * stream at the pressure bands actually does, and it is what keeps a death
 * animation, a corpse recycle and a ragdoll in every frame.
 */
const DEFAULT_KILL_EVERY = 0.05;

/** Where the crowd stands: the camera's default pose looks straight at it. */
const CROWD_Z = 2;
const ENEMY_Z = 14;
const ARENA_Z = 40;

/** Frame delta ceiling, matching the app's own. */
const MAX_DT = 0.05;

/** A block coming apart, on top of the river: the six-corpse burst, once a second. */
const BLOCK_KILL_EVERY = 1;

/** Smoothing weight for the rolling frame interval. */
const AVERAGE_WEIGHT = 0.1;

/** How many render costs the median is taken over, at most. */
const RENDER_SAMPLE_LIMIT = 64;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  const low = sorted[middle - 1] ?? 0;
  const high = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? high : (low + high) / 2;
}

const now = (): number => (typeof performance === 'undefined' ? 0 : performance.now());

/**
 * Builds the scene and starts its own frame loop. The returned handle is also
 * published as `window.__stress` for the smoke test and the dev page.
 */
export async function runStressScene(
  renderer: Renderer,
  options: StressOptions = {},
): Promise<StressHandle> {
  const mageCount = options.mages ?? DEFAULT_MAGES;
  const skeletonCount = options.skeletons ?? DEFAULT_SKELETONS;
  const killEvery = options.killEvery ?? DEFAULT_KILL_EVERY;
  const streamCount = options.streamBodies ?? DEFAULT_STREAM_BODIES;

  const scene = renderer.scene;
  const random = mulberry32(0x57_2e_55);

  const mageAsset = await loadCharacterAsset(scene, 'mage', { variant: 'ember' });
  const mages = new VatCrowd(mageAsset, mageCount);
  const skeletonAsset = await loadCharacterAsset(scene, 'skeleton_minion');
  // One crowd for the block skeletons *and* the river, exactly as the game
  // packs them: two crowds of the same character would be a second draw call
  // this scene is supposed to prove the game does not pay.
  const skeletons = new VatCrowd(skeletonAsset, skeletonCount + streamCount);
  const stream = new StressBodies(streamCount, STREAM_LANES, killEvery);
  stream.setDeathSeconds(skeletons.durationOf('death'));

  // The sim's own formation, not an approximation of it: the crowd this scene
  // measures has to be the shape and density the game will actually draw.
  const offsets = formationOffsets(mageCount);
  // The game's own unit scale, not 1: a crowd drawn larger than the game draws
  // it measures a fill rate the game never pays (Phase B4 open issue).
  const mageScale = crowdScale(mageCount) * MAGE_SCALE;
  for (let i = 0; i < mageCount; i++) {
    const offset = offsets[i] ?? { x: 0, z: 0 };
    mages.setInstance(
      i,
      offset.x,
      0,
      CROWD_Z + offset.z,
      Math.sin(i) * 0.12,
      mageScale,
      'run',
      // Staggered, or five hundred mages cast in lockstep and the VAT's one
      // texture read becomes visible as a single animated dummy.
      (i % 17) * 0.037,
    );
  }
  mages.setCount(mageCount);
  mages.commit();

  for (let i = 0; i < skeletonCount; i++) {
    const row = Math.floor(i / 10);
    skeletons.setInstance(
      i,
      -2.2 + (i % 10) * 0.5,
      0,
      ENEMY_Z + row * 0.9,
      Math.PI,
      GRUNT_SCALE,
      'walk',
      (i % 11) * 0.05,
    );
  }
  // The blocks are static and written once; the river is rewritten every frame
  // from `skeletonCount` on.
  skeletons.setCount(skeletonCount);
  skeletons.commit();

  const physics = new PhysicsLayer(scene, { quality: options.quality ?? 2 });
  try {
    await physics.init();
    physics.loadLevel(fakeLevel());
  } catch (error: unknown) {
    console.warn('[stress] physics unavailable', error);
    physics.setQuality(0);
  }

  // The same pass the game runs before a level (`src/render/warmup.ts`): the
  // crowds and the ragdoll pool are built after `Renderer.init` warmed the
  // scene, so without this the first frame that draws a corpse compiles its
  // shader — which under SwiftShader is a twelve-second frame in the middle of
  // the measurement, and on the phone is exactly the hitch the pass exists to
  // remove. Measured with it: one 14.6 s frame in seven became none.
  await renderer.warmUp();

  const state = fakeState();
  const events: SimEvent[] = [];
  let enemyId = 1000;
  // Primed, so the first frame already throws a body: a software rasteriser
  // gets three or four frames into an eight-second window, and a scene whose
  // debris only starts after a second would be measured and photographed
  // without any.
  let sinceKill = killEvery;
  let elapsed = 0;
  let frames = 0;
  /** Post-warmup `scene.render` costs, newest last. Bounded so it never grows. */
  const renderCosts: number[] = [];
  let renderMsFirst = 0;
  let frameMs = 0;
  let fps = 0;
  let lastTime = 0;
  let rafId: number | null = null;
  let disposed = false;

  const frame = (time: number): void => {
    if (disposed) return;
    rafId = requestAnimationFrame(frame);

    // Two deltas on purpose. `dt` is clamped, because that is what the game
    // does and what the pools expect; `real` is not, because the script and the
    // readouts have to describe the wall clock — under SwiftShader a frame can
    // take a second and a half, and a clamped clock would report a scene that
    // never got past its first second.
    const real = lastTime === 0 ? 0 : (time - lastTime) / 1000;
    const dt = Math.min(MAX_DT, real);
    lastTime = time;
    elapsed += real;
    frames++;
    if (real > 0) {
      fps += (1 / real - fps) * AVERAGE_WEIGHT;
      frameMs = frameMs === 0 ? real * 1000 : frameMs + (real * 1000 - frameMs) * AVERAGE_WEIGHT;
    }

    mages.update(dt);
    skeletons.update(dt);

    events.length = 0;
    if (killEvery > 0) {
      // The river's own kills: twenty a second, each one a stream body, so the
      // physics layer takes the `usesRagdoll` path the game takes.
      stream.update(dt, real, events);
      // And one block a second on top, which is the burst of six corpses.
      sinceKill += real;
      if (sinceKill >= BLOCK_KILL_EVERY) {
        sinceKill -= BLOCK_KILL_EVERY;
        events.push({
          type: 'enemyKilled',
          enemyId: ++enemyId,
          kind: 'grunt',
          x: (random() - 0.5) * 3,
          z: ENEMY_Z - 2 + (random() - 0.5) * 2,
        });
      }
    }
    const written = stream.write(skeletons, skeletonCount, physics.stats.quality);
    skeletons.setCount(skeletonCount + written);
    skeletons.commit();
    physics.onEvents(events, state);
    physics.update(dt);

    const start = now();
    scene.render();
    const cost = now() - start;
    if (frames === 1) renderMsFirst = cost;
    else {
      renderCosts.push(cost);
      if (renderCosts.length > RENDER_SAMPLE_LIMIT) renderCosts.shift();
    }
  };

  rafId = requestAnimationFrame(frame);

  const pause = (): void => {
    if (rafId === null) return;
    cancelAnimationFrame(rafId);
    rafId = null;
  };

  const handle: StressHandle = {
    ready: true,
    stats: () => ({
      drawCalls: renderer.drawCalls,
      renderMs: median(renderCosts),
      renderMsMax: renderCosts.length === 0 ? 0 : Math.max(...renderCosts),
      renderMsFirst,
      renderSamples: renderCosts.length,
      frameMs,
      fps,
      frames,
      mages: mageCount,
      skeletons: skeletonCount,
      streamBodies: stream.liveCount,
      ragdolls: physics.stats.ragdolls,
      shards: physics.stats.shards,
      quality: physics.stats.quality,
      seconds: elapsed,
    }),
    pause,
    resetSamples: () => {
      renderCosts.length = 0;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      pause();
      physics.dispose();
      mages.dispose();
      skeletons.dispose();
      if (globalThis.__stress === handle) globalThis.__stress = undefined;
    },
  };

  globalThis.__stress = handle;
  return handle;
}

/** Just enough level for the physics layer's road collider. */
function fakeLevel(): LevelDef {
  return {
    index: 1,
    seed: 1,
    runSpeed: balance.squad.runSpeed,
    startCount: DEFAULT_MAGES,
    rows: [],
    arenaZ: ARENA_Z,
    boss: { hp: 400, units: 40 },
  };
}

/**
 * Just enough state for `PhysicsLayer.onEvents`, which reads the squad position
 * to know which way to throw a corpse. Nothing here ever ticks.
 */
function fakeState(): RunState {
  return {
    levelIndex: 1,
    seed: 1,
    time: 0,
    status: 'running',
    squad: {
      count: DEFAULT_MAGES,
      x: 0,
      targetX: 0,
      z: CROWD_Z,
      fireRate: balance.squad.fireRate,
      damage: balance.squad.damage,
      fireRateBonus: 0,
    },
    gates: [],
    enemies: [],
    streams: [],
    projectiles: [],
    boss: null,
    peakCount: DEFAULT_MAGES,
    survivors: DEFAULT_MAGES,
    arenaZ: ARENA_Z,
  };
}
