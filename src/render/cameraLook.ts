/**
 * Where the camera stands: the play rig, the Academy backdrop's, and the shakes
 * the renderer calls on itself.
 *
 * Split out of `./theme.ts` in Milestone 4 Phase C, which had grown past the
 * file-size rule (CLAUDE.md); `theme.ts` re-exports all of it, so every view
 * still reads one module. Grouped because the numbers are one set: the two
 * framings are derived from the same angles and were measured against the same
 * 390x844 frame, and changing one without the other moves the horizon.
 */

/** Camera shake the renderer calls on itself, per the juice checklist. */
export const SHAKE_STOMP = { strength: 0.15, seconds: 0.3 } as const;
export const SHAKE_BOSS_KILL = { strength: 0.35, seconds: 0.6 } as const;

/**
 * Camera rig, per docs/09-milestone-3-plan.md ("Squad reads as hats").
 *
 * The elevation — `atan(height / behind)`, the angle the shot looks down on the
 * squad at — drops from Milestone 2's 36 degrees to about 27. That is the whole
 * point of the change: at 36 degrees a KayKit mage is seen from above and what
 * faces the camera is the top of its hat, whatever the hat is scaled to.
 *
 * The values are one set, not six knobs. Two angles follow from them and both
 * were measured against 390x844 frames:
 *
 *   elevation  atan(height / behind)                       = 27.0 deg
 *   pitch      atan((height - lookHeight) / (behind + lookAhead)) = 13.6 deg
 *
 * The pitch decides where the horizon sits (`tan(pitch) / tan(fov/2)` of the
 * way up from the middle: 0.56, so a fifth of the way down from the top) and
 * where the squad lands (0.55 below the middle, about four fifths down). The
 * field of view is narrower than Milestone 2's 0.9 because a flatter shot
 * compresses the road: at 0.82 the two gate rows at 18 m and 36 m are 57 px
 * apart at that size rather than 48, which is what keeps both numbers readable.
 * Change any of them together and re-shoot `npm run smoke`.
 */
export const CAMERA = {
  fov: 0.82,
  height: 5.6,
  behind: 11,
  lookAhead: 8,
  lookHeight: 1,
  /** The camera tracks the squad's x only partly, so the road stays framed. */
  lateralFollow: 0.35,
  /**
   * The far plane. It has to hold the sky dome (420 m, `./sky.ts`), which in
   * turn has to sit outside the fog's 260 m end — clip the dome and the top of
   * the frame is the clear colour with a hard edge across it. Milestone 3's
   * 220 was chosen against a fog that ended at 130.
   *
   * The near plane stays at 0.2: 0.2 to 520 is a depth ratio of 2600, which a
   * 24-bit buffer holds without the road's lane runes fighting the stone.
   */
  maxZ: 520,
  /**
   * Lateral follow, as a critically damped spring (plan, "Movement must be
   * smoother"). `lateralFrequency` is its angular frequency in radians per
   * second: the pose reaches about 95 percent of a step in `4.7 / f` seconds,
   * so 7 settles a drag in two thirds of a second with no overshoot at all.
   *
   * A spring rather than the exponential ease the rest of the pose uses,
   * because the two are asked for different things. The ease is a filter on a
   * position; the spring is a *mass*, so the camera leaves late and arrives
   * settled, which is what makes a fast drag read as the shot following the
   * squad rather than as the world sliding sideways under it. Critically
   * damped, never under: an overshoot at this distance is a wobble.
   */
  lateralFrequency: 7,
  /**
   * The roll, in radians per metre per second of the camera's own lateral
   * speed, and the most it may ever reach.
   *
   * Tiny on purpose — 0.035 rad is two degrees, which nobody can see as a tilt
   * and everybody feels as weight. It is driven by the *camera's* velocity
   * rather than the squad's, so it is already smoothed by the spring above and
   * cannot flick when the sim's own lateral clamp bites at the road's edge.
   */
  roll: 0.012,
  rollMax: 0.035,
  /**
   * The pull-back, per metre of formation *depth* (D37, retuned in Milestone 5
   * Phase E).
   *
   * Milestone 2 scaled this by the count, which was right when the formation
   * was a disc: the disc's depth grew with `sqrt(count)` and saturated, so a
   * capped linear term in the count was a rough stand-in for it. The
   * line-filling formation is not a disc — it fills the band and then grows
   * *backward*, 7.2 m deep at 500 units on the open road and deeper still in a
   * walled lane — so the count is no longer a proxy for anything and the old
   * cap of 2.4 m, reached at about seventy units, left the back of a big crowd
   * under the bottom edge of the frame (`artifacts/smoke/boss.png`; the stress
   * scene's own frame looks the same but is not this rig's doing — it draws
   * straight into the scene and never moves the camera at all).
   *
   * So the rig reads the depth itself. What the numbers have to buy is the
   * ground at the *back row* staying inside the frame: the bottom edge of the
   * shot meets the road at
   *
   *   z = eyeZ + eyeY / tan(pitch + fov/2)
   *
   * relative to the squad's anchor, and at 500 units (7.17 m of crowd) `back`
   * 8.2 and `lift` 2.7 put that at 8.8 m behind the anchor — a metre and a half
   * of road behind the last rank, with the horizon still a fifth of the way
   * down the frame. Distance does most of the work and height only a third as
   * much, and that ratio is the part to keep: lifting the camera steepens the
   * pitch, which drags the bottom edge back *toward* the camera and undoes what
   * the height bought. A rig that pulled back on height alone would have to
   * stand twelve metres up to frame the same crowd.
   *
   * A five-unit squad has no depth at all and therefore no pull-back, which is
   * Milestone 3's framing exactly.
   *
   * The caps are a guard rail rather than a tuning: a crowd squeezed into a
   * 1.2 m lane between two walls is over twenty metres deep, and no camera on
   * this road frames that — past the cap the back of the queue is simply behind
   * the shot.
   */
  backPerDepth: 1.15,
  liftPerDepth: 0.38,
  backMax: 8.4,
  liftMax: 2.8,
  /**
   * How fast the rig eases toward a new depth — per second of frame time, and
   * per metre of road the squad covers.
   *
   * Two terms, because the depth changes on the *sim's* clock and the ease runs
   * on the frame's. A `mul` gate doubles the count in one frame and the depth
   * that follows is a step of nearly three metres; easing that over time alone
   * is right at 60 fps and wrong everywhere else, because `?turbo` advances
   * three seconds of sim in one frame and a headless frame can take a second of
   * wall clock. A scripted run would then be framed for a crowd it left behind
   * a hundred metres ago, and every hero shot would have its back rank under
   * the bottom edge.
   *
   * The distance term is what ties the two clocks together, and it is not a
   * trick: the crowd only *changes* by walking through gate rows, so metres of
   * road are the units the pull-back is really measured in. At 60 fps and the
   * run speed the pair settles a step in about a third of a second; at turbo
   * 60, where one frame is fifteen metres of road, a single frame closes
   * almost all of it. Neither is a jump — the wanted pose never moves, only the
   * ease's rate does.
   */
  depthSmoothing: 1.6,
  depthPerMetre: 0.22,
  /**
   * How far the eased pose may trail the ideal one, in meters. Steady-state lag
   * while running is `runSpeed / smoothing`, about 0.8 m, so normal play never
   * reaches this; a frame hitch or `?turbo` (several sim steps per frame) would,
   * and without the clamp the whole frame reframes.
   */
  maxLag: 1.5,
  /** Exponential smoothing rate, in 1/seconds. */
  smoothing: 6,
  /**
   * Camera movement per frame, in meters, below which the pose counts as
   * arrived. Well under a pixel at this distance, and it is what lets the title
   * screen stop redrawing an identical frame.
   */
  settleEpsilon: 0.002,
} as const;

/**
 * Extra metres behind the squad for a crowd `depth` metres deep, and the extra
 * height that goes with it. One pair of functions, because two places derive a
 * camera pose from the same numbers: the rig itself (`./camera.ts`) and the
 * label-clearance rule (`./labelClearance.ts`), which projects gate panels
 * against the pose the rig is easing toward.
 */
export function cameraBack(depth: number): number {
  return Math.min(CAMERA.backMax, Math.max(0, depth) * CAMERA.backPerDepth);
}

export function cameraLift(depth: number): number {
  return Math.min(CAMERA.liftMax, Math.max(0, depth) * CAMERA.liftPerDepth);
}

/**
 * The Academy backdrop's breath (docs/12-milestone-4-plan.md).
 *
 * The home screen is a still frame of a generated level — a preview run that is
 * never ticked — and a still frame of a crowd that is already swaying reads as
 * a paused game. So while a preview is up the camera drifts: half a metre
 * sideways and a fifth of a metre up, on two periods that do not divide into
 * each other so the loop never lands on itself, both slow enough that no single
 * glance sees it move.
 */
export const PREVIEW_DRIFT_X = 0.55;
export const PREVIEW_DRIFT_Y = 0.22;
export const PREVIEW_DRIFT_PERIOD = 17;
export const PREVIEW_DRIFT_PERIOD_Y = 11;

/**
 * And where the backdrop stands, which is not where the game stands.
 *
 * The play framing puts the squad about four fifths of the way down the screen,
 * because in a run the road ahead is what is being decided about and the crowd
 * only has to be within reach of a thumb. The Academy's cards own the bottom
 * two fifths, so that framing parks the mages *behind the panel* and the
 * backdrop is an empty road — which is what `artifacts/smoke/academy.png` and
 * `title.png` show today.
 *
 * Where the crowd lands is set by one angle: how far below the horizon it sits,
 * `atan((height - unitMid) / behind)`, which at the play rig is 26 degrees out
 * of a 47-degree frame. No amount of re-aiming can lift it past that — aiming
 * nearer tips the horizon off the top of the screen long before the crowd
 * clears the cards. The angle itself has to shrink, and that means standing
 * further back and a little lower:
 *
 *   play      behind 11, height 5.6  ->  26.0 deg below the horizon
 *   backdrop  behind 20, height 4.6  ->  11.9 deg
 *
 * With the shot then aimed just in front of the crowd, the horizon sits about a
 * third of the way down, the squad two fifths, and the cards begin below both.
 * A mage is still forty pixels tall at that distance, and the first gate row is
 * inside the fog, so the backdrop is a place rather than a strip of road.
 * Measured against the 390x844 frame the rest of the camera was measured at; if
 * the Academy's panel moves, these move with it.
 */
export const PREVIEW_BEHIND = 20;
export const PREVIEW_HEIGHT = 4.6;
export const PREVIEW_LOOK_AHEAD = 2.2;
export const PREVIEW_LOOK_HEIGHT = 0.9;
/** Seconds the framing takes to swing between the two, so neither one cuts. */
export const PREVIEW_BLEND_RATE = 4;

