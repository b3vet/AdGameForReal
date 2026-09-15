/**
 * Filling in `window.__arcane`.
 *
 * `./handle.ts` is the *contract* — the shape three things outside the app read
 * — and this is the one function that satisfies it. Split out of `App` in
 * Milestone 8 for the file-size rule (CLAUDE.md), on the seam the file already
 * had: everything here is a closure over the app and nothing here is part of
 * the state machine.
 *
 * Nothing else may write `globalThis.__arcane`.
 */

import type { App } from './App';
import type { ArcaneDebugHandle } from './handle';
import type { PhysicsLayer } from '@/physics';
import type { RoomId } from './player';

/**
 * What the handle needs that is not on `App`'s public surface: the physics
 * layer (loaded late and owned privately), the ladder's rung and the frame
 * driver's peaks. Passed in as thunks so the handle reads them live rather
 * than freezing whatever was true at boot.
 */
export interface HandleSources {
  physics: () => PhysicsLayer | null;
  qualityRung: () => number;
  peakDrawCalls: () => number;
  peakChargerBodies: () => number;
  /** A debug injection may have changed what the menu on screen should say. */
  repaintMenu: () => void;
  /** Opens an Academy room, for a probe that wants to photograph one. */
  openRoom: (room: RoomId) => void;
}

/** Builds the handle and publishes it. Called once per app, by `App.start`. */
export function publishHandle(app: App, sources: HandleSources): ArcaneDebugHandle {
  const handle: ArcaneDebugHandle = {
    ready: true,
    app,
    run: () => app.session?.run ?? null,
    state: () => app.session?.state ?? null,
    physics: sources.physics,
    quality: sources.qualityRung,
    draws: () => ({ current: app.renderer.drawCalls, peak: sources.peakDrawCalls() }),
    chargers: () => ({
      current: app.renderer.chargerBodies,
      peak: sources.peakChargerBodies(),
    }),
    shaders: () => app.renderer.shaderStats,
    player: () => app.academy.player,
    meta: () => ({
      streak: app.academy.streakView(),
      missions: app.academy.missionsView(),
      kills: app.academy.player.kills,
      owned: app.academy.player.cosmetics.owned,
      payout: app.runPayout,
    }),
    setPlayer: (patch: unknown) => {
      app.academy.setPlayer(patch);
      sources.repaintMenu();
    },
    openRoom: (room: RoomId) => {
      sources.openRoom(room);
    },
    startEndless: (seed?: number) => {
      app.startEndless(seed ?? null);
    },
    steer: (x: number) => {
      // Only while a run is actually on the road. Taking the wheel drops the
      // session's bot for good, so on the title screen, in the Academy or on
      // the result sheet — where there is nothing to steer — this has to do
      // nothing at all rather than quietly un-bot the run behind the panel.
      if (app.status() !== 'playing') return;
      const session = app.session;
      if (session === null || session.finished) return;
      session.takeWheel(x);
    },
    setTurbo: (value: number) => {
      app.setTurbo(value);
    },
  };
  globalThis.__arcane = handle;
  return handle;
}
