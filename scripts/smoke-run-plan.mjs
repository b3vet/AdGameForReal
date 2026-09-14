/**
 * What one scripted run photographs, and when.
 *
 * Split out of `./smoke-run.mjs` in the Milestone 7 review, which left that
 * file at 599 lines. The seam is the one a run already has: *what a frame is
 * of* — the moment it waits for, the sim speed that moment needs, and the
 * page-side watcher that stops the loop on it — is this file, and *driving a
 * run at all* is that one. Nothing here knows which runs exist, and nothing
 * here asserts anything: a shot plan takes pictures.
 */

/** What a shot is waiting for, for the failure message. */
function describeShot(frame) {
  if (frame.at === 'z') return `${String(frame.value)} m of road`;
  if (frame.at === 'boss') return 'the boss fight';
  if (frame.at === 'shield') return 'a shielded brute with its shield up';
  if (frame.at === 'shieldBroken') return 'a shielded brute with its shield broken';
  if (frame.at === 'charge') return 'a charger running its lane';
  if (frame.at === 'bossCharge') return "the Rime Fiend's charge";
  return 'a staff gate';
}

/**
 * How close a staff gate has to be before its frame is taken, in metres. Wider
 * than a turbo frame's fifteen metres of road, or the squad steps over the
 * window between two frames and the gate is never photographed; not much wider,
 * or the panel is a smudge in the fog and its staff prop is three pixels.
 */
export const STAFF_SHOT_RANGE = 18;

/**
 * The boss frame is taken on the first frame where the boss is down to this
 * share of its health — half way through the fight, so the demon has walked
 * into the squad and has a stomp on the ground, with the bar and its HP label
 * both up. A turbo frame is about a seventh of the fight, so there is no risk
 * of stepping from above this straight to a dead boss.
 *
 * Milestone 2's boss.png was a picture of a *dead* boss: the shot was a fixed
 * delay after `boss.active`, and at turbo 60 one frame is three seconds of sim,
 * so the whole fight could pass inside it. Then the HUD's boss bar is hidden
 * (the bar follows `boss.alive`) and the world HP label is gone with the body,
 * which read as two missing-UI bugs and was one timing bug.
 */
export const BOSS_SHOT_HP_SHARE = 0.5;
/** Ceiling on one shot's wait, so a run that never gets there still ends. */
const SHOT_TIMEOUT_MS = Number(process.env.SMOKE_SHOT_TIMEOUT_MS ?? 180_000);
/**
 * The Frostfell shots and the sim clock they need (D49).
 *
 * The other steps here are keyed to a *place* — a metre mark, a gate row, a
 * share of the boss's health — and a place cannot be stepped over: the squad
 * walks past it and the condition stays true. The three Frostfell ones are
 * keyed to a *moment*, and every one of them is short. Measured on the sim for
 * level 23 seed 1 with the campaign's kit: the shielded brute at z 215 keeps
 * its shield for a tenth of a second once it is inside the squad's range (five
 * hundred armed mages break it on contact with the range), the block then lives
 * 1.3 s broken, the charger at z 342 runs for 0.9 s, and the Rime Fiend's first
 * charge comes 8 s into the fight.
 *
 * At turbo 60 one frame is three seconds of sim, so none of those windows
 * exists between two frames. So this run *paces* itself: each step names how
 * fast the sim may run as its moment comes into reach, the way the hero set
 * already does for a gate row (`./smoke-hero.mjs`). Nothing a run asserts is a
 * wall-clock measurement — every one is a count — so slowing the sim down
 * cannot change an answer, it only costs frames.
 *
 * The shield's own frame is therefore taken *before* the squad is in range: 26
 * to 42 m out, where the block is small but its shield glyph and count are
 * still inside `LABEL_RANGE`. Nearer than that there is no such frame to take.
 */
export const PACE = {
  /**
   * What the sim runs at when the step's subject is out of reach — the query's
   * own turbo, handed straight back.
   *
   * A step that only ever *slows* the clock is a run that never speeds up
   * again: the first attempt at this took the shield frames and then crawled
   * the hundred and fifty metres to the charger at turbo 3, which is a hundred
   * frames of a five-hundred-mage crowd and ran a two-minute shot timeout out.
   * Pacing is a window around a moment, not a speed limit for the rest of the
   * level.
   */
  cruise: 60,
  /**
   * Metres at which a step starts slowing the sim, and the turbo it takes.
   *
   * A rung is sound exactly when one of its own frames is shorter than the
   * *next* rung's band, so the ladder cannot be stepped over: a frame is
   * `turbo * 0.05` seconds of sim at the app's clamp, and squad and block close
   * at about 11 m/s together. Cruise is 27 m a frame into a 46 m band; `far` is
   * 5.5 m into a 10 m band; `near` is 1.65 m into the window itself. The
   * Milestone 7 review widened `far` and shortened `near` on those margins —
   * 6 and 50 m were about sixteen frames of a five-hundred-mage crowd, which is
   * half a minute of this container's wall clock for two frames of slack
   * nothing needed.
   */
  far: { gap: 90, turbo: 10 },
  near: { gap: 44, turbo: 3 },
  /**
   * A body about to move: the charger's trigger is at 22 m (D49), so the clock
   * only has to be low for the last few metres before it. Measured once at
   * `{34, 2}` and it cost thirteen frames of a five-hundred-mage crowd getting
   * to the trigger — which is a minute of wall clock on this rasteriser and ran
   * the shot's own timeout out. `{26, 4}` is two frames to the trigger and
   * still four or five frames inside the 0.9 s the charge lasts. The outer rung
   * runs at 5.4 m a frame, and a frame that lands past the trigger is safe:
   * `setPace` sees the charge on the next one and drops straight to `charging`.
   */
  charger: { gap: 60, turbo: 12 },
  chargerNear: { gap: 26, turbo: 4 },
  /**
   * And slower again once it is actually running, because the trail is what
   * the frame is of.
   *
   * It was 2 until the review, because the emitter shed a puff every 0.055 s of
   * *frame* time while the body crossed the road at sim speed: a charge
   * photographed at turbo 4 left marks five metres apart, a dotted line rather
   * than the track the game draws. The emitter now runs on the sim's own clock
   * (`src/render/frostSpray.ts`), so the trail is the same track at any turbo
   * and this only has to leave frames inside the window — the charge covers the
   * 14 m of `chargeShot` in about 0.78 s, which is three or four frames here.
   */
  charging: 4,
  /** The fight: 8 s of sim between charges, and a run in of about 1.5 s —
   *  twenty frames of waiting and four inside the window at this speed. */
  boss: 8,
  /**
   * How near the column the Fiend has to be before its frame is taken, in
   * metres.
   *
   * Not "any frame of the charge", which is what it was. The wake is laid down
   * as the body moves (`src/render/frostSpray.ts`), so the first frame of a
   * charge is a boss with one mark under it and clean road behind — a frame of
   * the *start* of a move, where the picture wanted is the middle of one. It
   * sets off about twelve metres out and a frame here is three or four of them,
   * so six metres is two or three frames in: the column is bowing, the body is
   * over it, and there are five metres of track behind it. Wider than one frame
   * of travel, so the window cannot be stepped over (Milestone 7 review).
   */
  bossGap: 6,
  /**
   * Where each body is photographed, in metres of road ahead of the squad.
   *
   * All three are as near as the moment allows, because near is what a frame
   * is read on: 34 m is the last step before the squad's fire reaches the
   * shielded brute and breaks it, 28 m is three metres after the break (the
   * block then lives about twelve more), and a charger is inside 30 m from the
   * step it commits — its trigger is at 22.
   *
   * The shield's own window is narrower than the 26 to 34 it reads: measured on
   * level 23 seed 1 with the kit, the shield breaks at a gap of 29.2 m, so the
   * frames that can carry a *standing* shield are 29 to 34 — three of them at
   * `near`'s speed. That is why `near.turbo` did not move with `far`'s.
   */
  shieldShot: { from: 26, to: 34 },
  brokenShot: { from: 5, to: 26 },
  chargeShot: { from: 3, to: 17 },
};

/** What the sim is handed back once the last paced shot has been taken. */
export const PACED_TAIL_TURBO = 60;

/**
 * Installs a page-side watcher that walks the run's shot list.
 *
 * Every frame it asks whether the current step's moment has arrived, and the
 * first frame that says yes stops the app's loop *from inside the page*. That
 * is the whole trick: a `waitForFunction` round trip back to Node costs a frame
 * or three, and a turbo frame is three seconds of sim — long enough for the
 * boss to die or the gate to end up behind the squad. With the loop stopped
 * nothing moves while the picture is taken, so the frame photographed is the
 * frame that qualified, on any machine.
 */
export async function armShotPlan(page, shots, bossShare, staffRange, pace) {
  await page.evaluate(
    ({ plan, share, range, pace: clock }) => {
      globalThis.__smokePlan = plan;
      globalThis.__smokeStep = 0;
      globalThis.__smokeStopped = false;
      // Sim time of the last shot. The watcher runs on its own frame callback,
      // so after a shot is released it can qualify the *next* step before the
      // app's loop has drawn anything — and two shots then photograph one
      // frame. Level 10's staff gate and its 120 m mark did exactly that once
      // the row generation moved (`staff-l10.png` and `t12-l10.png` came out
      // byte for byte alike). A shot may not be taken until the sim has moved.
      globalThis.__smokeAt = -1;

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

      const isShielded = (enemy) => enemy.kind === 'shieldBrute';
      const shieldUp = (enemy) => isShielded(enemy) && (enemy.shield ?? 0) > 0;
      const shieldGone = (enemy) => isShielded(enemy) && (enemy.shield ?? 0) <= 0;
      const isCharger = (enemy) => enemy.kind === 'charger';

      /**
       * How fast the sim may run this frame, for a step whose moment is short.
       * Called before `holds`, every frame, so the clock is already down by the
       * time the window opens.
       */
      /** Sim speed for a body `gap` metres ahead, by this step's own ladder. */
      const paceFor = (gap, near, far) => {
        if (gap === null || gap >= far.gap) return clock.cruise;
        return gap < near.gap ? near.turbo : far.turbo;
      };

      const setPace = (step, state) => {
        if (step.at === 'shield' || step.at === 'shieldBroken') {
          // Any shielded brute, broken or not: the two steps are the same body
          // a second apart, and letting the clock back up between them is what
          // would step over the break.
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
        if (step.at === 'z') return state.squad.z >= step.value;
        if (step.at === 'boss') {
          const boss = state.boss;
          // Under way and still standing: bar and HP label are both up.
          return boss !== null && boss.active && boss.alive && boss.hp <= boss.maxHp * share;
        }
        if (step.at === 'shield') {
          const gap = nearest(state, shieldUp);
          return gap !== null && gap >= clock.shieldShot.from && gap <= clock.shieldShot.to;
        }
        if (step.at === 'shieldBroken') {
          const gap = nearest(state, shieldGone);
          return gap !== null && gap >= clock.brokenShot.from && gap <= clock.brokenShot.to;
        }
        if (step.at === 'charge') {
          const gap = nearest(state, (enemy) => isCharger(enemy) && enemy.charge !== undefined);
          return gap !== null && gap >= clock.chargeShot.from && gap <= clock.chargeShot.to;
        }
        if (step.at === 'bossCharge') {
          // Still running *in*: past `until` the Fiend is walking home, which is
          // the same charge to the sim and a different picture — the column bows
          // under the run in, not under the walk back (D49).
          const boss = state.boss;
          return (
            boss !== null &&
            boss.alive &&
            boss.charge !== undefined &&
            boss.z - state.squad.z <= clock.bossGap &&
            state.time <= boss.charge.until
          );
        }
        return state.gates.some(
          (gate) =>
            gate.kind === 'weapon' &&
            !gate.passed &&
            gate.z - state.squad.z > 0 &&
            gate.z - state.squad.z < range,
        );
      };

      const tick = () => {
        globalThis.requestAnimationFrame(tick);
        if (globalThis.__smokeStopped) return;
        const step = globalThis.__smokePlan[globalThis.__smokeStep];
        const state = globalThis.__arcane?.state();
        if (step === undefined || !state) return;
        if (state.time === globalThis.__smokeAt) return;
        setPace(step, state);
        if (!holds(step, state)) return;
        globalThis.__smokeAt = state.time;
        globalThis.__arcane?.app.stop();
        globalThis.__smokeStopped = true;
      };
      globalThis.requestAnimationFrame(tick);
    },
    { plan: shots, share: bossShare, range: staffRange, pace },
  );
}

/** Waits for the watcher to stop on the current step. False on a timeout. */
function waitForStop(page, timeout) {
  return page
    .waitForFunction(() => globalThis.__smokeStopped === true, null, { timeout })
    .then(() => true)
    .catch(() => false);
}

/** Releases the loop and moves the watcher on to the next step. */
function releaseStop(page) {
  return page.evaluate(() => {
    globalThis.__smokeStep = (globalThis.__smokeStep ?? 0) + 1;
    globalThis.__smokeStopped = false;
    globalThis.__arcane?.app.resume();
  });
}

/**
 * Walks a run through its shot list: wait, photograph, release.
 *
 * A shot that never arrives is reported and ends the plan — the frames after it
 * are of a road this run never reached, and waiting for each in turn costs
 * `SHOT_TIMEOUT_MS` apiece.
 */
export async function takeShots(page, run, shot, written, failures) {
  for (const frame of run.shots) {
    const reached = await waitForStop(page, SHOT_TIMEOUT_MS);
    if (!reached) {
      failures.push(`${run.label}: ${frame.name} — the run never reached ${describeShot(frame)}`);
      return;
    }
    try {
      written.push(await shot(frame.name));
    } finally {
      await releaseStop(page);
    }
  }
}
