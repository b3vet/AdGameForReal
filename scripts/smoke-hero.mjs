/**
 * The hero set: the frames the milestone is judged on, at the pixel ratios a
 * phone actually renders at (Milestone 5 plan, definition of done 1; Milestone
 * 7's five Frostfell frames, D49).
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
 * This file is the *set*: which pages are driven, at which scales, and the
 * meadow page itself. Four files sit behind it — `./smoke-hero-page.mjs` is
 * the plumbing every page shares, `./smoke-hero-frost.mjs` is the Frostfell
 * page (D49), `./smoke-hero-endless.mjs` is the endless one (D52, D54) and
 * `./smoke-hero-swipe.mjs` is the swipe run, which is the only one that takes
 * the wheel instead of watching.
 *
 * One meadow page, a second for the Frostfell frames since Milestone 7 and a
 * third for the endless road since Milestone 8, driven at the same time in one
 * browser. They are pages on a four-core machine
 * and SwiftShader is CPU-bound, so running them side by side costs about half
 * again as much wall clock as one rather than twice — which is what keeps the
 * set from being the whole budget. A third page is what `SMOKE_HERO_SCALES=2,3`
 * adds back (see `DEFAULT_SCALES`). The title frame stays on the meadow: it is
 * the game's front door and the front door is biome 1.
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

import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { sleep } from './smoke-browser.mjs';
import { driveEndless } from './smoke-hero-endless.mjs';
import { driveFrost } from './smoke-hero-frost.mjs';
import {
  MENU_SETTLE_MS,
  bootHeroPage,
  readScales,
  settleResult,
  shotTaker,
  takeHeroShots,
} from './smoke-hero-page.mjs';
import { EXTRA_SCALES, driveExtras } from './smoke-hero-swipe.mjs';

/**
 * The ratios the set is shot at, and the suffix each one writes.
 *
 * 2x by default, and that is the Milestone 7 review's call rather than the
 * original one. Milestone 5's plan asks for both (pixel ratio 2 and 3) and both
 * were the default for two milestones; what changed is that the set now drives
 * a third page for Frostfell, and a 3x page is 2.25 times the pixels of a 2x
 * one through SwiftShader — between them that is most of why the whole smoke
 * runs at two and a half times its seven-minute ceiling
 * (docs/06-milestone-2-plan.md).
 *
 * Nothing is weakened by dropping it: every frame in the set is still taken,
 * still at a phone's own backing-store resolution, and still judged — the 3x
 * half is the *same picture* at more pixels, which is the same call
 * `EXTRA_SCALES` and `FROST_SCALES` already make. `SMOKE_HERO_SCALES=2,3` puts
 * it back for the frames a milestone is signed off on.
 */
const DEFAULT_SCALES = [2];
const SCALES = readScales(process.env.SMOKE_HERO_SCALES, DEFAULT_SCALES);

/**
 * The scales the Frostfell page is taken at (D49).
 *
 * 2x only, for the same reason as `DEFAULT_SCALES` and `EXTRA_SCALES`: the
 * frames the milestone is read on are the 2x set.
 * `SMOKE_HERO_FROST_SCALES=2,3` puts the second page back.
 */
const FROST_SCALES = readScales(process.env.SMOKE_HERO_FROST_SCALES, [2]);

/**
 * The scales the endless page is taken at (D52, D54): the biome crossing, the
 * meteor and the glacier. 2x only, for the same reason as every other page
 * here; `SMOKE_HERO_ENDLESS_SCALES=2,3` puts a second one back.
 */
const ENDLESS_SCALES = readScales(process.env.SMOKE_HERO_ENDLESS_SCALES, [2]);

/** One level, one seed, for every scale: the sets are the same run over. */
const HERO_QUERY = '?bot=greedy&level=1&seed=1&turbo=60&screenshot=1&quality=0';

/**
 * The save injected before the Academy is photographed: coins in the purse,
 * upgrades bought, a staff chosen and the wisp unlocked, so the home screen and
 * the yard are pictures of a played game rather than of an empty one. The same
 * patch `smoke.mjs` uses for `academy.png`.
 *
 * Six thousand coins, where Milestone 5 injected 2400. The economy re-priced
 * the ladder in Milestone 6 (D46): a rung is `900 * 1.6^level` now, so this
 * save's next damage rung costs 3686 and its next fire-rate rung 2304 — 2400
 * bought one of the five rows and greyed the headline one out. Six thousand
 * buys two rungs, which is what the shot is of: a purse with a decision in it.
 */
const HERO_SAVE = {
  coins: 6000,
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

/** How long the result sheet's coin roll is given after its numbers settle. */
const RESULT_COINS_MS = 1400;

/**
 * Yesterday, as `src/core/clock.ts` writes a day: the streak is a local
 * calendar day and a fixed string would read as "longer ago" (D51).
 */
function yesterdayKey() {
  const day = new Date();
  day.setDate(day.getDate() - 1);
  const pad = (value) => String(value).padStart(2, '0');
  const year = String(day.getFullYear()).padStart(4, '0');
  return `${year}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
const YESTERDAY = yesterdayKey();

/**
 * The meta layer, injected *after* the run rather than with `HERO_SAVE` (D51 to
 * D53): a five-day streak, a board with three missions on it, the kills that
 * open the Wardrobe's first rungs and the tints they handed over.
 *
 * After, because a chosen hat is on every mage in the crowd — that is what a
 * cosmetic is — and the meadow set's run frames are the ones the milestone's
 * *look* is read on. They stay the same picture they have been since Milestone
 * 5, and the two screens this dresses are photographed on the way back out.
 */
const HERO_META = {
  streak: { days: 5, lastDay: YESTERDAY },
  missions: {
    active: [
      { id: 'roads3', progress: 2, done: false },
      { id: 'sigils12', progress: 5, done: false },
      { id: 'endless600', progress: 180, done: false },
    ],
    rolled: 3,
  },
  kills: { grunt: 16_000, brute: 70, charger: 20, shieldBrute: 12, demon: 9, rime: 2 },
  // The kinds this player has met on a road, which is a different record
  // from how many of them they have killed: without it every card reads
  // "Not yet met" over a four-figure tally (`src/core/session.ts`).
  bestiary: ['grunt', 'brute', 'charger', 'shieldBrute', 'demon'],
  cosmetics: {
    owned: ['hatBone', 'capeBone', 'hatStone', 'hatHound', 'glowBulwark', 'glowEmber'],
    selected: { hat: 'hatStone', cape: 'capeBone', staffGlow: 'glowEmber' },
  },
};


/**
 * Drives the whole set and answers what it wrote. One browser, one context per
 * page, all driven at once; a failure on any of them is pushed onto `failures`
 * exactly as a run's would be, so the smoke still fails on it.
 *
 * `wantedPart` names which pages to drive (`SMOKE_ONLY` in `scripts/smoke.mjs`),
 * which is what a review uses when one frame has to be taken again rather than
 * all nineteen.
 */
export async function driveHeroSet(browser, baseUrl, outDir, failures, openPage, wantedPart) {
  const heroDir = path.join(outDir, 'hero');
  await mkdir(heroDir, { recursive: true });
  console.log(
    `[smoke] hero set: ${SCALES.map((s) => `${String(s)}x`).join(' and ')}, one level each` +
      `, swipe frames at ${EXTRA_SCALES.map((s) => `${String(s)}x`).join(' and ')}` +
      `, Frostfell at ${FROST_SCALES.map((s) => `${String(s)}x`).join(' and ')}` +
      `, endless at ${ENDLESS_SCALES.map((s) => `${String(s)}x`).join(' and ')}`,
  );

  // Each page can be driven on its own (`SMOKE_ONLY`, `scripts/smoke.mjs`),
  // which is what a review does when one frame has to be taken again.
  const sets = await Promise.all([
    ...(wantedPart('hero-meadow') ? SCALES : []).map(async (scale) =>
      driveScale(browser, baseUrl, heroDir, failures, openPage, scale).catch((error) => {
        failures.push(`hero ${String(scale)}x: ${error.message}`);
        return [];
      }),
    ),
    ...(wantedPart('hero-frost') ? FROST_SCALES : []).map(async (scale) =>
      driveFrost(browser, baseUrl, heroDir, failures, openPage, scale).catch((error) => {
        failures.push(`hero frost ${String(scale)}x: ${error.message}`);
        return [];
      }),
    ),
    ...(wantedPart('hero-endless') ? ENDLESS_SCALES : []).map(async (scale) =>
      driveEndless(browser, baseUrl, heroDir, failures, openPage, scale).catch((error) => {
        failures.push(`hero endless ${String(scale)}x: ${error.message}`);
        return [];
      }),
    ),
  ]);
  return sets.flat();
}

/**
 * The meadow page: the front door, the Academy, a level-1 run and its result
 * sheet — and, at the scales `EXTRA_SCALES` names, the swipe run after it.
 */
async function driveScale(browser, baseUrl, heroDir, failures, openPage, scale) {
  const page = await openPage(browser, failures, { deviceScaleFactor: scale });
  const written = [];
  const label = `hero ${String(scale)}x`;
  const shot = shotTaker(page, heroDir, scale, written);

  try {
    await bootHeroPage(page, `${baseUrl}${HERO_QUERY}`, failures, label);

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

    await takeHeroShots(page, RUN_SHOTS, shot, failures, label);

    await settleResult(page);
    // The sheet rolls its numbers and then its coins; the picture is of the
    // total, not of a counter halfway up.
    await sleep(RESULT_COINS_MS);
    await shot('hero-result');

    if (EXTRA_SCALES.includes(scale)) {
      await driveExtras(page, shot, failures, scale);
    }

    // Last, with the meta layer dressed on: the Academy home with a streak
    // plaque and a full board, and the Wardrobe behind it (D51 to D53). The
    // home is asked for directly because this page is mid-run by now — the
    // swipe frames leave a level-16 run on the road, and there is no Back on
    // the HUD.
    await page.evaluate((patch) => {
      globalThis.__arcane?.app.showHome();
      globalThis.__arcane?.setPlayer(patch);
    }, HERO_META);
    await sleep(MENU_SETTLE_MS);
    await shot('hero-missions');
    await page.evaluate(() => {
      globalThis.__arcane?.openRoom('wardrobe');
    });
    await sleep(MENU_SETTLE_MS);
    await shot('hero-wardrobe');
  } finally {
    await page.context().close();
  }

  return written;
}

/**
 * The meadow page's watcher.
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
      // Sim time of the last shot: a step released here may qualify the next
      // one before the app's loop has drawn a frame, and two shots then
      // photograph the same frame (`smoke-run.mjs` has the same guard).
      globalThis.__heroAt = -1;
      // Watchers are armed more than once per page (the run, then the swipe),
      // and an old one left ticking would read the new plan as if it were its
      // own — and fight it for the sim clock. A generation is what retires it.
      globalThis.__heroArm = (globalThis.__heroArm ?? 0) + 1;
      const arm = globalThis.__heroArm;

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
        if (globalThis.__heroArm !== arm) return;
        globalThis.requestAnimationFrame(tick);
        if (globalThis.__heroStopped) return;
        const step = globalThis.__heroPlan[globalThis.__heroStep];
        const state = globalThis.__arcane?.state();
        if (step === undefined || !state) return;
        if (state.time === globalThis.__heroAt) return;
        if (!holds(step, state)) return;
        globalThis.__heroAt = state.time;
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
