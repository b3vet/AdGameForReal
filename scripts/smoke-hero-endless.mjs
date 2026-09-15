/**
 * The endless page of the hero set (D52, D54): a biome crossing, a meteor and
 * a glacier.
 *
 * Its own page for the reason the Frostfell one is: it walks a different road
 * with a different save, and the three frames it exists for are found in three
 * different ways. The crossing is a *place* — the boundary between two spans,
 * photographed with the span being left underfoot and the one ahead already
 * painted on the far half of the road. The other two are *rare moments* with no
 * place at all: a meteor falls every seven seconds of sim wherever the crowd is
 * aiming and a wall of ice goes up every eight, so neither can be waited for by
 * walking to a metre mark. Both are found by polling the renderer's own feature
 * stats (`src/render/rendererStats.ts`, which says why they are there) and
 * stopping the loop on the frame that has one.
 *
 * Two runs on one page, because one squad carries one staff: the meteor is
 * ember's tier 4 and the glacier is frost's, and the only way to photograph
 * both is to walk the road once with each. The second is started through the
 * debug handle rather than by a second boot, which costs a level load instead
 * of a minute of Babylon.
 */

import { sleep } from './smoke-browser.mjs';
import { MENU_SETTLE_MS, bootHeroPage, shotTaker, takeHeroShots } from './smoke-hero-page.mjs';

/**
 * The seed the endless road is walked on. Any seed reaches the first boundary
 * — the span is 216 m and a greedy walk on this kit runs to about 2 km — so
 * this is only here to make the two runs the same road twice.
 */
const ENDLESS_SEED = 3;

/**
 * What the player is holding: both tier-4 evolutions bought, and the yard
 * rungs the campaign has by the time it can afford them (D54, Phase D's
 * ladder). Ember is in hand for the first run and frost for the second.
 *
 * The upgrades matter for the frames rather than for the fight: a bigger crowd
 * is what a meteor lands *in front of* and what a wall of ice holds a river
 * off, and an eight-unit starting squad photographs neither.
 */
const ENDLESS_SAVE = {
  coins: 0,
  upgrades: { damage: 3, fireRate: 3, startCount: 2, gateBonus: 3, bossDamage: 1 },
  staffs: {
    ember: { unlocked: true, tier: 4 },
    storm: { unlocked: true, tier: 1 },
    frost: { unlocked: true, tier: 4 },
  },
  selectedStaff: 'ember',
  familiar: { unlocked: false, tier: 0 },
  unlockedLevel: 40,
};

/**
 * The two ember frames, in the order the road offers them — and the meteor is
 * first on purpose.
 *
 * The endless road deals staff gates of its own (`endless.json`), and the first
 * one on this seed stands at about 140 m: a run that walked to the 216 m
 * boundary before looking for a meteor was carrying *frost* by the time it got
 * there, so ember's tier 4 could never fire again. The meteor falls seven
 * seconds in, thirty-odd metres up the road, which is before any gate.
 */
const EMBER_SHOTS = [
  { at: 'meteor', name: 'hero-meteor' },
  { at: 'boundary', value: 1, name: 'hero-endless-boundary' },
];

/** ...and the frost one, on a second walk of the same road. */
const FROST_SHOTS = [{ at: 'glacier', name: 'hero-glacier' }];

/**
 * How fast the sim may run while each of the three is being hunted for.
 *
 * The same idea as every other paced page (`scripts/smoke-run-plan.mjs` carries
 * the working), with one rung that is new: a *rare* moment cannot be paced by
 * how near it is, because there is nowhere to stand and wait for it. So the
 * clock is simply held low for the whole hunt, at a speed that puts two or
 * three frames inside the moment when it comes, and lower again once it has
 * come — `settle` is how many frames of that slower clock pass before the
 * picture is taken.
 *
 * The numbers are off `src/data/balance.json` and `src/render/evolutionLook.ts`:
 *
 *   meteor   one every 7 s; the head falls for 0.45 s. Hunting at 0.2 s a frame
 *            is two or three frames inside the fall, and three settling frames
 *            at 0.1 s put the head two thirds of the way down — clear of the
 *            squad-count plaque it hides behind at the top of its arc, and over
 *            the crater it is about to make.
 *   glacier  one every 8 s, standing for 5 s and rising over 0.22 s. Hunting at
 *            0.6 s a frame is eight frames inside the hold. It goes up twelve
 *            metres ahead of the squad, which is more than twenty from the
 *            camera — a pale slab the size of a thumbnail — so the ten settling
 *            frames at 0.2 s are two seconds of walking towards it, and it is
 *            still standing for three more.
 */
const ENDLESS_PACE = {
  cruise: 60,
  boundary: { far: 30, farTurbo: 10, near: 10, nearTurbo: 4 },
  boundaryShot: { before: 2, over: 6 },
  meteor: { hunt: 4, settleTurbo: 2, settleFrames: 3 },
  glacier: { hunt: 12, settleTurbo: 4, settleFrames: 10 },
};

/**
 * The endless page: the kit, a walk of the endless road with ember in hand,
 * and a second walk of the same road with frost.
 */
export async function driveEndless(browser, baseUrl, heroDir, failures, openPage, scale) {
  const page = await openPage(browser, failures, { deviceScaleFactor: scale });
  const written = [];
  const label = `hero endless ${String(scale)}x`;
  const shot = shotTaker(page, heroDir, scale, written);

  try {
    await bootHeroPage(page, `${baseUrl}?turbo=60&screenshot=1&quality=0`, failures, label);

    await page.evaluate((patch) => {
      globalThis.__arcane?.setPlayer(patch);
    }, ENDLESS_SAVE);
    await sleep(MENU_SETTLE_MS);

    await armEndlessPlan(page, EMBER_SHOTS, ENDLESS_PACE);
    await startEndless(page, ENDLESS_SEED);
    const walked = await takeHeroShots(page, EMBER_SHOTS, shot, failures, label);
    if (!walked) return written;

    // The same road again with the other staff in hand: a squad carries one.
    await page.evaluate(() => {
      globalThis.__arcane?.setPlayer({ selectedStaff: 'frost' });
    });
    await armEndlessPlan(page, FROST_SHOTS, ENDLESS_PACE);
    await startEndless(page, ENDLESS_SEED);
    await takeHeroShots(page, FROST_SHOTS, shot, failures, label);
  } finally {
    // The run is abandoned where it stands: everything this page was for has
    // been photographed by the last shot.
    await page.context().close();
  }

  return written;
}

/** Puts the squad on the endless road; the picker has a card for it (D52). */
function startEndless(page, seed) {
  return page.evaluate((value) => {
    globalThis.__arcane?.startEndless(value);
  }, seed);
}

/**
 * The endless watcher: one boundary, then whichever rare moment the plan asks
 * for.
 *
 * Its own rather than a case in another page's watcher, for the reason those
 * are their own: what it watches for is different in kind. A boundary is read
 * off the road the session is walking, and the meteor and the glacier are read
 * off what the renderer *drew* — which is the only honest test that they were
 * drawn at all.
 */
async function armEndlessPlan(page, shots, pace) {
  await page.evaluate(
    ({ plan, clock }) => {
      globalThis.__heroPlan = plan;
      globalThis.__heroStep = 0;
      globalThis.__heroStopped = false;
      globalThis.__heroAt = -1;
      // Frames the current step's moment has been on screen for; see `settle`.
      globalThis.__heroHeld = 0;
      globalThis.__heroArm = (globalThis.__heroArm ?? 0) + 1;
      const arm = globalThis.__heroArm;

      /** Metres of road one biome span holds, off the session's own level. */
      const spanMetres = () => globalThis.__arcane?.app.session?.level.biomeSpan ?? 0;

      /** What the renderer drew last frame (`src/render/rendererStats.ts`). */
      const drawn = () =>
        globalThis.__arcane?.app.renderer.featureStats ?? { meteors: 0, marks: 0, glacier: false };

      /**
       * True while the step's subject is on screen — and it is the *narrow*
       * test in both cases, because each one also says which staff is in hand.
       *
       * The meteor counts heads in flight rather than `marks`, which is every
       * mark an evolution leaves on the road: a frost run's freeze-pulse ring
       * is a mark too, and the first attempt at this photographed one and filed
       * it as a meteor. A head in flight is ember's and nothing else's. The ice
       * wall is frost's the same way.
       */
      const showing = (step) => {
        const stats = drawn();
        if (step.at === 'meteor') return stats.meteors > 0;
        return stats.glacier === true;
      };

      const holds = (step, state) => {
        if (step.at === 'boundary') {
          const span = spanMetres();
          if (span <= 0) return false;
          const gap = span * step.value - state.squad.z;
          const ladder = clock.boundary;
          globalThis.__arcane?.setTurbo(
            gap > ladder.far
              ? clock.cruise
              : gap > ladder.near
                ? ladder.farTurbo
                : ladder.nearTurbo,
          );
          const over = -gap;
          return over >= -clock.boundaryShot.before && over <= clock.boundaryShot.over;
        }

        const rare = step.at === 'meteor' ? clock.meteor : clock.glacier;
        if (!showing(step)) {
          // Nothing on screen: hold the clock low enough that the next one
          // cannot happen between two frames, and start the count again.
          globalThis.__heroHeld = 0;
          globalThis.__arcane?.setTurbo(rare.hunt);
          return false;
        }
        // Found it. A beat at a crawl, so a wall that is still rising out of
        // the road is photographed standing with a river piled against it.
        globalThis.__arcane?.setTurbo(rare.settleTurbo);
        globalThis.__heroHeld += 1;
        return globalThis.__heroHeld > rare.settleFrames;
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
        globalThis.__heroHeld = 0;
        globalThis.__arcane?.app.stop();
        globalThis.__heroStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, clock: pace },
  );
}
