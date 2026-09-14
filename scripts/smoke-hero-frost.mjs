/**
 * The Frostfell hero page (D49): the five frames the second biome is judged on.
 *
 * Split out of `./smoke-hero.mjs` in the Milestone 7 review. It is its own file
 * for the same reason it is its own *page*: it walks a different level of a
 * different biome with a different save, and the three frames it exists for are
 * *moments* rather than places, so it needs a watcher and a pace ladder that
 * the meadow page has no use for.
 */

import { sleep } from './smoke-browser.mjs';
import {
  MENU_SETTLE_MS,
  bootHeroPage,
  shotTaker,
  takeHeroShots,
} from './smoke-hero-page.mjs';

/**
 * The level the Frostfell frames come from, and the one seed they are shot on.
 *
 * 23 is the first level that carries both new kinds, and on seed 1 it deals
 * them in the order the shot list below asks for. The same level and seed the
 * smoke's own Frostfell run plays (`scripts/smoke.mjs`), so the pictures and
 * the assertions are of the same road.
 */
export const FROST_LEVEL = 23;
export const FROST_SEED = 1;

/**
 * What the campaign says the player is holding when it first reaches level 23,
 * read off `runCampaign` rather than invented (Milestone 7 Phase D). From level
 * 21 the game is balanced for a player who has shopped, so a bare hero run
 * would photograph a squad being wiped rather than the biome.
 */
const FROST_SAVE = {
  coins: 0,
  upgrades: { damage: 2, fireRate: 2, startCount: 2, gateBonus: 2, bossDamage: 1 },
  staffs: {
    ember: { unlocked: true, tier: 1 },
    storm: { unlocked: true, tier: 1 },
    frost: { unlocked: true, tier: 1 },
  },
  selectedStaff: 'frost',
  familiar: { unlocked: false, tier: 0 },
  unlockedLevel: FROST_LEVEL,
};

/**
 * The five Frostfell frames, in the order the road offers them.
 *
 * The first two are the meadow set's own two shots one biome over — the run and
 * a gate row close up — so the two biomes can be read side by side. The last
 * three are the milestone's new content, and all three are *moments*: see
 * `FROST_PACE` for why each one names a sim speed.
 */
const FROST_SHOTS = [
  { at: 'row', value: 10, after: 70, name: 'hero-frost-run' },
  { at: 'row', value: 6, after: 70, name: 'hero-frost-gate-closeup' },
  { at: 'shieldBroken', name: 'hero-shield-broken' },
  { at: 'charge', name: 'hero-charger' },
  { at: 'bossCharge', name: 'hero-frost-boss' },
];

/**
 * How fast the sim may run as each Frostfell moment comes into reach.
 *
 * The same idea as the meadow page's row shots and the same numbers as the
 * smoke run's (`scripts/smoke-run.mjs`, `PACE`, which carries the working for
 * every rung), measured on the sim: the shielded brute's shield lasts a tenth
 * of a second inside the squad's range, the block lives 1.3 s broken, the
 * charger runs for 0.9 s, and the Fiend's first charge is 8 s into the fight
 * and 1.3 s long. At turbo 60 a frame is three seconds of sim, so without this
 * every one of them happens between two frames.
 */
const FROST_PACE = {
  /** What the sim runs at when this step's subject is out of reach; see `PACE`
   *  in `./smoke-run.mjs` for why a paced step must hand the clock back. */
  cruise: 60,
  far: { gap: 90, turbo: 10 },
  near: { gap: 44, turbo: 3 },
  charger: { gap: 60, turbo: 12 },
  chargerNear: { gap: 26, turbo: 4 },
  /** Slower again once it is running, so there are frames inside the window.
   *  It was 2 until the Milestone 7 review moved the spray emitter onto the
   *  sim's clock (`src/render/frostSpray.ts`): the trail is now the same track
   *  at any turbo, so this no longer has to buy the *look* of one. */
  charging: 4,
  boss: 8,
  /** How near the column the Fiend is photographed; see `PACE`. */
  bossGap: 6,
  /** Where each body is photographed, as in the smoke run's own `PACE`. */
  brokenShot: { from: 5, to: 26 },
  chargeShot: { from: 3, to: 17 },
};

/**
 * The Frostfell page: boot straight into level 23 with the campaign's kit and
 * walk it, stopping on the five frames the biome is judged on.
 *
 * Its own boot rather than a `startLevel` off the level-1 page, because it is
 * driven beside that page rather than after it — see `FROST_SCALES`. Everything
 * before the run is skipped: the title and the Academy are meadow frames and
 * the set already has them.
 */
export async function driveFrost(browser, baseUrl, heroDir, failures, openPage, scale) {
  const page = await openPage(browser, failures, { deviceScaleFactor: scale });
  const written = [];
  const label = `hero frost ${String(scale)}x`;
  const shot = shotTaker(page, heroDir, scale, written);

  try {
    const query =
      `?bot=greedy&level=${String(FROST_LEVEL)}&seed=${String(FROST_SEED)}` +
      '&turbo=60&screenshot=1&quality=0';
    await bootHeroPage(page, `${baseUrl}${query}`, failures, label);

    // The kit first, then the picker: level 23 is locked to a new save, and an
    // unarmed squad up here photographs a wipe rather than a biome.
    await page.evaluate((patch) => {
      globalThis.__arcane?.setPlayer(patch);
    }, FROST_SAVE);
    await sleep(MENU_SETTLE_MS);

    await armFrostPlan(page, FROST_SHOTS, FROST_PACE);
    await page.click('#academy-play');
    await sleep(400);
    await page.click('#play-button');

    await takeHeroShots(page, FROST_SHOTS, shot, failures, label);
  } finally {
    // The run is abandoned where it stands: everything this page was for has
    // been photographed by the last shot.
    await page.context().close();
  }

  return written;
}

/**
 * The Frostfell watcher: gate rows, then the three moments the biome is new for.
 *
 * Its own rather than a case in the meadow page's watcher, for the reason that
 * one is its own: what it watches for is different in kind. A row shot is keyed
 * to a *place* the squad walks to, and the sim can be slowed on the way to it;
 * the shield break, the charger's run and the Fiend's charge are keyed to
 * *moments* a tenth of a second to a second long, so the clock has to be down
 * before they arrive — see `FROST_PACE`.
 */
async function armFrostPlan(page, shots, pace) {
  await page.evaluate(
    ({ plan, clock }) => {
      globalThis.__heroPlan = plan;
      globalThis.__heroStep = 0;
      globalThis.__heroStopped = false;
      globalThis.__heroAt = -1;
      globalThis.__heroArm = (globalThis.__heroArm ?? 0) + 1;
      const arm = globalThis.__heroArm;

      /** The nearest live enemy ahead that `pick` accepts, as metres of road. */
      const nearest = (state, pick) => {
        let best = null;
        for (const enemy of state.enemies) {
          if (!enemy.alive || !pick(enemy)) continue;
          const gap = enemy.z - state.squad.z;
          if (gap <= 0) continue;
          if (best === null || gap < best) best = gap;
        }
        return best;
      };

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

      const isShielded = (enemy) => enemy.kind === 'shieldBrute';
      const isCharger = (enemy) => enemy.kind === 'charger';

      /** Sim speed for a body `gap` metres ahead, by this step's own ladder. */
      const paceFor = (gap, near, far) => {
        if (gap === null || gap >= far.gap) return clock.cruise;
        return gap < near.gap ? near.turbo : far.turbo;
      };

      const setPace = (step, state) => {
        if (step.at === 'shieldBroken') {
          const gap = nearest(state, isShielded);
          globalThis.__arcane?.setTurbo(paceFor(gap, clock.near, clock.far));
          return;
        }
        if (step.at === 'charge') {
          if (nearest(state, (enemy) => isCharger(enemy) && enemy.charge !== undefined) !== null) {
            globalThis.__arcane?.setTurbo(clock.charging);
            return;
          }
          const gap = nearest(state, isCharger);
          globalThis.__arcane?.setTurbo(paceFor(gap, clock.chargerNear, clock.charger));
          return;
        }
        if (step.at === 'bossCharge') {
          globalThis.__arcane?.setTurbo(state.boss?.active === true ? clock.boss : clock.cruise);
        }
      };

      const holds = (step, state) => {
        if (step.at === 'row') {
          // The same ladder the meadow rows use (`armHeroPlan`): fast until the
          // row is in reach, then two steps down so the stop lands on it.
          if (state.squad.z < step.after) return false;
          const gap = rowGap(state);
          if (gap === null) return false;
          const turbo = gap > step.value + 24 ? 60 : gap > step.value + 4 ? 6 : 3;
          globalThis.__arcane?.setTurbo(turbo);
          return gap <= step.value;
        }
        setPace(step, state);
        if (step.at === 'shieldBroken') {
          const gap = nearest(state, (enemy) => isShielded(enemy) && (enemy.shield ?? 0) <= 0);
          return gap !== null && gap >= clock.brokenShot.from && gap <= clock.brokenShot.to;
        }
        if (step.at === 'charge') {
          const gap = nearest(state, (enemy) => isCharger(enemy) && enemy.charge !== undefined);
          return gap !== null && gap >= clock.chargeShot.from && gap <= clock.chargeShot.to;
        }
        // The Fiend, and only while it is still running *in*: past `until` it is
        // walking home, which is the same charge to the sim and a different
        // picture — the column bows under the run in, not under the walk back.
        const boss = state.boss;
        return (
          boss !== null &&
          boss !== undefined &&
          boss.alive &&
          boss.charge !== undefined &&
          boss.z - state.squad.z <= clock.bossGap &&
          state.time <= boss.charge.until
        );
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
        // No speed-up here, unlike the meadow watcher: the next step is another
        // short moment and the clock it needs is the one it is already at.
        globalThis.__arcane?.app.stop();
        globalThis.__heroStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, clock: pace },
  );
}
