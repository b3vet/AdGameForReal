/**
 * `window.__arcane`: the handle `scripts/smoke.mjs`, `src/device/simTap.ts` and
 * manual debugging drive the game through.
 *
 * A file of its own because it is a *contract* — three things outside the app
 * read it, two of them from outside TypeScript — and a contract should not have
 * to be found inside a 500-line state machine. `App.publishHandle` is what fills
 * it in; nothing else may write `globalThis.__arcane`.
 *
 * Keep the shape stable, and add rather than rename.
 */

import type { PhysicsLayer } from '@/physics';
import type { Run, RunState } from '@/sim';

import type { App } from './App';
import type { PlayerState } from './player';

/** The handle `scripts/smoke.mjs` and manual debugging use. Keep it stable. */
export interface ArcaneDebugHandle {
  ready: boolean;
  app: App;
  run: () => Run | null;
  state: () => Readonly<RunState> | null;
  /** Null until `init` finishes, and when `?physics=0` skipped it. */
  physics: () => PhysicsLayer | null;
  /** Which rung of the degrade ladder the app is on; 0 is everything on. */
  quality: () => number;
  /** Draw calls: the last frame's, and the worst since the run started. */
  draws: () => { current: number; peak: number };
  /**
   * Shader programs compiled so far and what the warm-up pass did. The smoke
   * asserts `programs` does not move across a whole level of play.
   */
  shaders: () => {
    programs: number;
    warmed: number;
    skipped: number;
    failed: number;
    warming: boolean;
  };
  /** The player's meta state: coins, upgrades, staffs, wisp, bestiary. */
  player: () => Readonly<PlayerState>;
  /**
   * Writes a hand-made player over the saved one and re-paints whatever menu
   * is up. Every field is validated on the way in (`src/core/save.ts`), so a
   * malformed patch cannot leave the Academy holding an impossible state. The
   * smoke test uses it to photograph an Academy with coins in it.
   */
  setPlayer: (patch: unknown) => void;
  /**
   * Sim seconds per real second, live: `?turbo` after the page has booted,
   * clamped to the same 1 to `MAX_TURBO` the query parameter is.
   *
   * The hero shots are why it exists (`scripts/smoke-hero.mjs`). A scripted run
   * reaches the boss at turbo 60, where one frame is three seconds of sim and
   * fifteen metres of road — and a frame that has to be taken with a gate row
   * *ten metres* ahead cannot be found at that step size. So the driver runs
   * fast down the road and slows the sim as the row it wants comes into reach.
   */
  setTurbo: (value: number) => void;
  /**
   * Takes the wheel: the running session's bot lets go and the head goes to
   * `x` metres, 1:1, as a finger would put it there. A no-op when no run is up.
   *
   * The hero set is why it exists (`scripts/smoke-hero.mjs`): a whip and a
   * fence jam are swipes, and a swipe has to be *started*, on a chosen frame at
   * a chosen squad size, which no bot will do on request. A run whose bot has
   * let go is no longer a run any measurement may be taken from — nothing
   * steers it — so this is the picture-taking path and nothing else.
   */
  steer: (x: number) => void;
}

declare global {
  // `var` is required here: this is a global augmentation, not a declaration.
  var __arcane: ArcaneDebugHandle | undefined;
}
