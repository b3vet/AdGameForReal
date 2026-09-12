/**
 * One scripted run of the smoke: the shot plan, the page-side watcher that
 * stops the frame loop on the frame a shot asks for, and the assertions a run
 * carries with it (draw-call budget, shader warm-up, result screen).
 *
 * Split out of `scripts/smoke.mjs` in Milestone 3 Phase D, so that file is the
 * *plan* — which runs are played and which frames come out of them — and this
 * one is how one of them is driven. Nothing here knows which runs exist.
 */

import { stat } from 'node:fs/promises';
import path from 'node:path';

import { SCREENSHOT_TIMEOUT_MS, assertNotBlank, sleep } from './smoke-browser.mjs';

/** What a shot is waiting for, for the failure message. */
function describeShot(frame) {
  if (frame.at === 'z') return `${String(frame.value)} m of road`;
  if (frame.at === 'boss') return 'the boss fight';
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
const SHOT_TIMEOUT_MS = Number(process.env.SMOKE_SHOT_TIMEOUT_MS ?? 120_000);

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
 * Draw-call ceiling for a live run, physics and all (plan, "Performance": 40 at
 * 500 units for the render layer alone). Debris is what pushes past that — a
 * ragdoll is a skinned mesh and therefore a call of its own — and the caps in
 * `src/physics/tuning.ts` are what hold this line.
 */
const DRAW_CALL_LIMIT = Number(process.env.SMOKE_DRAW_CALLS ?? 52);

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
async function armShotPlan(page, shots, bossShare, staffRange) {
  await page.evaluate(
    ({ plan, share, range }) => {
      globalThis.__smokePlan = plan;
      globalThis.__smokeStep = 0;
      globalThis.__smokeStopped = false;

      const holds = (step, state) => {
        if (step.at === 'z') return state.squad.z >= step.value;
        if (step.at === 'boss') {
          const boss = state.boss;
          // Under way and still standing: bar and HP label are both up.
          return boss !== null && boss.active && boss.alive && boss.hp <= boss.maxHp * share;
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
        if (!holds(step, state)) return;
        globalThis.__arcane?.app.stop();
        globalThis.__smokeStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, share: bossShare, range: staffRange },
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

/** Plays one scripted run to its result screen, writing every shot it asks for. */
export async function driveRun(page, url, run, failures, outDir) {
  const shot = async (name) => {
    const file = path.join(outDir, name);
    await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
    const { size } = await stat(file);
    console.log(`[smoke] screenshot ${name}`);
    return `${name} (${(size / 1024).toFixed(0)} KB)`;
  };

  console.log(`[smoke] ${run.label}: ${run.query}`);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, { timeout: 30_000 });

  const written = [];

  // Nothing is timed or photographed until every material is compiled: the
  // point of the warm-up is that a run contains no compilation, and a run
  // started before it finished would contain all of it.
  const warm = await waitForWarmUp(page);
  const before = await page.evaluate(() => globalThis.__arcane?.shaders() ?? null);
  if (!warm) {
    failures.push(`${run.label}: the shader warm-up never finished`);
  } else {
    console.log(
      `[smoke]   warm-up: ${before.warmed} materials compiled, ${before.skipped} with ` +
        `nothing to compile, ${before.failed} still unready, ` +
        `${before.programs} shader programs before the first frame`,
    );
  }

  // The title screen is part of the definition of done, so it gets a frame of
  // its own before anything is clicked.
  await sleep(300);
  if (run.titleShot !== undefined) written.push(await shot(run.titleShot));

  await armShotPlan(page, run.shots, BOSS_SHOT_HP_SHARE, STAFF_SHOT_RANGE);
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

  await waitForRunEnd(page);

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
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const draws = await page.evaluate(
    () => globalThis.__arcane?.draws() ?? { current: 0, peak: 0 },
  );
  const quality = await page.evaluate(() => ({
    rung: globalThis.__arcane?.quality() ?? -1,
    physics: globalThis.__arcane?.physics()?.stats.quality ?? -1,
  }));
  // A whole level of play — every gate kind, every staff, ragdolls, shards, the
  // boss and its stomp — must not have compiled a single new shader. One that
  // did is a frame the phone spent inside the driver rather than drawing.
  const after = await page.evaluate(() => globalThis.__arcane?.shaders() ?? null);
  const grew = after !== null && before !== null ? after.programs - before.programs : 0;
  console.log(
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

  console.log(`[smoke] ${run.label}: ${status} after ${seconds}s of wall clock, phase ${phase}`);
  console.log(
    `[smoke]   draw calls: peak ${draws.peak} (limit ${DRAW_CALL_LIMIT}), ` +
      `ladder rung ${quality.rung}, physics quality ${quality.physics}`,
  );
  if (phase !== 'result') failures.push(`${run.label}: run ended but the result screen never showed`);
  if (draws.peak > DRAW_CALL_LIMIT) {
    failures.push(
      `${run.label}: peak ${draws.peak} draw calls is over the ${DRAW_CALL_LIMIT} budget`,
    );
  }

  written.push(await shot(run.endShot));

  if (run.assertNotBlank !== undefined) {
    await assertNotBlank(path.join(outDir, run.assertNotBlank), run.assertNotBlank);
  }

  return written;
}
