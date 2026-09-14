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

import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCREENSHOT_TIMEOUT_MS, sleep } from './smoke-browser.mjs';

/**
 * The road's own lane width, read from the game's tuning rather than copied:
 * the swipe below has to know where a fence stands (`wallX` in
 * `src/sim/walls.ts` is `boundary * laneWidth / 2`), and a number repeated here
 * is a number that will be wrong the day the road changes.
 */
const BALANCE = JSON.parse(
  await readFile(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/data/balance.json'),
    'utf8',
  ),
);
const LANE_WIDTH = BALANCE.road.laneWidth;

/**
 * The ratios the set is shot at, and the suffix each one writes.
 *
 * Both, because the plan's definition of done asks for both (pixel ratio 2 and
 * 3) — and they are the longest third of the smoke, so `SMOKE_HERO_SCALES=2`
 * is the lever that gives about forty seconds back when a run is not the one
 * the milestone is judged on. It is not the default: a set missing its 3x half
 * is a set the product owner cannot read the phone's own frames off.
 */
const DEFAULT_SCALES = [2, 3];
const SCALES = readScales(process.env.SMOKE_HERO_SCALES, DEFAULT_SCALES);

/** The env list, or the fallback — never empty, or a set silently vanishes. */
function readScales(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = value
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  return parsed.length > 0 ? parsed : fallback;
}

/** One level, one seed, for both scales: the two sets are the same run twice. */
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

/**
 * The second run, for the two frames level 1 cannot give: a whip at 400 units
 * and the fence jam behind it (Milestone 6 plan, definition of done 2 and 1).
 *
 * Level 16 seed 1 because that is where the two coincide — measured off the
 * sim, the greedy bot walks a full five hundred units into the wall at
 * z 237..252 — and level 1 has neither: it peaks at 105 units and carries no
 * walls at all (`src/data/levels.json`, `wallRows`). It is the same page and
 * the same save: `startLevel` jumps straight in from the result sheet, which
 * costs a level load rather than a second boot.
 */
const EXTRA_LEVEL = 16;

/**
 * The scales the extra run is driven at.
 *
 * Both scales share four cores under SwiftShader and the whole smoke has a
 * seven-minute ceiling (docs/06-milestone-2-plan.md), so this is the lever the
 * budget is paid out of: the frames the milestone is *read* on are the 2x set,
 * and the 3x half of these two costs about as much wall clock as it adds
 * information. `SMOKE_HERO_EXTRA_SCALES=2,3` puts it back.
 */
const EXTRA_SCALES = readScales(process.env.SMOKE_HERO_EXTRA_SCALES, [2]);

/**
 * Two swipes, one frame each.
 *
 * `count` is the squad size the first one waits for and `frames` is how many
 * frames after a swipe starts its picture is taken. The sim is stepped down to
 * turbo 1 first, so a frame is a frame: the head crosses a lane in about 150 ms
 * (D43), which is three frames of sim here, and the tail of a five-hundred
 * column arrives about 0.57 s — a dozen frames — behind it.
 *
 * The two are different events and want different swipes. `whip` is on open
 * road, where the column *follows*: the head goes and five hundred units come
 * after it in a wave, which is the thing the milestone is about. `fence-jam` is
 * at a held fence, where it cannot: the head crosses the line and the column
 * piles up against it.
 *
 * How far each one goes is a framing decision, not a taste one. The camera's
 * lateral target is the finger (D43), so the distance between the finger and
 * the crowd is the distance between the middle of the frame and the crowd —
 * measured at 390x844, a full-road swipe (4 m) puts a five-hundred column half
 * off the left edge. A lane is the most a frame can hold both ends of, and at
 * a fence half a lane past the line is enough to be across it.
 */
const EXTRA_SHOTS = [
  { at: 'swipe', count: 400, frames: 3, name: 'hero-whip' },
  { at: 'fence', frames: 6, name: 'hero-fence-jam' },
];

/** How far past a fence the head is thrown, as a share of a lane. */
const FENCE_OVERSHOOT = 0.25;
/**
 * Sim speed while the road to the wall is run down.
 *
 * Derived from the gap rather than a ladder of fixed thresholds, because a
 * frame at turbo `t` is at most 0.05 s of sim (the app's own clamp) and the
 * column walks about nine metres a second — so a frame covers about
 * `t * 0.45` metres of road, and at turbo 60 that is twenty-seven metres
 * against a wall stretch of ten to twenty. A fixed ladder can therefore step
 * clean over the wall between two frames and the shot is never taken. A third
 * of what is left, every frame, reaches any wall in four or five frames and
 * cannot pass it.
 */
const EXTRA_METRES_PER_TURBO = 0.45;
const EXTRA_GAP_SHARE = 3;
const EXTRA_TURBO_MAX = 60;

/**
 * Where the whip is taken, in metres before the wall.
 *
 * On open road, so the column can follow the head — but close enough that the
 * road between the two shots is a second of sim and not thirty. The floor is
 * there because nearer than that the fence starts holding the column mid-swipe,
 * which is the *other* frame.
 */
const WHIP_GAP = [8, 2.5];

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
  console.log(
    `[smoke] hero set: ${SCALES.map((s) => `${String(s)}x`).join(' and ')}, one level each` +
      `, swipe frames at ${EXTRA_SCALES.map((s) => `${String(s)}x`).join(' and ')}`,
  );

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

    if (EXTRA_SCALES.includes(scale)) {
      await driveExtras(page, shot, failures, scale);
    }
  } finally {
    await page.context().close();
  }

  return written;
}

/**
 * The swipe run: jump into a walled level with a full column and take the wheel.
 *
 * Everything above is a bot playing; this is a *finger*, because the two frames
 * it is here for are things a player does and a bot does not — a full-road
 * swipe across a fence that is holding the crowd (`ArcaneDebugHandle.steer`,
 * which drops the bot for the rest of the run). Nothing is measured after that
 * and the run is abandoned where it stands: the page closes on the last shot.
 */
async function driveExtras(page, shot, failures, scale) {
  await page.evaluate((level) => {
    globalThis.__arcane?.setTurbo(60);
    globalThis.__arcane?.app.startLevel(level);
  }, EXTRA_LEVEL);
  await sleep(400);
  await armExtraPlan(page, EXTRA_SHOTS);

  for (const frame of EXTRA_SHOTS) {
    const reached = await page
      .waitForFunction(() => globalThis.__heroStopped === true, null, {
        timeout: SHOT_TIMEOUT_MS,
      })
      .then(() => true)
      .catch(() => false);
    if (!reached) {
      failures.push(
        `hero ${String(scale)}x: ${frame.name} — level ${String(EXTRA_LEVEL)} never reached it`,
      );
      return;
    }
    try {
      await shot(frame.name);
    } finally {
      await page.evaluate(() => {
        globalThis.__heroStep = (globalThis.__heroStep ?? 0) + 1;
        // The next step starts its own swipe, so the frame count goes back to
        // "not swiping yet".
        globalThis.__heroSwipe = -1;
        globalThis.__heroStopped = false;
        globalThis.__arcane?.app.resume();
      });
    }
  }
}

/**
 * The page-side watcher for the swipes.
 *
 * Its own, rather than a third case in `armHeroPlan`, because it is the only
 * one that *acts*: the others wait for the road to offer a moment, and this one
 * makes the moment and then counts frames. Frames, not metres or seconds — the
 * whip is the distance between the head and the tail of the column, which is a
 * number of steps after the swipe starts and nothing else.
 */
async function armExtraPlan(page, shots) {
  await page.evaluate(({ plan, lane, over, clock, whip }) => {
    globalThis.__heroPlan = plan;
    globalThis.__heroStep = 0;
    globalThis.__heroStopped = false;
    globalThis.__heroSwipe = -1;
    // Retires the run watcher above: two of them on one page would fight over
    // the sim clock, and the older one's plan is over anyway.
    globalThis.__heroArm = (globalThis.__heroArm ?? 0) + 1;
    const arm = globalThis.__heroArm;

    /** The wall holding the squad where it stands, or undefined. */
    const heldWall = (state) =>
      (state.walls ?? []).find(
        (wall) => state.squad.z >= wall.zStart && state.squad.z <= wall.zEnd,
      );

    /** Metres to the next wall the squad has not reached, or null. */
    const wallGap = (state) => {
      let best = null;
      for (const wall of state.walls ?? []) {
        const gap = wall.zStart - state.squad.z;
        if (gap <= 0) continue;
        if (best === null || gap < best) best = gap;
      }
      return best;
    };

    /** Sim speed for a road still `gap` metres short of its wall. */
    const approach = (gap) => {
      const wanted = gap === null ? clock.max : gap / (clock.share * clock.metres);
      globalThis.__arcane?.setTurbo(Math.max(1, Math.min(clock.max, wanted)));
    };

    /** Starts this step's swipe when its moment arrives; true once it has. */
    const begin = (step, state) => {
      if (step.at === 'swipe') {
        // Open road with a full column, a few metres short of the wall: the
        // crowd has to be able to *follow* the head, which is what a whip is,
        // and the fence two shots from now must not be holding it yet.
        const gap = wallGap(state);
        approach(gap);
        if (state.squad.count < step.count) return false;
        if (gap === null || gap > whip[0] || gap < whip[1]) return false;
        if (heldWall(state) !== undefined) return false;
        globalThis.__arcane?.setTurbo(1);
        // One lane, towards the middle of the road, so the swipe cannot end
        // against the kerb with half the column outside the frame.
        globalThis.__arcane?.steer(state.squad.x + (state.squad.x >= 0 ? -lane : lane));
        return true;
      }
      // The fence itself, a second of road later: the head is thrown over the
      // line, which does not stop it at all (D43) — that is the whole point of
      // the shot — and the column behind it is what piles up.
      const wall = heldWall(state);
      if (wall === undefined) {
        approach(wallGap(state));
        return false;
      }
      const fenceX = (wall.boundary * lane) / 2;
      const side = state.squad.x < fenceX ? 1 : -1;
      globalThis.__arcane?.setTurbo(1);
      globalThis.__arcane?.steer(fenceX + side * lane * over);
      return true;
    };

    const holds = (step, state) => {
      if (globalThis.__heroSwipe < 0) {
        if (!begin(step, state)) return false;
        globalThis.__heroSwipe = 0;
        return false;
      }
      globalThis.__heroSwipe++;
      return globalThis.__heroSwipe >= step.frames;
    };

    const tick = () => {
      if (globalThis.__heroArm !== arm) return;
      globalThis.requestAnimationFrame(tick);
      if (globalThis.__heroStopped) return;
      const step = globalThis.__heroPlan[globalThis.__heroStep];
      const state = globalThis.__arcane?.state();
      if (step === undefined || !state) return;
      if (!holds(step, state)) return;
      globalThis.__arcane?.app.stop();
      globalThis.__heroStopped = true;
    };
    globalThis.requestAnimationFrame(tick);
  }, {
    plan: shots,
    lane: LANE_WIDTH,
    over: FENCE_OVERSHOOT,
    clock: {
      metres: EXTRA_METRES_PER_TURBO,
      share: EXTRA_GAP_SHARE,
      max: EXTRA_TURBO_MAX,
    },
    whip: WHIP_GAP,
  });
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
