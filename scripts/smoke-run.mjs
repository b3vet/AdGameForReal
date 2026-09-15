/**
 * One scripted run of the smoke: boot a page, put a save in it, photograph the
 * Academy and the road, and hand the run to its checks.
 *
 * Split out of `scripts/smoke.mjs` in Milestone 3 Phase D, so that file is the
 * *plan* — which runs are played and which frames come out of them — and this
 * one is how one of them is driven. Nothing here knows which runs exist. Two
 * files sit behind it since the Milestone 7 review: `./smoke-run-plan.mjs` is
 * what a frame is of and the watcher that stops the loop on it, and
 * `./smoke-run-checks.mjs` is what the run owes when it is over.
 */

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { SCREENSHOT_TIMEOUT_MS, assertNotBlank, sleep } from './smoke-browser.mjs';
import {
  checkAgainStaysEndless,
  checkNoSideScroll,
  checkRun,
  checkWarmUp,
} from './smoke-run-checks.mjs';
import {
  BOSS_SHOT_HP_SHARE,
  PACE,
  PACED_TAIL_TURBO,
  STAFF_SHOT_RANGE,
  armShotPlan,
  takeShots,
} from './smoke-run-plan.mjs';

/**
 * How long the Academy's own screens are given to paint before they are
 * photographed. They are HTML over a scene that is already drawn, so this is a
 * layout pass and a one-shot animation, not a frame budget.
 */
const MENU_SETTLE_MS = 700;

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

/**
 * Ends the run once it is `spans` biome boundaries in, plus a margin.
 *
 * A page-side watcher rather than a `waitForFunction` and a call back in, for
 * the reason the shot plan's is one (`./smoke-run-plan.mjs`): a round trip to
 * Node costs a frame or three, and a turbo frame is three seconds of sim.
 *
 * Two conditions, not one. The squad being past the line is what the run is
 * measured in, and `__smokeBiomes` having grown to `spans + 1` entries is the
 * renderer having actually repainted at each of them — which is what the run
 * asserts afterwards. Stopping on the metres alone could end a run one frame
 * before the crossing it exists to prove.
 *
 * The span itself is read off the session's own level rather than off
 * `endless.json`, so the driver cannot disagree with the road it is walking.
 */
function stopAfterSpans(page, endAfter) {
  return page.evaluate(({ spans, margin }) => {
    const tick = () => {
      const state = globalThis.__arcane?.state();
      // No run yet: keep watching. A run that has already ended on its own is
      // nothing to stop, so the watcher is done.
      if (state === null || state === undefined) {
        globalThis.requestAnimationFrame(tick);
        return;
      }
      if (state.status !== 'running') return;
      const span = globalThis.__arcane?.app.session?.level.biomeSpan ?? 0;
      const painted = (globalThis.__smokeBiomes ?? []).length;
      if (span > 0 && state.squad.z >= span * spans + margin && painted > spans) {
        globalThis.__arcane?.endRun();
        return;
      }
      globalThis.requestAnimationFrame(tick);
    };
    globalThis.requestAnimationFrame(tick);
  }, endAfter);
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
  // Playwright's navigation default is 30 s, and a cold boot behind another
  // page compiling shaders through SwiftShader is longer than that — which is
  // the one thing that stopped `SMOKE_RUN_CONCURRENCY=2` working when Milestone
  // 5 measured it (`scripts/smoke.mjs`). The hero pages already raise it.
  page.setDefaultNavigationTimeout(READY_TIMEOUT_MS);
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, {
    timeout: READY_TIMEOUT_MS,
  });

  const written = [];
  const before = await checkWarmUp(page, run, failures, say);

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
  //
  // `room` opens it through the debug handle rather than by clicking its card
  // (`ArcaneDebugHandle.openRoom`), which is what the Wardrobe and the Bestiary
  // use: a probe that had to find and click the right card would be a
  // screenshot test of the home screen's layout.
  for (const menu of run.menuShots ?? []) {
    if (menu.room !== undefined) {
      await page.evaluate((room) => {
        globalThis.__arcane?.openRoom(room);
      }, menu.room);
    } else {
      await page.click(menu.open);
    }
    await sleep(MENU_SETTLE_MS);
    written.push(await shot(menu.name));
    // A room whose ladders or prices are wider than the phone is a room the
    // player has to scroll sideways to read (plan, definition of done 5).
    if (menu.noScroll === true) await checkNoSideScroll(page, run, menu.name, failures, say);
    await page.click(menu.back ?? '#room-back');
    await sleep(300);
  }

  await armShotPlan(page, run.shots, BOSS_SHOT_HP_SHARE, STAFF_SHOT_RANGE, PACE);
  if (run.autoStart === true) {
    // `?endless=1` put the run on the road itself, as soon as Havok landed
    // (`App.start`), so there is no picker to walk through — and nothing to
    // wait for either, because `checkWarmUp` above already waited for the layer
    // whose arrival starts it.
    await page.waitForFunction(() => globalThis.__arcane?.app.status() === 'playing', null, {
      timeout: READY_TIMEOUT_MS,
    });
  } else {
    // Play is a card on the home now (D33); it opens the level picker, and the
    // picker is where the run starts.
    await page.click('#academy-play');
    await sleep(300);
    await page.click('#play-button');
  }
  const startedAt = Date.now();

  await takeShots(page, run, shot, written, failures);

  // The paced steps left the sim crawling (`PACE`); nothing is being
  // photographed now, so the rest of the run goes back to the query's own speed.
  await page.evaluate((turbo) => {
    globalThis.__arcane?.setTurbo(turbo);
  }, PACED_TAIL_TURBO);

  // A run may say where it has seen enough (`endAfter` in `./smoke-runs.mjs`):
  // the endless road is 2898 m and its frames are all in the first two spans.
  if (run.endAfter !== undefined) await stopAfterSpans(page, run.endAfter);

  await checkRun(page, run, failures, say, before, startedAt);

  written.push(await shot(run.endShot));

  // Again on an endless sheet walks the endless road again rather than whatever
  // level the picker was pointed at (D52). Last, because it starts a new run.
  if (run.againStaysEndless === true) await checkAgainStaysEndless(page, run, failures, say);

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
