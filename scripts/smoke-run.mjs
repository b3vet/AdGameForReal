/**
 * One scripted run of the smoke: the shot plan, the page-side watcher that
 * stops the frame loop on the frame a shot asks for, and the assertions a run
 * carries with it (draw-call budget, shader warm-up, result screen).
 *
 * Split out of `scripts/smoke.mjs` in Milestone 3 Phase D, so that file is the
 * *plan* — which runs are played and which frames come out of them — and this
 * one is how one of them is driven. Nothing here knows which runs exist.
 */

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { SCREENSHOT_TIMEOUT_MS, assertNotBlank, sleep } from './smoke-browser.mjs';

/** What a shot is waiting for, for the failure message. */
function describeShot(frame) {
  if (frame.at === 'z') return `${String(frame.value)} m of road`;
  if (frame.at === 'boss') return 'the boss fight';
  if (frame.at === 'shield') return 'a shielded brute with its shield up';
  if (frame.at === 'shieldBroken') return 'a shielded brute with its shield broken';
  if (frame.at === 'charge') return 'a charger running its lane';
  if (frame.at === 'bossCharge') return "the Rime Fiend's charge";
  return 'a staff gate';
}

/**
 * How close a staff gate has to be before its frame is taken, in metres. Wider
 * than a turbo frame's fifteen metres of road, or the squad steps over the
 * window between two frames and the gate is never photographed; not much wider,
 * or the panel is a smudge in the fog and its staff prop is three pixels.
 */
const STAFF_SHOT_RANGE = 18;

/**
 * The boss frame is taken on the first frame where the boss is down to this
 * share of its health — half way through the fight, so the demon has walked
 * into the squad and has a stomp on the ground, with the bar and its HP label
 * both up. A turbo frame is about a seventh of the fight, so there is no risk
 * of stepping from above this straight to a dead boss.
 *
 * Milestone 2's boss.png was a picture of a *dead* boss: the shot was a fixed
 * delay after `boss.active`, and at turbo 60 one frame is three seconds of sim,
 * so the whole fight could pass inside it. Then the HUD's boss bar is hidden
 * (the bar follows `boss.alive`) and the world HP label is gone with the body,
 * which read as two missing-UI bugs and was one timing bug.
 */
const BOSS_SHOT_HP_SHARE = 0.5;
/** Ceiling on one shot's wait, so a run that never gets there still ends. */
const SHOT_TIMEOUT_MS = Number(process.env.SMOKE_SHOT_TIMEOUT_MS ?? 180_000);

/**
 * The Frostfell shots and the sim clock they need (D49).
 *
 * The other steps here are keyed to a *place* — a metre mark, a gate row, a
 * share of the boss's health — and a place cannot be stepped over: the squad
 * walks past it and the condition stays true. The three Frostfell ones are
 * keyed to a *moment*, and every one of them is short. Measured on the sim for
 * level 23 seed 1 with the campaign's kit: the shielded brute at z 215 keeps
 * its shield for a tenth of a second once it is inside the squad's range (five
 * hundred armed mages break it on contact with the range), the block then lives
 * 1.3 s broken, the charger at z 342 runs for 0.9 s, and the Rime Fiend's first
 * charge comes 8 s into the fight.
 *
 * At turbo 60 one frame is three seconds of sim, so none of those windows
 * exists between two frames. So this run *paces* itself: each step names how
 * fast the sim may run as its moment comes into reach, the way the hero set
 * already does for a gate row (`./smoke-hero.mjs`). Nothing a run asserts is a
 * wall-clock measurement — every one is a count — so slowing the sim down
 * cannot change an answer, it only costs frames.
 *
 * The shield's own frame is therefore taken *before* the squad is in range: 26
 * to 42 m out, where the block is small but its shield glyph and count are
 * still inside `LABEL_RANGE`. Nearer than that there is no such frame to take.
 */
const PACE = {
  /**
   * What the sim runs at when the step's subject is out of reach — the query's
   * own turbo, handed straight back.
   *
   * A step that only ever *slows* the clock is a run that never speeds up
   * again: the first attempt at this took the shield frames and then crawled
   * the hundred and fifty metres to the charger at turbo 3, which is a hundred
   * frames of a five-hundred-mage crowd and ran a two-minute shot timeout out.
   * Pacing is a window around a moment, not a speed limit for the rest of the
   * level.
   */
  cruise: 60,
  /** Metres at which a step starts slowing the sim, and the turbo it takes. */
  far: { gap: 90, turbo: 6 },
  near: { gap: 50, turbo: 3 },
  /**
   * A body about to move: the charger's trigger is at 22 m (D49), so the clock
   * only has to be low for the last few metres before it. Measured once at
   * `{34, 2}` and it cost thirteen frames of a five-hundred-mage crowd getting
   * to the trigger — which is a minute of wall clock on this rasteriser and ran
   * the shot's own timeout out. `{26, 4}` is two frames to the trigger and
   * still four or five frames inside the 0.9 s the charge lasts.
   */
  charger: { gap: 60, turbo: 8 },
  chargerNear: { gap: 26, turbo: 4 },
  /**
   * And slower again once it is actually running, because the trail is what
   * the frame is of. The emitter sheds a puff every 0.055 s of *real* time
   * while the body crosses the road at sim speed, so a charge photographed at
   * turbo 4 leaves marks five metres apart — a dotted line rather than the
   * track the game draws at turbo 1.
   */
  charging: 2,
  /** The fight: 8 s of sim between charges, and a run in of about 1.5 s —
   *  twenty frames of waiting and four inside the window at this speed. */
  boss: 8,
  /**
   * Where each body is photographed, in metres of road ahead of the squad.
   *
   * All three are as near as the moment allows, because near is what a frame
   * is read on: 34 m is the last step before the squad's fire reaches the
   * shielded brute and breaks it, 28 m is three metres after the break (the
   * block then lives about twelve more), and a charger is inside 30 m from the
   * step it commits — its trigger is at 22.
   */
  shieldShot: { from: 26, to: 34 },
  brokenShot: { from: 5, to: 26 },
  chargeShot: { from: 3, to: 17 },
};

/**
 * How long to wait for a run to reach a terminal status. A greedy level-10 run
 * is about 75 s of sim time; at turbo 20 and the frame rate a 400-mage crowd
 * gets out of SwiftShader that is a little over a minute of wall clock, and
 * this leaves room for a slow machine without blowing the smoke's budget.
 */
const RUN_END_TIMEOUT_MS = Number(process.env.SMOKE_RUN_TIMEOUT_MS ?? 180_000);

/**
 * How long to wait for the result screen after the run reaches a terminal
 * status. The app holds it back ~0.8 s of *frame* time, which is several times
 * that in wall-clock time on a SwiftShader machine.
 */
const RESULT_SETTLE_MS = 20_000;

/**
 * The result sheet rolls its numbers and then its coins (`src/ui/result.ts`),
 * about 1.3 s of wall clock in all. The peak is waited on properly below; this
 * is the tail the coin roll adds, so `result-coins.png` is a picture of the
 * total and not of a counter halfway up.
 */
const COINS_SETTLE_MS = 1200;

/**
 * How long the Academy's own screens are given to paint before they are
 * photographed. They are HTML over a scene that is already drawn, so this is a
 * layout pass and a one-shot animation, not a frame budget.
 */
const MENU_SETTLE_MS = 700;

/**
 * Draw-call ceiling for a live run, physics and all (plan, "Performance": 40 at
 * 500 units for the render layer alone). Debris is what pushes past that — a
 * ragdoll is a skinned mesh and therefore a call of its own — and the caps in
 * `src/physics/tuning.ts` are what hold this line.
 */
const DRAW_CALL_LIMIT = Number(process.env.SMOKE_DRAW_CALLS ?? 52);

/** What the sim is handed back once the last paced shot has been taken. */
const PACED_TAIL_TURBO = 60;

/**
 * How long to wait for the shader warm-up to finish before a run is driven.
 *
 * The renderer compiles every pooled material at boot and again when the
 * physics layer's debris pools arrive (`src/render/warmup.ts`), and the second
 * pass waits on two megabytes of Havok. Nothing may be photographed or
 * measured until both are done, or the first frames of the run are exactly the
 * compilation stalls the pass exists to remove.
 */
const WARM_UP_TIMEOUT_MS = 90_000;

/**
 * How long a page is given to report `__arcane.ready`.
 *
 * Ninety seconds, not thirty. Booting is the most expensive thing a page does —
 * the glyph atlas, seven model loads and thirty-six shader programs through
 * SwiftShader — and the smoke can be told to drive two runs at once
 * (`smoke.mjs`, `RUN_CONCURRENCY`), where a page boots while another is mid-run
 * on the same four cores and thirty seconds is not enough. Nothing is weakened:
 * a page that never boots still fails the smoke, it just takes longer to say so.
 */
const READY_TIMEOUT_MS = 90_000;

/** Waits until the warm-up has run and the physics layer is attached. */
function waitForWarmUp(page) {
  return page
    .waitForFunction(
      () => {
        const shaders = globalThis.__arcane?.shaders();
        return (
          shaders !== undefined &&
          shaders.warming === false &&
          shaders.warmed > 0 &&
          globalThis.__arcane?.physics() !== null
        );
      },
      null,
      { timeout: WARM_UP_TIMEOUT_MS },
    )
    .then(() => true)
    .catch(() => false);
}

/** Resolves when the run reaches `won` or `lost`. */
function waitForRunEnd(page) {
  return page.waitForFunction(
    () => {
      const status = globalThis.__arcane?.state()?.status;
      return typeof status === 'string' && status !== 'running';
    },
    null,
    { timeout: RUN_END_TIMEOUT_MS },
  );
}

/**
 * Installs a page-side watcher that walks the run's shot list.
 *
 * Every frame it asks whether the current step's moment has arrived, and the
 * first frame that says yes stops the app's loop *from inside the page*. That
 * is the whole trick: a `waitForFunction` round trip back to Node costs a frame
 * or three, and a turbo frame is three seconds of sim — long enough for the
 * boss to die or the gate to end up behind the squad. With the loop stopped
 * nothing moves while the picture is taken, so the frame photographed is the
 * frame that qualified, on any machine.
 */
async function armShotPlan(page, shots, bossShare, staffRange, pace) {
  await page.evaluate(
    ({ plan, share, range, pace: clock }) => {
      globalThis.__smokePlan = plan;
      globalThis.__smokeStep = 0;
      globalThis.__smokeStopped = false;
      // Sim time of the last shot. The watcher runs on its own frame callback,
      // so after a shot is released it can qualify the *next* step before the
      // app's loop has drawn anything — and two shots then photograph one
      // frame. Level 10's staff gate and its 120 m mark did exactly that once
      // the row generation moved (`staff-l10.png` and `t12-l10.png` came out
      // byte for byte alike). A shot may not be taken until the sim has moved.
      globalThis.__smokeAt = -1;

      /** The nearest live enemy ahead that `pick` accepts, as metres of road. */
      const nearest = (state, pick) => {
        let best = null;
        for (const enemy of state.enemies) {
          if (!enemy.alive || !pick(enemy)) continue;
          const gap = enemy.z - state.squad.z;
          if (gap <= 0) continue;
          if (best === null || gap < best) best = gap;
        }
        return best;
      };

      const isShielded = (enemy) => enemy.kind === 'shieldBrute';
      const shieldUp = (enemy) => isShielded(enemy) && (enemy.shield ?? 0) > 0;
      const shieldGone = (enemy) => isShielded(enemy) && (enemy.shield ?? 0) <= 0;
      const isCharger = (enemy) => enemy.kind === 'charger';

      /**
       * How fast the sim may run this frame, for a step whose moment is short.
       * Called before `holds`, every frame, so the clock is already down by the
       * time the window opens.
       */
      /** Sim speed for a body `gap` metres ahead, by this step's own ladder. */
      const paceFor = (gap, near, far) => {
        if (gap === null || gap >= far.gap) return clock.cruise;
        return gap < near.gap ? near.turbo : far.turbo;
      };

      const setPace = (step, state) => {
        if (step.at === 'shield' || step.at === 'shieldBroken') {
          // Any shielded brute, broken or not: the two steps are the same body
          // a second apart, and letting the clock back up between them is what
          // would step over the break.
          const gap = nearest(state, isShielded);
          globalThis.__arcane?.setTurbo(paceFor(gap, clock.near, clock.far));
          return;
        }
        if (step.at === 'charge') {
          if (nearest(state, (enemy) => isCharger(enemy) && enemy.charge !== undefined) !== null) {
            globalThis.__arcane?.setTurbo(clock.charging);
            return;
          }
          const gap = nearest(state, isCharger);
          globalThis.__arcane?.setTurbo(paceFor(gap, clock.chargerNear, clock.charger));
          return;
        }
        if (step.at === 'bossCharge') {
          globalThis.__arcane?.setTurbo(state.boss?.active === true ? clock.boss : clock.cruise);
        }
      };

      const holds = (step, state) => {
        if (step.at === 'z') return state.squad.z >= step.value;
        if (step.at === 'boss') {
          const boss = state.boss;
          // Under way and still standing: bar and HP label are both up.
          return boss !== null && boss.active && boss.alive && boss.hp <= boss.maxHp * share;
        }
        if (step.at === 'shield') {
          const gap = nearest(state, shieldUp);
          return gap !== null && gap >= clock.shieldShot.from && gap <= clock.shieldShot.to;
        }
        if (step.at === 'shieldBroken') {
          const gap = nearest(state, shieldGone);
          return gap !== null && gap >= clock.brokenShot.from && gap <= clock.brokenShot.to;
        }
        if (step.at === 'charge') {
          const gap = nearest(state, (enemy) => isCharger(enemy) && enemy.charge !== undefined);
          return gap !== null && gap >= clock.chargeShot.from && gap <= clock.chargeShot.to;
        }
        if (step.at === 'bossCharge') {
          // Still running *in*: past `until` the Fiend is walking home, which is
          // the same charge to the sim and a different picture — the column bows
          // under the run in, not under the walk back (D49).
          const boss = state.boss;
          return (
            boss !== null &&
            boss.alive &&
            boss.charge !== undefined &&
            state.time <= boss.charge.until
          );
        }
        return state.gates.some(
          (gate) =>
            gate.kind === 'weapon' &&
            !gate.passed &&
            gate.z - state.squad.z > 0 &&
            gate.z - state.squad.z < range,
        );
      };

      const tick = () => {
        globalThis.requestAnimationFrame(tick);
        if (globalThis.__smokeStopped) return;
        const step = globalThis.__smokePlan[globalThis.__smokeStep];
        const state = globalThis.__arcane?.state();
        if (step === undefined || !state) return;
        if (state.time === globalThis.__smokeAt) return;
        setPace(step, state);
        if (!holds(step, state)) return;
        globalThis.__smokeAt = state.time;
        globalThis.__arcane?.app.stop();
        globalThis.__smokeStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, share: bossShare, range: staffRange, pace },
  );
}

/** Waits for the watcher to stop on the current step. False on a timeout. */
function waitForStop(page, timeout) {
  return page
    .waitForFunction(() => globalThis.__smokeStopped === true, null, { timeout })
    .then(() => true)
    .catch(() => false);
}

/** Releases the loop and moves the watcher on to the next step. */
function releaseStop(page) {
  return page.evaluate(() => {
    globalThis.__smokeStep = (globalThis.__smokeStep ?? 0) + 1;
    globalThis.__smokeStopped = false;
    globalThis.__arcane?.app.resume();
  });
}

/**
 * Plays one scripted run to its result screen, writing every shot it asks for.
 *
 * Every line this prints is buffered and flushed in one block at the end rather
 * than written as it happens, so that `RUN_CONCURRENCY` above 1 (`smoke.mjs`)
 * cannot interleave two runs' readouts into one unreadable column. Nothing here
 * is timing-sensitive, so a run's own numbers are as true at the end of it as
 * they were in the middle.
 */
export async function driveRun(page, url, run, failures, outDir) {
  const lines = [];
  const say = (line) => lines.push(line);
  try {
    return await playRun(page, url, run, failures, outDir, say);
  } finally {
    // In a `finally`, so a run that throws — a blank frame — still says what it
    // had got through before it did.
    console.log(lines.join('\n'));
  }
}

async function playRun(page, url, run, failures, outDir, say) {
  const shot = async (name) => {
    const file = path.join(outDir, name);
    await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
    const { size } = await stat(file);
    say(`[smoke] screenshot ${name}`);
    return `${name} (${(size / 1024).toFixed(0)} KB)`;
  };

  say(`[smoke] ${run.label}: ${run.query}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, {
    timeout: READY_TIMEOUT_MS,
  });

  const written = [];

  // Nothing is timed or photographed until every material is compiled: the
  // point of the warm-up is that a run contains no compilation, and a run
  // started before it finished would contain all of it.
  const warm = await waitForWarmUp(page);
  const before = await page.evaluate(() => globalThis.__arcane?.shaders() ?? null);
  if (!warm) {
    failures.push(`${run.label}: the shader warm-up never finished`);
  } else {
    say(
      `[smoke]   warm-up: ${before.warmed} materials compiled, ${before.skipped} with ` +
        `nothing to compile, ${before.failed} still unready, ` +
        `${before.programs} shader programs before the first frame`,
    );
  }

  // A run may bring a save with it: coins, upgrades, a staff and a wisp
  // written straight into the player through the debug handle, so the Academy
  // can be photographed with something in it rather than empty
  // (`ArcaneDebugHandle.setPlayer`). Before the first shot, because the home
  // screen it re-paints is the first thing photographed.
  if (run.save !== undefined) {
    await page.evaluate((patch) => {
      globalThis.__arcane?.setPlayer(patch);
    }, run.save);
    await sleep(MENU_SETTLE_MS);
  }

  // The Academy home is part of the definition of done, so it gets a frame of
  // its own before anything is clicked.
  await sleep(300);
  if (run.titleShot !== undefined) written.push(await shot(run.titleShot));

  // Rooms: open one, photograph it, come back. The home is up again after each.
  for (const menu of run.menuShots ?? []) {
    await page.click(menu.open);
    await sleep(MENU_SETTLE_MS);
    written.push(await shot(menu.name));
    await page.click(menu.back ?? '#room-back');
    await sleep(300);
  }

  await armShotPlan(page, run.shots, BOSS_SHOT_HP_SHARE, STAFF_SHOT_RANGE, PACE);
  // Play is a card on the home now (D33); it opens the level picker, and the
  // picker is where the run starts.
  await page.click('#academy-play');
  await sleep(300);
  await page.click('#play-button');
  const startedAt = Date.now();

  for (const frame of run.shots) {
    const reached = await waitForStop(page, SHOT_TIMEOUT_MS);
    if (!reached) {
      failures.push(`${run.label}: ${frame.name} — the run never reached ${describeShot(frame)}`);
      break;
    }
    try {
      written.push(await shot(frame.name));
    } finally {
      await releaseStop(page);
    }
  }

  // The paced steps left the sim crawling (`PACE`); nothing is being
  // photographed now, so the rest of the run goes back to the query's own speed.
  await page.evaluate((turbo) => {
    globalThis.__arcane?.setTurbo(turbo);
  }, PACED_TAIL_TURBO);

  // Reported, not thrown. A run that never reaches a terminal status used to
  // take the whole smoke down with it — including the stress scene and the hero
  // set, which have nothing to do with it — and a missed shot is exactly the
  // case where that happens, because the frames are the reason the run exists.
  const ended = await waitForRunEnd(page)
    .then(() => true)
    .catch(() => false);
  if (!ended) failures.push(`${run.label}: the run never reached a terminal status`);

  const status = await page.evaluate(() => globalThis.__arcane?.state()?.status ?? 'unknown');
  // The app holds the result screen back a beat so the last frames play out.
  await page
    .waitForFunction(() => globalThis.__arcane?.app.status() === 'result', null, {
      timeout: RESULT_SETTLE_MS,
    })
    .catch(() => {});
  const phase = await page.evaluate(() => globalThis.__arcane?.app.status() ?? 'unknown');
  // The result numbers roll up over 0.7 s of wall clock, which is one frame
  // here: without this the picture is of a count-up caught at "1".
  await page
    .waitForFunction(
      () => {
        const shown = globalThis.document.querySelector('#result-peak')?.textContent ?? '';
        const peak = globalThis.__arcane?.state()?.peakCount ?? 0;
        return Number(shown) === Math.round(peak);
      },
      null,
      { timeout: RESULT_SETTLE_MS },
    )
    .catch(() => {});
  // ...and the coins roll after them.
  await sleep(COINS_SETTLE_MS);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const draws = await page.evaluate(
    () => globalThis.__arcane?.draws() ?? { current: 0, peak: 0 },
  );
  const quality = await page.evaluate(() => ({
    rung: globalThis.__arcane?.quality() ?? -1,
    physics: globalThis.__arcane?.physics()?.stats.quality ?? -1,
    // Whether the layer built its mage pool and is taking one squad death in
    // ten (D43). It fails soft — a rig that will not build logs a warning and
    // the crowd keeps drawing every death itself — so without this the feature
    // could quietly not exist and every frame would still look right.
    units: globalThis.__arcane?.physics()?.throwsUnits ?? false,
  }));
  // A whole level of play — every gate kind, every staff, ragdolls, shards, the
  // boss and its stomp — must not have compiled a single new shader. One that
  // did is a frame the phone spent inside the driver rather than drawing.
  const after = await page.evaluate(() => globalThis.__arcane?.shaders() ?? null);
  const grew = after !== null && before !== null ? after.programs - before.programs : 0;
  say(
    `[smoke]   shader programs: ${before?.programs ?? -1} before, ` +
      `${after?.programs ?? -1} after (${grew} compiled during play)`,
  );
  if (grew > 0) {
    failures.push(
      `${run.label}: ${grew} shader(s) compiled during play; the warm-up missed them`,
    );
  }
  if (before !== null && before.failed > 0) {
    failures.push(
      `${run.label}: ${before.failed} material(s) never became ready during the warm-up`,
    );
  }

  say(`[smoke] ${run.label}: ${status} after ${seconds}s of wall clock, phase ${phase}`);
  say(
    `[smoke]   draw calls: peak ${draws.peak} (limit ${DRAW_CALL_LIMIT}), ` +
      `ladder rung ${quality.rung}, physics quality ${quality.physics}, ` +
      `squad ragdolls ${quality.units ? 'on' : 'off'}`,
  );
  // Frostfell only (D49): a level with charger rows has to have *drawn* one, or
  // its charger frame is a picture of an empty lane and nothing here would say
  // so. The peak rather than the current frame, because a charger is on the
  // road for a second of a ninety-second run (`ArcaneDebugHandle.chargers`).
  if (run.expectChargers === true) {
    const chargers = await page.evaluate(
      () => globalThis.__arcane?.chargers() ?? { current: 0, peak: 0 },
    );
    say(`[smoke]   chargers drawn: peak ${chargers.peak} in one frame`);
    if (chargers.peak <= 0) {
      failures.push(`${run.label}: no charger was ever drawn, so its frames have none in them`);
    }
  }
  if (quality.physics > 0 && !quality.units) {
    failures.push(
      `${run.label}: the physics layer is at quality ${quality.physics} but built no mage ` +
        'ragdoll pool, so every squad death fell back to a drawn corpse',
    );
  }
  if (phase !== 'result') failures.push(`${run.label}: run ended but the result screen never showed`);
  // The purse is the meta layer's whole point: a run that paid nothing at all
  // means `runRewards` or the save never ran (D33).
  const purse = await page.evaluate(() => globalThis.__arcane?.player().coins ?? -1);
  say(`[smoke]   coins after the run: ${purse}`);
  if (purse < 0) failures.push(`${run.label}: the debug handle has no player`);
  if (status === 'won' && purse <= 0) {
    failures.push(`${run.label}: a cleared level paid no coins`);
  }
  if (draws.peak > DRAW_CALL_LIMIT) {
    failures.push(
      `${run.label}: peak ${draws.peak} draw calls is over the ${DRAW_CALL_LIMIT} budget`,
    );
  }

  written.push(await shot(run.endShot));

  if (run.assertNotBlank !== undefined) {
    // Only if the frame was actually taken: a shot that was missed has already
    // pushed its own failure, and reading a file that is not there would throw
    // out of the whole smoke rather than report one more line.
    const file = path.join(outDir, run.assertNotBlank);
    if (existsSync(file)) say(await assertNotBlank(file, run.assertNotBlank));
    else failures.push(`${run.label}: ${run.assertNotBlank} was never taken`);
  }

  return written;
}
