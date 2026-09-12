/**
 * Standalone render harness: `npm run dev` then open `/dev/render-test.html`.
 *
 * Same fixture the app's `?scene=render-test` mode runs, minus the app: no
 * state machine, no overlay, no sim. The fixture drives every visual the
 * renderer owns — staff swaps, the three magic sprites and their impacts,
 * splash, chain, frost slow and shatter, block deaths, the streams of bodies
 * dying and leaking under their floating counts, boss taunt, walk, stomp,
 * enrage and death, the win cheer — so the whole render layer can be reviewed
 * in one twenty-second loop.
 *
 * Milestone 4 adds the rest of it: two rune-stone fences the scripted squad is
 * pushed against (D32), the wisp hovering beside the crowd and throwing sparks
 * while it steps through all three tiers (D33), and the three staff evolutions
 * — ember's burn, storm's extra chain hop and frost's shatter puff — which the
 * fixture plays at tier 2 so every one of them is on screen in a single pass.
 *
 *   /dev/render-test.html            the fixture's own count arc, 5 to 120
 *   /dev/render-test.html?count=500  a full crowd parked on the road, which is
 *                                    what the draw-call budget is measured at
 *   /dev/render-test.html?preview=1  the Academy backdrop: the camera drifts and
 *                                    a tier-3 wisp hovers beside the crowd
 *
 * The HUD prints the draw calls that budget is about. Screenshot scripts wait
 * for `window.__renderTest.ready`.
 */

import { Renderer } from '@/render/Renderer';
import { runRenderDevScene } from '@/render/dev-scene';
import { emptyPlayer } from '@/sim';
import type { PlayerState, RunState } from '@/sim';

interface RenderTestHandle {
  ready: boolean;
  /** The fake run being drawn, so a screenshot script can assert on it. */
  state: () => Readonly<RunState>;
  /** Draw calls in the last frame; the budget is 45 at level 10. */
  drawCalls: () => number;
  /** Live streams, their remaining counts, and the bodies on the road. */
  streams: () => { remaining: number[]; bodies: number };
  /**
   * What Milestone 4 put on the road: fence pieces drawn this frame, whether
   * the wisp is out and at which tier, its sparks in flight, and how many
   * bodies are burning. Screenshot scripts assert on these — a wall that is
   * silently truncated or a wisp that never draws looks like nothing at all.
   */
  features: () => {
    walls: number;
    wallDefs: number;
    wisp: boolean;
    tier: number;
    sparks: number;
    burning: number;
  };
  /** Whether the Academy backdrop (camera drift, preview wisp) is switched on. */
  preview: (player: PlayerState | null) => void;
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
const renderer = new Renderer(canvas);

async function main(): Promise<void> {
  await renderer.init();
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
      const bodies = state.enemies.reduce((n, e) => (e.streamId === undefined ? n : n + 1), 0);
      const live = state.streams.filter((s) => s.started && !s.done).length;
      const features = renderer.featureStats;
      hud.textContent =
        `draws ${String(renderer.drawCalls)}  units ${String(Math.round(state.squad.count))}` +
        `  staff ${state.squad.weaponId ?? 'ember'}  z ${state.squad.z.toFixed(0)}` +
        `  streams ${String(live)} (${String(bodies)} bodies)` +
        `  wall ${String(features.walls)}` +
        `  wisp ${features.wisp ? `t${String(state.familiar?.tier ?? 0)}` : 'off'}` +
        ` (${String(features.sparks)} sparks)  burning ${String(features.burning)}` +
        `  ${boss === null ? 'no boss' : `boss ${String(Math.round(boss.hp))}${boss.enraged === true ? ' enraged' : ''}`}`;
    }, 250);
  }

  globalThis.__renderTest = {
    ready: true,
    state: () => scene.scenario.state,
    drawCalls: () => renderer.drawCalls,
    streams: () => {
      const state = scene.scenario.state;
      return {
        remaining: state.streams.filter((s) => s.started && !s.done).map((s) => s.remaining),
        bodies: state.enemies.filter((e) => e.streamId !== undefined).length,
      };
    },
    clips: () =>
      renderer.scene.animationGroups.map((group) => `${group.name}${group.isPlaying ? '*' : ''}`),
    features: () => {
      const stats = renderer.featureStats;
      return {
        walls: stats.walls,
        wallDefs: scene.scenario.level.walls?.length ?? 0,
        wisp: stats.wisp,
        tier: scene.scenario.state.familiar?.tier ?? 0,
        sparks: stats.sparks,
        burning: stats.burning,
      };
    },
    preview: (player: PlayerState | null) => {
      renderer.setPreviewPlayer(player);
    },
  };

  // `?preview=1` switches the Academy backdrop on: the camera breathes and a
  // wisp the player owns hovers beside the crowd even though nothing ticks.
  if (params.has('preview')) {
    const player = emptyPlayer();
    player.familiar = { unlocked: true, tier: 3 };
    renderer.setPreviewPlayer(player);
  }
}

main().catch((error: unknown) => {
  console.error('[render-test] failed to start', error);
});
