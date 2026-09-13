/**
 * The hero set: the seven frames the milestone is judged on, at the pixel
 * ratios a phone actually renders at (Milestone 5 plan, definition of done 1).
 *
 * The rest of the smoke photographs a 390x844 frame at one device pixel per CSS
 * pixel, because what it is asserting is that the game ran — and at 2x the same
 * run takes half again as long for a picture that is only bigger
 * (`./smoke-browser.mjs`). The hero set is the opposite errand: these frames are
 * looked *at*, by the tech lead against the plan's checklist and by the product
 * owner, so they are taken at the backing-store resolution the iPhone renders
 * at (`?quality=0` pins rung 0, so the ladder cannot quietly drop the ratio
 * mid-run and hand back a soft frame).
 *
 * Two scales, driven at the same time in one browser. They are two pages on a
 * four-core machine and SwiftShader is CPU-bound, so running them side by side
 * costs about half again as much wall clock as one rather than twice — which is
 * what keeps the whole smoke inside its budget.
 *
 * ## Why this is its own run
 *
 * `./smoke-run.mjs` drives a level for the *assertions*: warm-up, draw calls,
 * the result screen, coins. This drives the same level for the *pictures*, and
 * the two want different things from the sim clock. A shot keyed to "a gate row
 * ten metres ahead" cannot be taken at turbo 60, where one frame is fifteen
 * metres of road: the row is thirty metres off on one frame and behind the
 * squad on the next. So the watcher here slows the sim down as the row it wants
 * comes into reach (`ArcaneDebugHandle.setTurbo`) and speeds it back up
 * afterwards, which costs a dozen frames and buys a frame taken where it was
 * asked for.
 */

import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { SCREENSHOT_TIMEOUT_MS, sleep } from './smoke-browser.mjs';

/** The ratios the set is shot at, and the suffix each one writes. */
const SCALES = [2, 3];

/** One level, one seed, for both scales: the two sets are the same run twice. */
const HERO_QUERY = '?bot=greedy&level=1&seed=1&turbo=60&screenshot=1&quality=0';

/**
 * The save injected before the Academy is photographed: coins in the purse,
 * upgrades bought, a staff chosen and the wisp unlocked, so the home screen and
 * the yard are pictures of a played game rather than of an empty one. The same
 * patch `smoke.mjs` uses for `academy.png`.
 */
const HERO_SAVE = {
  coins: 2400,
  upgrades: { damage: 3, fireRate: 2, startCount: 0, gateBonus: 0, bossDamage: 0 },
  staffs: {
    ember: { unlocked: true, tier: 1 },
    storm: { unlocked: true, tier: 1 },
    frost: { unlocked: false, tier: 1 },
  },
  selectedStaff: 'storm',
  familiar: { unlocked: true, tier: 1 },
  unlockedLevel: 7,
};

/**
 * The in-run frames, in the order the road offers them.
 *
 * `row` is metres between the squad and the nearest gate row it has not passed;
 * `after` keeps a shot out of the first rows, where the squad is still five
 * units and the frame would be a picture of an empty road rather than of a run.
 */
const RUN_SHOTS = [
  { at: 'row', value: 10, after: 70, name: 'hero-run' },
  { at: 'row', value: 6, after: 70, name: 'hero-gate-closeup' },
  { at: 'boss', name: 'hero-boss' },
];

/** The boss frame is taken here, half way through the fight; see `smoke-run.mjs`. */
const BOSS_SHOT_HP_SHARE = 0.5;

const READY_TIMEOUT_MS = 60_000;
const WARM_UP_TIMEOUT_MS = 120_000;
const SHOT_TIMEOUT_MS = 240_000;
const RUN_END_TIMEOUT_MS = 300_000;
const RESULT_SETTLE_MS = 30_000;
const MENU_SETTLE_MS = 900;

/**
 * Drives the whole set and answers what it wrote. One browser, one context per
 * scale, both driven at once; a failure on either is pushed onto `failures`
 * exactly as a run's would be, so the smoke still fails on it.
 */
export async function driveHeroSet(browser, baseUrl, outDir, failures, openPage) {
  const heroDir = path.join(outDir, 'hero');
  await mkdir(heroDir, { recursive: true });
  console.log(`[smoke] hero set: ${SCALES.map((s) => `${String(s)}x`).join(' and ')}, one level each`);

  const sets = await Promise.all(
    SCALES.map(async (scale) =>
      driveScale(browser, baseUrl, heroDir, failures, openPage, scale).catch((error) => {
        failures.push(`hero ${String(scale)}x: ${error.message}`);
        return [];
      }),
    ),
  );
  return sets.flat();
}

async function driveScale(browser, baseUrl, heroDir, failures, openPage, scale) {
  const page = await openPage(browser, failures, { deviceScaleFactor: scale });
  const written = [];
  const suffix = `-${String(scale)}x`;

  const shot = async (name) => {
    const file = path.join(heroDir, `${name}${suffix}.png`);
    await page.screenshot({ path: file, timeout: SCREENSHOT_TIMEOUT_MS });
    const { size } = await stat(file);
    console.log(`[smoke]   hero/${name}${suffix}.png (${(size / 1024).toFixed(0)} KB)`);
    written.push(`hero/${name}${suffix}.png`);
  };

  try {
    await page.goto(`${baseUrl}${HERO_QUERY}`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__arcane?.ready === true, null, {
      timeout: READY_TIMEOUT_MS,
    });
    // Nothing is photographed until every material is compiled: a hero shot
    // taken mid warm-up is a picture of an unfinished scene.
    await page
      .waitForFunction(
        () => {
          const shaders = globalThis.__arcane?.shaders();
          return shaders !== undefined && shaders.warming === false && shaders.warmed > 0;
        },
        null,
        { timeout: WARM_UP_TIMEOUT_MS },
      )
      .catch(() => {
        failures.push(`hero ${String(scale)}x: the shader warm-up never finished`);
      });

    // The home screen as a new player meets it, then the same screen with a
    // played save behind it, then a room.
    await sleep(MENU_SETTLE_MS);
    await shot('hero-title');
    await page.evaluate((patch) => {
      globalThis.__arcane?.setPlayer(patch);
    }, HERO_SAVE);
    await sleep(MENU_SETTLE_MS);
    await shot('hero-academy');
    await page.click('#academy-yard');
    await sleep(MENU_SETTLE_MS);
    await shot('hero-yard');
    await page.click('#room-back');
    await sleep(400);

    await armHeroPlan(page, RUN_SHOTS, BOSS_SHOT_HP_SHARE);
    await page.click('#academy-play');
    await sleep(400);
    await page.click('#play-button');

    for (const frame of RUN_SHOTS) {
      const reached = await page
        .waitForFunction(() => globalThis.__heroStopped === true, null, {
          timeout: SHOT_TIMEOUT_MS,
        })
        .then(() => true)
        .catch(() => false);
      if (!reached) {
        failures.push(`hero ${String(scale)}x: ${frame.name} — the run never reached it`);
        break;
      }
      try {
        await shot(frame.name);
      } finally {
        await page.evaluate(() => {
          globalThis.__heroStep = (globalThis.__heroStep ?? 0) + 1;
          globalThis.__heroStopped = false;
          globalThis.__arcane?.app.resume();
        });
      }
    }

    await page.waitForFunction(
      () => {
        const status = globalThis.__arcane?.state()?.status;
        return typeof status === 'string' && status !== 'running';
      },
      null,
      { timeout: RUN_END_TIMEOUT_MS },
    );
    await page
      .waitForFunction(() => globalThis.__arcane?.app.status() === 'result', null, {
        timeout: RESULT_SETTLE_MS,
      })
      .catch(() => {});
    // The sheet rolls its numbers and then its coins; the picture is of the
    // total, not of a counter halfway up.
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
    await sleep(1400);
    await shot('hero-result');
  } finally {
    await page.context().close();
  }

  return written;
}

/**
 * The page-side watcher.
 *
 * The same trick as `smoke-run.mjs` — the frame that qualifies stops the app's
 * loop from inside the page, so the frame photographed is the frame that
 * qualified on any machine — with the sim clock added: a `row` step slows the
 * sim down as its row comes into reach and hands the speed back afterwards.
 */
async function armHeroPlan(page, shots, bossShare) {
  await page.evaluate(
    ({ plan, share }) => {
      globalThis.__heroPlan = plan;
      globalThis.__heroStep = 0;
      globalThis.__heroStopped = false;

      /** Metres to the nearest gate row the squad has not passed, or null. */
      const rowGap = (state) => {
        let best = null;
        for (const gate of state.gates) {
          if (gate.passed) continue;
          const gap = gate.z - state.squad.z;
          if (gap <= 0) continue;
          if (best === null || gap < best) best = gap;
        }
        return best;
      };

      const holds = (step, state) => {
        if (step.at === 'boss') {
          const boss = state.boss;
          return (
            boss !== null &&
            boss !== undefined &&
            boss.active &&
            boss.alive &&
            boss.hp <= boss.maxHp * share
          );
        }
        // A row shot. Far away the run is fast-forwarded; inside two rows the
        // sim is stepped down twice, so the last frames before the shot are
        // about a metre of road each and the stop lands where it was asked to.
        if (state.squad.z < step.after) return false;
        const gap = rowGap(state);
        if (gap === null) return false;
        const turbo = gap > step.value + 24 ? 60 : gap > step.value + 4 ? 6 : 3;
        globalThis.__arcane?.setTurbo(turbo);
        return gap <= step.value;
      };

      const tick = () => {
        globalThis.requestAnimationFrame(tick);
        if (globalThis.__heroStopped) return;
        const step = globalThis.__heroPlan[globalThis.__heroStep];
        const state = globalThis.__arcane?.state();
        if (step === undefined || !state) return;
        if (!holds(step, state)) return;
        // Back up to speed for whatever comes after this shot; the next row
        // step slows it down again on its own.
        globalThis.__arcane?.setTurbo(60);
        globalThis.__arcane?.app.stop();
        globalThis.__heroStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, share: bossShare },
  );
}
