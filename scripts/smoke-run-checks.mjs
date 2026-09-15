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
 * The beat after the coin roll has landed, so the frame taken next is of a
 * settled sheet rather than of the frame the last digit was written on. The
 * roll itself is waited for properly (`checkSheet`), not slept through.
 */
const COINS_SETTLE_MS = 200;

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
 *
 * Two minutes, the same as the hero pages' (`./smoke-hero-page.mjs`), and for
 * the same reason: with `SMOKE_RUN_CONCURRENCY` above 1 a page compiles
 * seventy-two materials through SwiftShader while another draws a five-hundred
 * mage frame on the same four cores. Nothing is weakened — a warm-up that never
 * finishes still fails the run, it just takes longer to say so.
 */
const WARM_UP_TIMEOUT_MS = 120_000;

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

/**
 * Resolves when the run reaches `won` or `lost`.
 *
 * `timeout` is the run's own where it names one: the endless road is four
 * hundred seconds of sim at its own pace (D52), where the default here is
 * sized for a campaign level a third as long.
 */
function waitForRunEnd(page, timeout) {
  return page.waitForFunction(
    () => {
      const status = globalThis.__arcane?.state()?.status;
      return typeof status === 'string' && status !== 'running';
    },
    null,
    { timeout },
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
  const ended = await waitForRunEnd(page, run.endTimeoutMs ?? RUN_END_TIMEOUT_MS)
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
  // ...and the coins roll after them, up to exactly what the run paid.
  await checkSheet(page, run, failures, say);
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
  if (run.endless === true) await checkEndless(page, run, failures, say);
}

/**
 * What the result sheet owes the payout that made it (D51 to D53).
 *
 * The identity is the whole point: the count-up rolls *everything the run
 * paid* — the road plus the streak, the missions and the bestiary rungs — and
 * the purse under it ends where the save ended. Milestone 8's wave one shipped
 * a sheet that rolled the road's coins alone while the purse climbed by the
 * total, so the two numbers on one screen disagreed by the bonus.
 *
 * Waited for rather than slept through: the roll is driven by
 * `requestAnimationFrame` on the wall clock, and on this rasteriser a frame of
 * a five-hundred-mage scene behind the sheet is most of a second.
 */
async function checkSheet(page, run, failures, say) {
  const rolled = await page
    .waitForFunction(
      () => {
        const payout = globalThis.__arcane?.meta().payout;
        if (payout === null || payout === undefined) return false;
        const want = Math.max(0, Math.round(payout.coins + payout.bonusCoins));
        const shown = globalThis.document.querySelector('#result-coins')?.textContent ?? '';
        return Number(shown) === want;
      },
      null,
      { timeout: RESULT_SETTLE_MS },
    )
    .then(() => true)
    .catch(() => false);

  const sheet = await page.evaluate((wanted) => {
    const text = (id) => globalThis.document.querySelector(id)?.textContent ?? '';
    const shown = (id) => {
      const element = globalThis.document.querySelector(id);
      return element !== null && !element.hidden;
    };
    return {
      payout: globalThis.__arcane?.meta().payout ?? null,
      coins: Number(text('#result-coins')),
      total: Number(text('#result-total')),
      metres: Number(text('#result-metres')),
      bestMetres: text('#result-best-metres'),
      best: text('#result-best'),
      purse: globalThis.__arcane?.player().coins ?? -1,
      // The bottom of the last button, against the bottom of the screen.
      wayOut:
        (globalThis.document.querySelector('#levels-button')?.getBoundingClientRect().bottom ??
          0) - globalThis.innerHeight,
      visible: (wanted.visible ?? []).map((id) => [id, shown(id)]),
      hidden: (wanted.hidden ?? []).map((id) => [id, shown(id)]),
    };
  }, run.sheet ?? {});

  const payout = sheet.payout;
  if (payout === null) {
    failures.push(`${run.label}: the run finished but paid no payout`);
    return;
  }
  const earned = Math.max(0, Math.round(payout.coins + payout.bonusCoins));
  say(
    `[smoke]   paid: ${payout.coins} from the road + ${payout.bonusCoins} bonus = ` +
      `${earned}, purse ${payout.totalCoins}`,
  );
  if (!rolled) {
    failures.push(
      `${run.label}: the sheet rolled to ${sheet.coins} coins, not the ${earned} the run paid`,
    );
  }
  if (sheet.total !== Math.round(payout.totalCoins)) {
    failures.push(
      `${run.label}: the sheet's purse reads ${sheet.total}, the payout says ${payout.totalCoins}`,
    );
  }
  if (sheet.purse !== payout.totalCoins) {
    failures.push(
      `${run.label}: the save's purse is ${sheet.purse}, the payout says ${payout.totalCoins}`,
    );
  }
  // `html` and `body` are `overflow: hidden` (`src/ui/styles.css`), so a button
  // past the bottom edge is not off screen, it is unreachable — and Academy is
  // the way to spend what the run has just paid. A full sheet overflowed by
  // about thirty pixels before Phase E gave the middle of it a scroll.
  if (sheet.wayOut > 1) {
    failures.push(
      `${run.label}: the Academy button is ${sheet.wayOut.toFixed(0)}px below the screen`,
    );
  }
  for (const [id, on] of sheet.visible) {
    if (!on) failures.push(`${run.label}: ${id} is not on the result sheet`);
  }
  for (const [id, on] of sheet.hidden) {
    if (on) failures.push(`${run.label}: ${id} is on the result sheet and should not be`);
  }

  if (run.endless !== true) return;
  // The endless sheet (D52): metres instead of a level, and a record to beat.
  if (sheet.metres !== Math.floor(payout.metres)) {
    failures.push(
      `${run.label}: the sheet reads ${sheet.metres} m, the run walked ${payout.metres}`,
    );
  }
  if (!payout.endlessBest || sheet.bestMetres === '') {
    failures.push(`${run.label}: the first endless walk did not read as a new best`);
  }
  say(`[smoke]   endless sheet: ${sheet.metres} m, "${sheet.bestMetres}"`);
}

/**
 * What an endless run owes beyond a campaign one (D52): a road that changed
 * biome under it, and the metres chip that stands in for the level chip.
 *
 * Both are read off the watcher rather than off the run's last frame: the
 * crossings are a sequence over the whole walk, and the HUD is gone behind the
 * result sheet by the time anything is checked.
 */
async function checkEndless(page, run, failures, say) {
  return page
    .evaluate(() => ({
      biomes: globalThis.__smokeBiomes ?? [],
      chip: globalThis.__smokeChip ?? { text: '', endless: '' },
      metres: globalThis.__arcane?.state()?.endless?.metres ?? 0,
      span: globalThis.__arcane?.app.session?.level.biomeSpan ?? 0,
    }))
    .then((endless) => {
      const crossings = Math.max(0, endless.biomes.length - 1);
      say(
        `[smoke]   endless: ${endless.metres.toFixed(0)} m of a ${endless.span.toFixed(0)} m ` +
          `span, biomes ${endless.biomes.join(' -> ')} (${crossings} crossings), ` +
          `chip "${endless.chip.text}"`,
      );
      if (crossings < 2) {
        failures.push(
          `${run.label}: the run crossed ${crossings} biome boundaries, not the two it owes`,
        );
      }
      // The chip as it read on the frame that was photographed: metres, not a
      // level number, and the flag the HUD switches on to say so.
      if (endless.chip.endless !== 'true' || !/^\d+ m$/.test(endless.chip.text)) {
        failures.push(
          `${run.label}: the HUD chip read "${endless.chip.text}" rather than metres walked`,
        );
      }
    });
}

/**
 * No horizontal page scroll on a room screen.
 *
 * A ladder or a price that is wider than the phone is one the player has to
 * drag sideways to read, and nothing else in the smoke would notice: the
 * screenshot is taken at the viewport's width and the overflow is simply off
 * the right-hand edge of it.
 */
export async function checkNoSideScroll(page, run, name, failures, say) {
  const over = await page.evaluate(() => {
    const root = globalThis.document.documentElement;
    const body = globalThis.document.body;
    return Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - root.clientWidth);
  });
  // One pixel of slack: a fractional layout width rounds up to a scroll width
  // one pixel wider than the client on a device pixel ratio of 1.
  if (over > 1) failures.push(`${run.label}: ${name} scrolls ${over}px sideways`);
  else say(`[smoke]   ${name}: no side scroll`);
}

/**
 * Again on an endless sheet walks the endless road again (D52).
 *
 * The button is mode-aware because the endless road has no level number: the
 * bug it guards against is Again walking whatever campaign level the picker
 * happened to be pointed at.
 */
export async function checkAgainStaysEndless(page, run, failures, say) {
  await page.click('#retry-button');
  const again = await page
    .waitForFunction(
      () =>
        globalThis.__arcane?.app.status() === 'playing' &&
        globalThis.__arcane.state()?.endless !== undefined,
      null,
      { timeout: RESULT_SETTLE_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (again) say('[smoke]   Again from the endless sheet walked the endless road again');
  else failures.push(`${run.label}: Again from the endless sheet did not start an endless run`);
}
