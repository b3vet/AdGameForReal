/**
 * `?scene=render-test` mode: drives the renderer with a fake `RunState` so the
 * render layer can be reviewed without the sim being finished.
 *
 * The app hands the renderer over and steps aside — there is no `Run`, no HUD
 * and no app frame loop in this mode — so this owns the loop itself.
 * `dev/render-test.ts` is the same thing behind its own Vite entry.
 */

import { DevScenario } from './dev-scenario';
import type { Renderer } from './Renderer';

/**
 * The fixture sub-steps internally, so this only needs to bound a truly stalled
 * tab. It is deliberately generous: SwiftShader in CI renders this scene at
 * about 3 fps, and a tighter clamp would leave the fixture's story running in
 * slow motion so the boss never arrives inside a screenshot pass.
 */
const MAX_FRAME_DT = 1;

export interface DevSceneHandle {
  /** Stops the loop. The renderer is left alone: its owner disposes it. */
  stop: () => void;
  /** The fixture being played, for debugging from the console. */
  scenario: DevScenario;
}

export function runRenderDevScene(renderer: Renderer): DevSceneHandle {
  const scenario = new DevScenario();
  renderer.loadLevel(scenario.level);

  let rafId: number | null = null;
  let previous = 0;

  const frame = (time: number): void => {
    rafId = requestAnimationFrame(frame);

    const dt = previous === 0 ? 0 : Math.min(MAX_FRAME_DT, (time - previous) / 1000);
    previous = time;

    const events = scenario.advance(dt);
    // The fixture loops forever; a fresh pass needs the pools handed back out.
    if (scenario.takeReloaded()) renderer.loadLevel(scenario.level);
    renderer.update(scenario.state, events, dt);
  };

  rafId = requestAnimationFrame(frame);

  return {
    stop: () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
    scenario,
  };
}

export { DevScenario };
