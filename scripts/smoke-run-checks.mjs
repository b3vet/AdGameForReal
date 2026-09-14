/**
 * What a run owes when it is over.
 *
 * Split out of `./smoke-run.mjs` in the Milestone 7 review. A run takes
 * pictures (`./smoke-run-plan.mjs`) and then it is *checked*, and the two have
 * little to say to each other: every line here is a count read off the debug
 * handle — draw calls, shader programs, the phase, the purse, the chargers that
 * were drawn — and none of them is a wall-clock measurement, which is what lets
 * two runs be driven at once (`smoke.mjs`, `RUN_CONCURRENCY`).
 */

import { sleep } from './smoke-browser.mjs';

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
 * The warm-up readout, taken before the first frame is drawn or measured.
 *
 * Nothing is timed or photographed until every material is compiled: the point
 * of the warm-up is that a run contains no compilation, and a run started
 * before it finished would contain all of it.
 */
export async function checkWarmUp(page, run, failures, say) {
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
  return before;
}

/**
 * Waits for the run to end and its result sheet to settle, then checks
 * everything the run owes. `before` is `checkWarmUp`'s readout.
 */
export async function checkRun(page, run, failures, say, before, startedAt) {
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
}
