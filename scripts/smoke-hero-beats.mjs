/**
 * The beat page of the hero set (document 31, Phase 1): four designed beats,
 * each photographed at the moment its question is on screen.
 *
 * Its own page for the reason every other page here is: it walks different
 * roads. Each frame is one beat alone on the `?beat=` road (`src/core/
 * devScenes.ts`) — a guard, an ambush, a toll river and a commit fence, the
 * four the level-design plan's render track is read on — walked by the greedy
 * bot on a squad of a hundred, which is the middle of the three sizes the beat
 * lab holds every beat to. The four are started through the debug handle on
 * one boot (`ArcaneDebugHandle.startBeat`), which costs a road load each
 * instead of a minute of Babylon.
 *
 * The frames are *places* rather than moments: each is taken when the beat's
 * gate row is a set distance up the road, read off the road's own beat mark
 * (`LevelDef.beats`), so the picture is of the same instant on any machine.
 * The distances are where each beat's price is plainest:
 *
 *   guard   40 m out: the guard has woken and is walking into the prize lane's
 *           fire, its number on it, the row it guards behind it.
 *   ambush  20 m out: the block behind the plus panel has just set off; it
 *           shows through the see-through plaque, its number lifted over it.
 *   toll    20 m out: the portal behind the panel is pouring, and the river is
 *           in the lane the column has to stand in for the prize.
 *   fence   18 m out: the column is committed inside the fence, the outer
 *           lane's portal pouring down it.
 *
 * Shot at 440x956, the owner's phone (document 28), rather than the smoke's
 * 390x844, and at the scale the set is taken at. The page also asserts what a
 * run asserts about the frame, because a beat road is a new road: no shader
 * compiled while the beats played, and the draw calls under the campaign's
 * ceiling (`scripts/smoke-run-checks.mjs`).
 *
 * Not yet driven by `./smoke-hero.mjs`: `driveBeats` has the signature of the
 * other pages' drivers, and wiring it in is one more entry in `driveHeroSet`.
 */

import { sleep } from './smoke-browser.mjs';
import {
  READY_TIMEOUT_MS,
  bootHeroPage,
  shotTaker,
  takeHeroShots,
} from './smoke-hero-page.mjs';

/** The owner's phone, in CSS pixels (document 28). */
const BEAT_VIEWPORT = { width: 440, height: 956 };

/** The squad every beat is sized for and walked with; the beat lab's middle size. */
const BEAT_COUNT = 100;

/**
 * The four beats and where each is photographed: `gap` is metres from the
 * squad to the beat's gate row.
 */
const BEAT_SHOTS = [
  { beat: 'guard:2', gap: 40, name: 'hero-beat-guard' },
  { beat: 'ambush:3', gap: 20, name: 'hero-beat-ambush' },
  { beat: 'toll:3', gap: 20, name: 'hero-beat-toll' },
  { beat: 'fence:3', gap: 18, name: 'hero-beat-fence' },
];

/**
 * How fast the sim may run on the way to each frame.
 *
 * A frame is at most 0.05 s of wall clock times the turbo (`MAX_FRAME_DT`,
 * `src/core/frame.ts`), and the squad runs 5 m/s: `cruise` is three metres a
 * frame until the row is `near` metres short of the shot, and `close` is under
 * a metre a frame from there, so the frame taken is within a metre of the gap
 * asked for however slowly the page draws.
 */
const BEAT_PACE = { cruise: 12, close: 3, near: 8 };

/** The campaign's draw-call ceiling (`scripts/smoke-run-checks.mjs`, D67). */
const BEAT_DRAW_LIMIT = Number(process.env.SMOKE_DRAW_CALLS ?? 52);

/**
 * The beat page: one boot, four beats, a frame of each.
 */
export async function driveBeats(browser, baseUrl, heroDir, failures, openPage, scale) {
  const page = await openPage(browser, failures, {
    viewport: BEAT_VIEWPORT,
    deviceScaleFactor: scale,
  });
  const written = [];
  const label = `hero beats ${String(scale)}x`;
  const shot = shotTaker(page, heroDir, scale, written);

  try {
    await bootHeroPage(page, `${baseUrl}?bot=greedy&screenshot=1&quality=0`, failures, label);
    // A beat started before Havok lands compiles the debris pools' shaders
    // inside its first frames; `?beat=` waits for it the same way.
    await page.waitForFunction(() => globalThis.__arcane?.physics() !== null, null, {
      timeout: READY_TIMEOUT_MS,
    });
    const before = await page.evaluate(() => globalThis.__arcane?.shaders().programs ?? -1);
    // The peak is the run's own (`FrameDriver.resetPeak`), so it is read after
    // every beat rather than once at the end.
    let draws = 0;

    for (const step of BEAT_SHOTS) {
      await armBeatPlan(page, step, BEAT_PACE);
      await page.evaluate(
        ({ beat, count }) => {
          globalThis.__arcane?.startBeat(beat, count);
        },
        { beat: step.beat, count: BEAT_COUNT },
      );
      const walked = await takeHeroShots(page, [step], shot, failures, label);
      if (!walked) return written;
      draws = Math.max(draws, await page.evaluate(() => globalThis.__arcane?.draws().peak ?? 0));
      await sleep(200);
    }

    const after = await page.evaluate(() => globalThis.__arcane?.shaders().programs ?? -1);
    console.log(
      `[smoke]   ${label}: shader programs ${String(before)} before, ${String(after)} after; ` +
        `draw calls peak ${String(draws)}`,
    );
    if (after > before) {
      failures.push(`${label}: ${String(after - before)} shader(s) compiled during the beats`);
    }
    if (draws > BEAT_DRAW_LIMIT) {
      failures.push(`${label}: ${String(draws)} draw calls, over ${String(BEAT_DRAW_LIMIT)}`);
    }
  } finally {
    // The last beat is left on its road: everything this page was for has
    // been photographed.
    await page.context().close();
  }

  return written;
}

/**
 * The beat watcher: paces the clock by the distance to the road's beat mark and
 * stops the app's loop on the first frame inside the asked-for gap.
 *
 * A new generation per beat, as the other pages' watchers are armed: the one
 * left from the previous beat would otherwise read the new road's mark as its
 * own and fight this one for the clock. A road is only this step's once its
 * mark says it is the step's beat, so a frame of the previous road drawn after
 * the handle call cannot be photographed by mistake.
 */
async function armBeatPlan(page, step, pace) {
  await page.evaluate(
    ({ plan, clock }) => {
      globalThis.__heroPlan = [plan];
      globalThis.__heroStep = 0;
      globalThis.__heroStopped = false;
      globalThis.__heroAt = -1;
      globalThis.__heroArm = (globalThis.__heroArm ?? 0) + 1;
      const arm = globalThis.__heroArm;
      const [wantedBeat, wantedTier] = plan.beat.split(':');
      globalThis.__arcane?.setTurbo(clock.cruise);

      const tick = () => {
        if (globalThis.__heroArm !== arm) return;
        globalThis.requestAnimationFrame(tick);
        if (globalThis.__heroStopped) return;
        if (globalThis.__heroStep > 0) return;
        const session = globalThis.__arcane?.app.session;
        const state = globalThis.__arcane?.state();
        const mark = session?.level.beats?.[0];
        if (!state || mark === undefined) return;
        if (mark.beat !== wantedBeat || String(mark.tier) !== wantedTier) return;
        if (state.time === globalThis.__heroAt || state.status !== 'running') return;
        const gap = mark.z - state.squad.z;
        globalThis.__arcane?.setTurbo(gap > plan.gap + clock.near ? clock.cruise : clock.close);
        if (gap > plan.gap) return;
        globalThis.__heroAt = state.time;
        globalThis.__arcane?.app.stop();
        globalThis.__heroStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: step, clock: pace },
  );
}
