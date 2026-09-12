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
   * Extra distance as the squad grows, so the tail of the crowd stays on
   * screen. The formation is an ellipse whose depth grows with `sqrt(count)`
   * and saturates around 3.5 m, so this reaches its cap at about 70 units
   * rather than climbing all the way to 500. A shade more than Milestone 2's,
   * because the units themselves are bigger and the formation is wider.
   */
  pullbackPerUnit: 0.035,
  pullbackMax: 2.4,
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

