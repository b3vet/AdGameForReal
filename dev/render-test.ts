/**
 * Standalone render harness: `npm run dev` then open `/dev/render-test.html`.
 *
 * Same fixture the app's `?scene=render-test` mode runs, minus the app: no
 * state machine, no overlay, no sim. The fixture drives every visual the
 * renderer owns — staff swaps, splash, chain, frost slow and shatter, block
 * deaths, boss walk, stomp, enrage and death, the win cheer — so the whole
 * render layer can be reviewed in one twenty-second loop.
 *
 *   /dev/render-test.html            the fixture's own count arc, 5 to 120
 *   /dev/render-test.html?count=500  a full crowd parked on the road, which is
 *                                    what the draw-call budget is measured at
 *
 * The HUD prints the draw calls that budget is about. Screenshot scripts wait
 * for `window.__renderTest.ready`.
 */

import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import type { RunState } from '@/sim';

interface RenderTestHandle {
  ready: boolean;
  /** The fake run being drawn, so a screenshot script can assert on it. */
  state: () => Readonly<RunState>;
  /** Draw calls in the last frame; the budget is 40 at 500 units. */
  drawCalls: () => number;
  /**
   * Every animation clip in the scene, with a `*` on the ones playing. The
   * crowds are baked textures with no clips of their own, so this is the boss's
   * state machine — Idle, Walk, Punch, HitReact, Death — which is otherwise
   * only visible by eye.
   */
  clips: () => string[];
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __renderTest: RenderTestHandle | undefined;
}

const canvas = document.querySelector<HTMLCanvasElement>('#render-test-canvas');
if (canvas === null) throw new Error('dev/render-test.html is missing #render-test-canvas');
const hud = document.querySelector<HTMLElement>('#hud');

const params = new URLSearchParams(window.location.search);
const floorCount = Number(params.get('count') ?? Number.NaN);
/** `?glow=0` proves the degrade ladder's glow rung on a real scene. */
const glow = params.get('glow') !== '0';

const renderer = new Renderer(canvas);

async function main(): Promise<void> {
  await renderer.init();
  renderer.setGlow(glow);
  if (params.has('physics')) {
    // No Havok in this harness, so quality 0 is also how the baked death
    // animation on a killed block gets exercised.
    renderer.setPhysicsQuality(Number(params.get('physics') ?? 2));
  }

  window.addEventListener('resize', () => {
    renderer.resize();
  });

  const scene = runRenderDevScene(
    renderer,
    Number.isFinite(floorCount) ? { floorCount } : {},
  );

  if (hud !== null) {
    // Off the render loop: the HUD is a debugging aid, not a frame cost.
    window.setInterval(() => {
      const state = scene.scenario.state;
      const boss = state.boss;
      hud.textContent =
        `draws ${String(renderer.drawCalls)}  units ${String(Math.round(state.squad.count))}` +
        `  staff ${state.squad.weaponId ?? 'ember'}  z ${state.squad.z.toFixed(0)}` +
        `  ${boss === null ? 'no boss' : `boss ${String(Math.round(boss.hp))}${boss.enraged === true ? ' enraged' : ''}`}`;
    }, 250);
  }

  globalThis.__renderTest = {
    ready: true,
    state: () => scene.scenario.state,
    drawCalls: () => renderer.drawCalls,
    clips: () =>
      renderer.scene.animationGroups.map((group) => `${group.name}${group.isPlaying ? '*' : ''}`),
  };
}

main().catch((error: unknown) => {
  console.error('[render-test] failed to start', error);
});
