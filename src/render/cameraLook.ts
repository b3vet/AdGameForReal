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
  /**
   * The camera tracks the finger only partly, so the road stays framed: a shot
   * that followed the thumb exactly would slide the road out from under it, and
   * one that never moved would leave the crowd against the edge. (The finger
   * rather than the crowd since D43 — see the paragraph at the end of this
   * comment, and `lateralFrequency` below.)
   *
   * 0.55, up from Milestone 5 Phase F's 0.45, because D42 traded width for
   * reach: the column is a third as wide (0.75 m of half extent at 500 units
   * against 2.1) but its centre may now stand at 2.2 m rather than 1.2, so the
   * outermost unit sits at 2.95 m — only 0.35 m nearer the middle than before,
   * while the *lowest* thing on screen is no longer the crowd's own back rank
   * but whatever rank the bottom edge cuts through, which is nearer the camera
   * and therefore in a narrower slice of frame.
   *
   * Measured at 390x844 with the squad pinned at the clamp: the frame's half
   * width where the bottom edge meets the road is 1.92 m, and 0.45 put the eye
   * at 0.99 m, leaving that column's centre 4 px *outside* the frame. 0.55
   * moves the eye to 1.21 m and puts it 18 px inside — a mage's width clear.
   * Past that the shot starts to strafe with the thumb rather than pan with it.
   *
   * Re-measured for D43, where the crowd is five hundred agents rather than a
   * formation and its outer edge is wherever the units actually stand. It is
   * the same edge: the column is 77 ranks of at most seven, 1.5 m across, so
   * the outermost unit is 0.75 m from the head and stands at 2.95 m with the
   * head pinned at 2.2. The bottom corner of the frame is at 1.21 + 1.92 =
   * 3.13 m, so the margin is 0.18 m — 18 px of the 390 — and the front rank's
   * outermost mage sits 86 px inside the frame. Unchanged, because the number
   * this follows changed (`squad.targetX` rather than `squad.x`) but not what
   * it follows *to*: at rest the two are the same.
   */
  lateralFollow: 0.55,
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
   *
   * D43 raises it from 7 to 13 and changes what it is chasing: the finger
   * (`squad.targetX`) rather than the head. Seven was tuned against a head that
   * was itself an eased follow of the finger, and the two lags stacked — a
   * lane change took the better part of a second to settle on screen, which is
   * the "not responsive" of the Milestone 5 playtest as much as the crowd was.
   * At 13 the pose is 95 percent of the way in 0.36 s, which is still slower
   * than the head's own 50 ms into the lane: the road arrives with the thumb,
   * the head arrives just after it, and the tail comes in behind that. Faster
   * again and the shot strafes; slower and the crowd's response is hidden
   * inside the camera's.
   */
  lateralFrequency: 13,
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
   * The pull-back, per metre of formation *depth* (D37; the caps re-derived for
   * the column in D42).
   *
   * Milestone 2 scaled this by the count, which was right when the formation
   * was a disc: the disc's depth grew with `sqrt(count)` and saturated, so a
   * capped linear term in the count was a rough stand-in for it. The formation
   * is not a disc — it fills its band and then grows *backward* — so the count
   * is no longer a proxy for anything and the rig reads the depth itself.
   *
   * What the numbers buy is where the bottom edge of the shot meets the road,
   *
   *   z = eyeZ + eyeY / tan(pitch + fov/2)
   *
   * relative to the squad's anchor. Phase E asked that to clear the *last* rank
   * of a 4.4 m wide crowd, 7.2 m deep at 500 units, and 8.4 m of pull-back is
   * what that costs. D42's column is 13.3 m deep at 500 in a 1.6 m lane, and no
   * camera on this road frames thirteen metres of crowd at a size worth
   * drawing: the shot frames the *front* of the column and the tail runs off
   * the bottom, with the plaque's count saying how much of it there is.
   *
   * So the caps are now a framing rather than a guard rail. The pull-back grows
   * with the depth until the front six metres of the column are in frame and
   * then stops: `back` 3.4 and `lift` 0.62 put the bottom edge 6.03 m behind
   * the anchor, which is 34 of the 77 ranks a 500-unit column stands in. Past
   * that, distance would only shrink the ranks the player can actually see.
   *
   * The pair is still 1.15 and 0.21 *per metre* so both saturate together at
   * 2.96 m of depth (about fifty units in a lane), and below that the whole
   * crowd is framed with metres to spare — a five-unit squad has no depth at
   * all and therefore no pull-back, which is Milestone 3's framing exactly.
   *
   * The lift's job changed with the cap and its ratio to the back went with it
   * (0.38 per metre to 0.21). It never bought depth in the first place — lifting
   * the camera steepens the pitch, which drags the bottom edge back *toward*
   * the camera and undoes what the height bought — what it buys is the angle
   * the shot looks down at, `atan(eyeY / (behind + back))`. At 3.4 back and
   * 0.62 lift that is 23.4 degrees, which is exactly what the Phase E rig
   * reached at its own cap: the same shot, standing five metres nearer.
   *
   * Measured at 390x844 (front-rank mage, in CSS px; the sim's column, floor
   * `CROWD_SCALE_MIN`): 10 units 55.5, 50 units 43.5, 100 units 39.7, 200 units
   * 35.9, 500 units 32.3 — the 500-unit rank 74% of the 50-unit one, where the
   * Phase E caps left it at 56%.
   */
  backPerDepth: 1.15,
  liftPerDepth: 0.21,
  backMax: 3.4,
  liftMax: 0.62,
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

