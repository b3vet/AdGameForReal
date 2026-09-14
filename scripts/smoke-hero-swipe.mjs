/**
 * The swipe run: the two hero frames a bot cannot produce.
 *
 * Split out of `./smoke-hero.mjs` in the Milestone 7 review. Everything else in
 * the set is a bot playing and a watcher waiting for the road to offer a
 * moment; this one takes the wheel (`ArcaneDebugHandle.steer`, which drops the
 * bot for the rest of the run) and *makes* the moment, which is why its watcher
 * counts frames where the others measure metres.
 *
 * It runs as a second act on the meadow page rather than as a page of its own:
 * `startLevel` jumps straight in from the result sheet, which costs a level
 * load rather than a second boot.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sleep } from './smoke-browser.mjs';
import { readScales, takeHeroShots } from './smoke-hero-page.mjs';

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
 * The level these two frames come from: a whip at 400 units and the fence jam
 * behind it (Milestone 6 plan, definition of done 2 and 1).
 *
 * Level 16 seed 1 because that is where the two coincide — measured off the
 * sim, the greedy bot walks a full five hundred units into the wall at
 * z 237..252 — and level 1 has neither: it peaks at 105 units and carries no
 * walls at all (`src/data/levels.json`, `wallRows`).
 */
const EXTRA_LEVEL = 16;

/**
 * The scales the extra run is driven at.
 *
 * The pages share four cores under SwiftShader and the whole smoke has a
 * seven-minute ceiling (docs/06-milestone-2-plan.md), so this is one of the
 * places the budget is paid out of: the frames the milestone is *read* on are
 * the 2x set, and a 3x copy of these two costs about as much wall clock as it
 * adds information. `SMOKE_HERO_EXTRA_SCALES=2,3` puts it back.
 */
export const EXTRA_SCALES = readScales(process.env.SMOKE_HERO_EXTRA_SCALES, [2]);

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

/**
 * Jumps the page into the walled level and takes the wheel.
 *
 * Nothing is measured after this and the run is abandoned where it stands: the
 * caller closes the page on the last shot.
 */
export async function driveExtras(page, shot, failures, scale) {
  await page.evaluate((level) => {
    globalThis.__arcane?.setTurbo(60);
    globalThis.__arcane?.app.startLevel(level);
  }, EXTRA_LEVEL);
  await sleep(400);
  await armExtraPlan(page, EXTRA_SHOTS);
  await takeHeroShots(
    page,
    EXTRA_SHOTS,
    shot,
    failures,
    `hero ${String(scale)}x: level ${String(EXTRA_LEVEL)}`,
    true,
  );
}

/**
 * The page-side watcher for the swipes.
 *
 * Its own, rather than a case in the other two, because it is the only one that
 * *acts*: they wait for the road to offer a moment, and this one makes the
 * moment and then counts frames. Frames, not metres or seconds — the whip is
 * the distance between the head and the tail of the column, which is a number
 * of steps after the swipe starts and nothing else.
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
