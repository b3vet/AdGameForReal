/**
 * Filling in `window.__arcane`, and the device report behind it.
 *
 * `./handle.ts` is the *contract* — the shape three things outside the app read
 * — and this is the one function that satisfies it. Split out of `App` in
 * Milestone 8 for the file-size rule (CLAUDE.md), on the seam the file already
 * had: everything here is a closure over the app and nothing here is part of
 * the state machine.
 *
 * Milestone 9 gave the report the same treatment. It reads exactly what the
 * handle reads — the ladder's rung, the renderer's ratios, the physics layer,
 * the purse — off the same thunks, and it is installed on the debug panel here
 * so there is one place that knows where every diagnostic number comes from.
 *
 * Nothing else may write `globalThis.__arcane`.
 */

import { platformName } from '@/device/platform';

import type { App } from './App';
import type { ArcaneDebugHandle } from './handle';
import type { PhysicsLayer } from '@/physics';
import type { RoomId } from './player';
import { collectReport } from './report';
import type { ReportDeps, ReportSave } from './report';

/**
 * What the handle needs that is not on `App`'s public surface: the physics
 * layer (loaded late and owned privately), the ladder's rung and the frame
 * driver's peaks. Passed in as thunks so the handle reads them live rather
 * than freezing whatever was true at boot.
 */
export interface HandleSources {
  physics: () => PhysicsLayer | null;
  qualityRung: () => number;
  /** Why the rung is where it is and what it renders at: `p95 2x` (D27). */
  qualityReason: () => string;
  peakDrawCalls: () => number;
  peakChargerBodies: () => number;
  /** A debug injection may have changed what the menu on screen should say. */
  repaintMenu: () => void;
  /** Opens an Academy room, for a probe that wants to photograph one. */
  openRoom: (room: RoomId) => void;
}

/**
 * Builds the handle and publishes it, and hands the debug panel the report
 * source. Called once per app, by `App.start`.
 */
export function publishHandle(app: App, sources: HandleSources): ArcaneDebugHandle {
  const report = reportDeps(app, sources);
  // The panel owns the two things only it can see — the last capture and the
  // last run state — so it calls back in with them (`src/ui/debug.ts`).
  app.overlay.setReportSource((capture, state) => collectReport(report, capture, state));

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
    report: () => app.overlay.report(),
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
    endRun: () => {
      // Only a run that is actually on the road, for the reason `steer` above
      // is guarded: on the title screen or on a result sheet there is nothing
      // to end, and a finished run must not be finished twice.
      if (app.status() !== 'playing') return;
      const session = app.session;
      if (session === null || session.finished) return;
      session.run.abandon();
    },
    setTurbo: (value: number) => {
      app.setTurbo(value);
    },
  };
  globalThis.__arcane = handle;
  return handle;
}

/**
 * Where every number in the device report comes from.
 *
 * Thunks, so the report is whatever is true at the moment the button is
 * pressed: the renderer's ratios move with the ladder, the purse moves with a
 * purchase, and a report built at boot would describe a game nobody played.
 */
function reportDeps(app: App, sources: HandleSources): ReportDeps {
  return {
    platform: () => platformName(),
    gl: () => {
      try {
        // `Renderer.scene` throws before `init`, which is only reachable here
        // if something asks for a report during boot. A dash, not a crash.
        return app.renderer.scene.getEngine();
      } catch {
        return null;
      }
    },
    quality: () => ({
      rung: sources.qualityRung(),
      reason: sources.qualityReason(),
      pixelRatio: app.renderer.pixelRatio,
      devicePixelRatio: app.renderer.devicePixelRatio,
      // The layer's own number rather than the rung's: `?physics=0` skips Havok
      // entirely and the ladder never knows.
      physics: sources.physics()?.stats.quality ?? 0,
    }),
    save: () => saveHeadline(app),
  };
}

/** The five save numbers the report prints; nothing that identifies anybody. */
function saveHeadline(app: App): ReportSave {
  const player = app.academy.player;
  const missions = app.academy.missionsView();
  let done = 0;
  for (const mission of missions) if (mission.done) done++;
  return {
    bestLevel: player.unlockedLevel,
    coins: player.coins,
    streakDays: player.streak.days,
    missionsDone: done,
    missionsTotal: missions.length,
    // What the bestiary's kill ladders have handed over (D53): the tints owned,
    // which is the one count that says how far the meta layer has got.
    tiers: player.cosmetics.owned.length,
  };
}
